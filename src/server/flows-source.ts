import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowDefinition } from '../model.js';
import { flowsRoot } from './paths.js';

export type NodeSourceFile = {
  path: string;
  content: string;
};

// Reads every file in the source folder of a flow node (markdown, scripts, schema,
// renderer, …). Returns undefined when the node or its folder cannot be found.
export function readNodeSource(
  flowId: string,
  definition: FlowDefinition,
  nodeId: string,
): NodeSourceFile[] | undefined {
  const stagePath = findStagePath(definition, nodeId);
  if (!stagePath) {
    return undefined;
  }

  const dir = join(flowsRoot(), flowId, ...stagePath, nodeId);
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile());
  } catch {
    return undefined;
  }

  return entries
    .sort()
    .map((name) => ({ path: name, content: readFileSync(join(dir, name), 'utf8') }));
}

// Returns the stage-path segments that contain the node (stage ids, not node id).
function findStagePath(definition: FlowDefinition, nodeId: string): string[] | undefined {
  const walk = (stages: FlowDefinition['stages'], path: string[]): string[] | undefined => {
    for (const stage of stages) {
      if (stage.nodes.some((node) => node.id === nodeId)) {
        return [...path, stage.id];
      }
      const found = walk(stage.substages ?? [], [...path, stage.id]);
      if (found) {
        return found;
      }
    }
    return undefined;
  };

  return walk(definition.stages, []);
}
