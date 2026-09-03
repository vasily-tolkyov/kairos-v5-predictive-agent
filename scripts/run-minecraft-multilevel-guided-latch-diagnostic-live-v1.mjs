import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftMultilevelGuidedLatchDiagnosticLiveV1 } from
  '../dist/src/evaluation/minecraft-multilevel-guided-training-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_MULTILEVEL_LATCH_DIAGNOSTIC_EVIDENCE_NAME
  ?? 'minecraft-multilevel-guided-latch-diagnostic-live-v1';
if (!/^minecraft-multilevel-guided-latch-diagnostic-live-v1(?:-[a-zA-Z0-9-]+)?$/.test(evidenceName))
  throw new Error(`invalid-multilevel-latch-diagnostic-evidence-name:${evidenceName}`);
const evidence = resolve(project, 'evidence', evidenceName);
const result = await runMinecraftMultilevelGuidedLatchDiagnosticLiveV1(
  await loadConfiguration(), evidence);
process.stdout.write(`${JSON.stringify({ evidence, result }, null, 2)}\n`);
