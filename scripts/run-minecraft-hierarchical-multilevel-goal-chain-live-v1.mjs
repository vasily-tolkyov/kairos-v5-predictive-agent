import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftHierarchicalMultilevelGoalChainLiveV1 } from
  '../dist/src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_HIERARCHICAL_MULTILEVEL_EVIDENCE_NAME
  ?? 'hierarchical-multilevel-goal-chain-live-v1-attempt-001';
if (!/^hierarchical-multilevel-goal-chain-live-v1-attempt-[0-9]{3}$/.test(evidenceName))
  throw new Error(`invalid-hierarchical-multilevel-evidence-name:${evidenceName}`);
const evidence = resolve(project, 'evidence', evidenceName);
const resumeName = process.env.KAIROS_HIERARCHICAL_MULTILEVEL_RESUME_SOURCE_NAME;
if (resumeName) throw new Error('hierarchical-multilevel-resume-is-audit-only');
const result = await runMinecraftHierarchicalMultilevelGoalChainLiveV1(
  await loadConfiguration(), evidence,
);
process.stdout.write(`${JSON.stringify({ evidence, result }, null, 2)}\n`);
