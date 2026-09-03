import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftFoundationQualificationBatchLiveV1 } from
  '../dist/src/evaluation/minecraft-multilevel-goal-chain-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_MULTILEVEL_FOUNDATION_EVIDENCE_NAME ?? 'foundation-live-001';
if (!/^foundation-live-[a-zA-Z0-9-]+$/.test(evidenceName))
  throw new Error(`invalid-multilevel-foundation-evidence-name:${evidenceName}`);
const baseline = resolve(process.env.KAIROS_MULTILEVEL_BASELINE
  ?? resolve(project, 'evidence', 'minecraft-multilevel-guided-training-live-v1',
    'FROZEN_MULTILEVEL_EXPERIENCE_0256.json'));
const evidence = resolve(project, 'evidence', 'minecraft-multilevel-foundation-live-v1', evidenceName);
const result = await runMinecraftFoundationQualificationBatchLiveV1(
  await loadConfiguration(), evidence, baseline, process.env.KAIROS_MULTILEVEL_BASELINE_SHA256);
console.log(JSON.stringify({ evidence, baseline, passed: result.passed,
  cases: result.cases.length, failedCases: result.cases.filter(value => !value.score.passed)
    .map(value => ({ caseId: value.specificationId, failure: value.score.failure })) }, null, 2));
