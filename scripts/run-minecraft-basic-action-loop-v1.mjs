import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/adapters/minecraft/index.js';
import { runMinecraftBasicActionLoopV1 } from '../dist/src/evaluation/minecraft-basic-action-loop-v1.js';

const evidence = resolve(process.argv[2] ?? 'evidence/minecraft-basic-action-loop-v1');
const config = await loadConfiguration();
const result = await runMinecraftBasicActionLoopV1(config, evidence);
console.log(JSON.stringify(result));
