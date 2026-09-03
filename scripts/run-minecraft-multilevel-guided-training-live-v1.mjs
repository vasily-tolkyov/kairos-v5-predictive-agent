import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftMultilevelGuidedTrainingLiveV1 } from
  '../dist/src/evaluation/minecraft-multilevel-guided-training-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_MULTILEVEL_GUIDED_EVIDENCE_NAME
  ?? 'minecraft-multilevel-guided-training-live-v1';
if (!/^minecraft-multilevel-guided-training-live-v1(?:-[a-zA-Z0-9-]+)?$/.test(evidenceName))
  throw new Error(`invalid-multilevel-guided-evidence-name:${evidenceName}`);
const evidence = resolve(project, 'evidence', evidenceName);
const result = await runMinecraftMultilevelGuidedTrainingLiveV1(
  await loadConfiguration(), evidence);
process.stdout.write(`${JSON.stringify({ evidence, training: result.training,
  artifacts: result.artifacts, latchVerification: result.latchVerification }, null, 2)}\n`);
