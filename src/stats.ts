import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowNode, TierKind, TierRun } from './model.js';
import type { DelegationConfig } from './policy.js';

// Runtime statistics collected from the tier traces of completed node runs. They are the
// evidence that lets execution evolve from human → agent → script: delegation is allowed
// only when the measured agreement between a tier and the human anchor holds above the
// policy's threshold for enough samples.
export type AgreementStat = {
  agreed: number;
  total: number;
};

export type AgreementPair = 'agent-human' | 'script-human';

export type KeyStat = {
  key: string;
  runs: number;
  escalations: number;              // tier runs whose output fell below their bar
  coverage: { sum: number; count: number }; // average criteria coverage (script tiers)
  agreement: Partial<Record<AgreementPair, AgreementStat>>;
  lastUpdated: string;
};

export type StatsSnapshot = {
  entries: KeyStat[];
};

export type DelegationDecision = 'keep' | 'delegate';

export type StatsStoreOptions = {
  dir?: string; // when set, stats are persisted to <dir>/flow-stats.json
  now?: () => Date;
};

export class StatsStore {
  private readonly entries = new Map<string, KeyStat>();
  private readonly dir?: string;
  private readonly now: () => Date;

  constructor(options: StatsStoreOptions = {}) {
    this.dir = options.dir;
    this.now = options.now ?? (() => new Date());
    if (this.dir) {
      this.load();
    }
  }

  // Records one completed node run. Keys the stats by the node (flow@version:nodeId) and,
  // when the node has annotations, by its annotation class, so delegation evidence can
  // transfer to nodes that have never run themselves.
  record(
    flow: { id: string; version: string },
    node: FlowNode,
    tiers: TierRun[],
  ): void {
    const keys = statsKeys(flow, node);
    for (const key of keys) {
      const entry = this.entry(key);
      entry.runs += 1;
      entry.escalations += tiers.filter((tier) => tier.escalated).length;
      for (const tier of tiers) {
        if (tier.coverage !== undefined) {
          entry.coverage.sum += tier.coverage;
          entry.coverage.count += 1;
        }
      }
      this.recordAgreement(entry, tiers);
      entry.lastUpdated = this.now().toISOString();
    }
    this.save();
  }

  // Decides whether the human tier of this node may be dropped. Returns 'delegate' only
  // when the tier immediately below human has agreed with the human anchor at or above
  // the configured rate for at least the configured number of samples.
  delegateDecision(
    flow: { id: string; version: string },
    node: FlowNode,
    delegation: DelegationConfig,
  ): DelegationDecision {
    const lower = tierBelowHuman(node);
    if (!lower) {
      return 'keep';
    }
    const pair: AgreementPair = lower === 'agent' ? 'agent-human' : 'script-human';

    for (const key of statsKeys(flow, node)) {
      const stat = this.entries.get(key)?.agreement[pair];
      if (!stat) {
        continue;
      }
      if (stat.total < delegation.minSamples) {
        continue;
      }
      return stat.total > 0 && stat.agreed / stat.total >= delegation.agreement ? 'delegate' : 'keep';
    }
    return 'keep';
  }

  snapshot(): StatsSnapshot {
    const entries = [...this.entries.values()]
      .map((entry) => ({ ...entry, agreement: { ...entry.agreement } }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return { entries };
  }

  private entry(key: string): KeyStat {
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }
    const created: KeyStat = {
      key,
      runs: 0,
      escalations: 0,
      coverage: { sum: 0, count: 0 },
      agreement: {},
      lastUpdated: this.now().toISOString(),
    };
    this.entries.set(key, created);
    return created;
  }

  // Agreement between a lower tier and the human anchor is counted when both ran and the
  // lower tier met its bar (otherwise the human run is an escalation, not a comparison).
  private recordAgreement(entry: KeyStat, tiers: TierRun[]): void {
    const human = tiers.find((tier) => tier.kind === 'human');
    if (!human || human.outcome === undefined) {
      return;
    }

    for (const lower of tiers) {
      if (lower.kind === 'human') {
        break;
      }
      if (lower.outcome === undefined || lower.escalated) {
        continue;
      }
      const pair: AgreementPair = lower.kind === 'agent' ? 'agent-human' : 'script-human';
      const stat = entry.agreement[pair] ?? { agreed: 0, total: 0 };
      stat.total += 1;
      if (sameVerdict(lower, human)) {
        stat.agreed += 1;
      }
      entry.agreement[pair] = stat;
    }
  }

  private load(): void {
    const path = this.file();
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    let data: StatsSnapshot;
    try {
      data = JSON.parse(raw) as StatsSnapshot;
    } catch {
      return;
    }
    for (const entry of data.entries ?? []) {
      this.entries.set(entry.key, entry);
    }
  }

  private save(): void {
    if (!this.dir) {
      return;
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(), JSON.stringify(this.snapshot()));
  }

  private file(): string {
    return join(this.dir ?? '.', 'flow-stats.json');
  }
}

function statsKeys(
  flow: { id: string; version: string },
  node: FlowNode,
): string[] {
  const keys = [`node:${flow.id}@${flow.version}:${node.id}`];
  const annotations = node.annotations ?? {};
  const classKey = Object.keys(annotations)
    .sort()
    .map((key) => `${key}=${annotations[key]}`)
    .join(';');
  if (classKey) {
    keys.push(`class:${classKey}`);
  }
  return keys;
}

// The tier immediately below the human tier in the node's stack, if any. Delegation is
// measured against this tier.
function tierBelowHuman(node: FlowNode): TierKind | undefined {
  const kinds = node.tiers.map((tier) => tier.kind);
  const humanIndex = kinds.lastIndexOf('human');
  if (humanIndex <= 0) {
    return undefined;
  }
  return kinds[humanIndex - 1];
}

function sameVerdict(a: TierRun, b: TierRun): boolean {
  if (a.outcome !== b.outcome) {
    return false;
  }
  if (a.label === undefined || b.label === undefined) {
    return true;
  }
  return a.label === b.label;
}
