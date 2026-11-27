import { StatsStore } from '../stats.js';
import { createApp } from './app.js';
import { runStoreRoot, statsRoot } from './paths.js';
import { RunStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp({
  runStore: new RunStore(runStoreRoot()),
  stats: new StatsStore({ dir: statsRoot() }),
});

await app.listen({ port, host });
console.log(`flow server listening on http://${host}:${port}`);
