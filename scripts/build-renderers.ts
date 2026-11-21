import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const flowsDir = join(root, 'flows');
const srcDir = join(root, 'web', 'src');
const outFile = join(srcDir, 'renderers.tsx');

type Entry = {
  flowId: string;
  nodeId: string;
  componentName: string;
  importPath: string;
};

function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

function findRenderers(dir: string, segments: string[] = []): Entry[] {
  const entries: Entry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      entries.push(...findRenderers(join(dir, entry.name), [...segments, entry.name]));
    } else if (entry.name === 'renderer.tsx') {
      const flowId = segments[0];
      const nodeId = segments[segments.length - 1];
      entries.push({
        flowId,
        nodeId,
        componentName: `${pascalCase(flowId)}${pascalCase(nodeId)}`,
        importPath: join(dir, entry.name),
      });
    }
  }
  return entries;
}

const entries = findRenderers(flowsDir).sort((a, b) =>
  `${a.flowId}:${a.nodeId}`.localeCompare(`${b.flowId}:${b.nodeId}`),
);

const toImport = (fullPath: string): string => {
  const relativePath = relative(srcDir, fullPath).split(sep).join('/').replace(/\.tsx$/, '');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
};

const lines: string[] = [
  "import type { ComponentType } from 'react';",
  "import type { HumanStepRendererProps } from '@shared/renderer';",
  '',
];

for (const entry of entries) {
  lines.push(`import ${entry.componentName} from '${toImport(entry.importPath)}';`);
}

lines.push('');
lines.push('export type HumanStepRenderer = ComponentType<HumanStepRendererProps>;');
lines.push('');
lines.push('export const rendererRegistry: Record<string, HumanStepRenderer> = {');
for (const entry of entries) {
  lines.push(`  '${entry.flowId}:${entry.nodeId}': ${entry.componentName},`);
}
lines.push('};');
lines.push('');

writeFileSync(outFile, lines.join('\n'));
console.log(`built renderer registry -> ${outFile} (${entries.length} renderer${entries.length === 1 ? '' : 's'})`);
