import Fastify, { type FastifyInstance } from 'fastify';
import type { FlowDefinition, PlanDefinition, RunResult } from '../model.js';
import type {
  CreateFlowRunBody,
  CreatePlanRunBody,
  DefinitionSummary,
  ErrorBody,
  HumanRespondBody,
  RunDetail,
  RunSummary,
} from '../api-types.js';
import { GraphValidationError } from '../errors.js';
import { validateFlowDefinition, validatePlanDefinition } from '../graph.js';
import { FlowRunner } from '../flow-runner.js';
import { PlanRunner } from '../plan-runner.js';
import { createNodeExecutor, HumanTaskBroker, localScriptHandler, type NodeExecutor } from '../runtime.js';
import { createOpencodeAgentHandler } from './agent.js';
import { EventHub } from './events.js';
import { readNodeSource } from './flows-source.js';
import { seedDefinitions } from './seed.js';
import { flowRunDetail, flowRunSummary, planRunDetail, planRunSummary } from './serialize.js';
import { DefinitionStore, RunRegistry, definitionKey, type RegisteredRun } from './store.js';

export type AppOptions = {
  executor?: NodeExecutor;
  broker?: HumanTaskBroker;
  seed?: boolean;
  now?: () => Date;
};

type RefParams = { id: string; version: string };
type IdParams = { id: string };
type HumanParams = { flowInstanceId: string; nodeId: string };

