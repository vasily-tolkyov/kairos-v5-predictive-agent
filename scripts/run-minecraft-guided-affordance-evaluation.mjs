import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftGuidedAffordanceEvaluationV1 } from '../dist/src/evaluation/minecraft-guided-affordance.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidence = resolve(project, 'evidence', 'minecraft-guided-affordance-v1');
const result = await runMinecraftGuidedAffordanceEvaluationV1(await loadConfiguration(), evidence);
console.log(JSON.stringify({ evidence, training: result.training,
  heldOutCases: result.heldOutCases.map(item => ({ layoutId: item.layoutId, status: item.status,
    actions: item.actions, controlTargetReached: item.controlTargetReached })) }, null, 2));
