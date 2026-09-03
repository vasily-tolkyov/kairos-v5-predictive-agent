import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftHierarchicalContinuousBridgeContinuationLiveV1 } from
  '../dist/src/evaluation/minecraft-hierarchical-continuous-bridge-continuation-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_CONTINUOUS_BRIDGE_EVIDENCE_NAME
  ?? 'hierarchical-continuous-bridge-curriculum-live-v1-attempt-001';
if (!/^hierarchical-continuous-bridge-curriculum-live-v1-attempt-[0-9]{3}$/.test(evidenceName))
  throw new Error(`invalid-continuous-bridge-evidence-name:${evidenceName}`);
const sourceName = process.env.KAIROS_CONTINUOUS_BRIDGE_SOURCE_NAME
  ?? 'hierarchical-multilevel-goal-chain-live-v1-attempt-017';
if (!/^hierarchical-multilevel-goal-chain-live-v1-attempt-[0-9]{3}$/.test(sourceName))
  throw new Error(`invalid-continuous-bridge-source-name:${sourceName}`);
const result = await runMinecraftHierarchicalContinuousBridgeContinuationLiveV1(
  await loadConfiguration(), resolve(project, 'evidence', evidenceName),
  resolve(project, 'evidence', sourceName));
process.stdout.write(`${JSON.stringify({ evidenceName, sourceName, result }, null, 2)}\n`);