export function createApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new DefinitionStore();
  const registry = new RunRegistry();
  const hub = new EventHub();
  const now = options.now ?? (() => new Date());

  const broker = options.broker ?? new HumanTaskBroker();

  const executor =
    options.executor ??
    createNodeExecutor({
      script: localScriptHandler,
      human: broker.handler,
      agent: createOpencodeAgentHandler({
        bin: process.env.OPENCODE_BIN,
        model: process.env.OPENCODE_MODEL,
        agent: process.env.OPENCODE_AGENT,
        autoApprove: process.env.OPENCODE_FLOW_AUTO_APPROVE === '1',
      }),
    });

  const resolveFlow = (ref: { id: string; version: string }): FlowDefinition => {
    const definition = store.getFlow(ref.id, ref.version);
    if (!definition) {
      throw new Error(`flow definition "${definitionKey(ref.id, ref.version)}" was not found`);
    }
    return definition;
  };

  const publishRun = (kind: 'flow' | 'plan', instance: { id: string; status: RunSummary['status']; updatedAt: string }) => {
    hub.publish({
      type: 'run',
      run: { runId: instance.id, kind, status: instance.status, updatedAt: instance.updatedAt },
    });
  };

  if (options.seed !== false) {
    seedDefinitions(store);
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof GraphValidationError) {
      return reply.code(400).send({ error: 'invalid definition', issues: error.issues } satisfies ErrorBody);
    }
    return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) } satisfies ErrorBody);
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/definitions', async () => {
    const flows: DefinitionSummary[] = store.listFlows().map((definition) => ({
      kind: 'flow',
      id: definition.id,
      version: definition.version,
      nodeCount: definition.stages.reduce((count, stage) => count + countStage(stage), 0),
    }));
    const plans: DefinitionSummary[] = store.listPlans().map((definition) => ({
      kind: 'plan',
      id: definition.id,
      version: definition.version,
      nodeCount: definition.nodes.length,
    }));
    return [...flows, ...plans];
  });

  app.get<{ Params: RefParams }>('/api/flows/:id/:version', async (request, reply) => {
    const definition = store.getFlow(request.params.id, request.params.version);
    if (!definition) {
      return reply.code(404).send({ error: 'flow definition not found' } satisfies ErrorBody);
    }
    return definition;
  });

  app.get<{ Params: RefParams & { nodeId: string } }>(
    '/api/flows/:id/:version/nodes/:nodeId/source',
    async (request, reply) => {
      const definition = store.getFlow(request.params.id, request.params.version);
      if (!definition) {
        return reply.code(404).send({ error: 'flow definition not found' } satisfies ErrorBody);
      }
      const files = readNodeSource(request.params.id, definition, request.params.nodeId);
      if (!files) {
        return reply.code(404).send({ error: 'node source not found' } satisfies ErrorBody);
      }
      return { files };
    },
  );

  app.post('/api/flows', async (request, reply) => {
    const definition = request.body as FlowDefinition;
    validateFlowDefinition(definition);
    store.putFlow(definition);
    return reply.code(201).send(definition);
  });

  app.get<{ Params: RefParams }>('/api/plans/:id/:version', async (request, reply) => {
    const definition = store.getPlan(request.params.id, request.params.version);
    if (!definition) {
      return reply.code(404).send({ error: 'plan definition not found' } satisfies ErrorBody);
    }
    return definition;
  });

  app.post('/api/plans', async (request, reply) => {
    const definition = request.body as PlanDefinition;
    validatePlanDefinition(definition);
    const issues = definition.nodes
      .filter((node) => !store.getFlow(node.flow.id, node.flow.version))
      .map((node) => ({
        path: `nodes.${node.id}.flow`,
        message: `flow "${definitionKey(node.flow.id, node.flow.version)}" does not exist`,
      }));
    if (issues.length > 0) {
      return reply.code(400).send({ error: 'invalid plan definition', issues } satisfies ErrorBody);
    }
    store.putPlan(definition);
    return reply.code(201).send(definition);
  });

  app.post<{ Params: RefParams }>('/api/flows/:id/:version/runs', async (request, reply) => {
    const definition = store.getFlow(request.params.id, request.params.version);
    if (!definition) {
      return reply.code(404).send({ error: 'flow definition not found' } satisfies ErrorBody);
    }

    const body = request.body as Partial<CreateFlowRunBody>;
    if (!body?.goal?.id) {
      return reply.code(400).send({ error: 'goal.id is required' } satisfies ErrorBody);
    }

    const runner = new FlowRunner({
      definition,
      goal: body.goal,
      context: body.context,
      executor,
      now,
      onChange: (instance) => publishRun('flow', instance),
    });
    registry.addFlow(runner);
    publishRun('flow', runner);

    void runner.execute().catch((error: unknown) => {
      app.log.error(error);
    });

    return reply.code(202).send({ runId: runner.id, status: runner.status });
  });

  app.post<{ Params: RefParams }>('/api/plans/:id/:version/runs', async (request, reply) => {
    const definition = store.getPlan(request.params.id, request.params.version);
    if (!definition) {
      return reply.code(404).send({ error: 'plan definition not found' } satisfies ErrorBody);
    }

    const body = request.body as Partial<CreatePlanRunBody> | undefined;
    const runner = new PlanRunner({
      definition,
      resolveFlow,
      executor,
      context: body?.context,
      now,
      onChange: (instance) => publishRun('plan', instance),
      onFlowInstance: (_nodeId, instance) => {
        registry.addFlow(instance);
        publishRun('flow', instance);
      },
    });
    registry.addPlan(runner);
    publishRun('plan', runner);

    void runner.execute().catch((error: unknown) => {
      app.log.error(error);
    });

    return reply.code(202).send({ runId: runner.id, status: runner.status });
  });

  app.get('/api/runs', async () => {
    return registry.list().map((entry) =>
      entry.kind === 'flow' ? flowRunSummary(entry.instance) : planRunSummary(entry.instance),
    );
  });

  app.get<{ Params: IdParams }>('/api/runs/:id', async (request, reply) => {
    const entry = registry.get(request.params.id);
    if (!entry) {
      return reply.code(404).send({ error: 'run not found' } satisfies ErrorBody);
    }
    return sendRunDetail(entry);
  });

  app.get('/api/flow-runs', async () => {
    return registry
      .list()
      .filter((entry) => entry.kind === 'flow')
      .map((entry) => flowRunSummary(entry.instance));
  });

  app.get('/api/board', async () => {
    return registry
      .list()
      .filter((entry) => entry.kind === 'flow')
      .map((entry) => flowRunDetail(entry.instance))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  app.get<{ Params: IdParams }>('/api/flow-runs/:id', async (request, reply) => {
    const entry = registry.get(request.params.id);
    if (!entry || entry.kind !== 'flow') {
      return reply.code(404).send({ error: 'flow run not found' } satisfies ErrorBody);
    }
    return flowRunDetail(entry.instance);
  });

  app.get('/api/plan-runs', async () => {
    return registry
      .list()
      .filter((entry) => entry.kind === 'plan')
      .map((entry) => planRunSummary(entry.instance));
  });

  app.get<{ Params: IdParams }>('/api/plan-runs/:id', async (request, reply) => {
    const entry = registry.get(request.params.id);
    if (!entry || entry.kind !== 'plan') {
      return reply.code(404).send({ error: 'plan run not found' } satisfies ErrorBody);
    }
    return planRunDetail(entry.instance);
  });

  app.post<{ Params: HumanParams }>('/api/flow-runs/:flowInstanceId/human/:nodeId/respond', async (request, reply) => {
    const body = request.body as HumanRespondBody;
    if (!body || !['succeeded', 'failed', 'cancelled'].includes(body.outcome)) {
      return reply.code(400).send({ error: 'outcome must be succeeded, failed, or cancelled' } satisfies ErrorBody);
    }

    const result: RunResult = {
      outcome: body.metrics ? { status: body.outcome, metrics: body.metrics } : { status: body.outcome },
      ...(body.label === undefined ? {} : { label: body.label }),
      ...(body.error === undefined ? {} : { error: body.error }),
      ...(body.data === undefined ? {} : { output: body.data }),
    };

    if (!broker.respond(request.params.flowInstanceId, request.params.nodeId, result)) {
      return reply.code(404).send({ error: 'human task not found' } satisfies ErrorBody);
    }

    return { ok: true };
  });

  app.get('/api/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    hub.subscribe(reply.raw);

    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);
    heartbeat.unref();

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      hub.unsubscribe(reply.raw);
    });
  });

  return app;
}

function sendRunDetail(entry: RegisteredRun): RunDetail {
  if (entry.kind === 'flow') {
    return flowRunDetail(entry.instance);
  }
  return planRunDetail(entry.instance);
}

function countStage(stage: FlowDefinition['stages'][number]): number {
  return stage.nodes.length + (stage.substages ?? []).reduce((count, child) => count + countStage(child), 0);
}
