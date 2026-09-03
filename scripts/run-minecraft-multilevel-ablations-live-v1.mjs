import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { readFoundationQualificationBatchLiveV1, runMinecraftMultilevelAblationsLiveV1 } from
  '../dist/src/evaluation/minecraft-multilevel-goal-chain-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_MULTILEVEL_ABLATION_EVIDENCE_NAME ?? 'ablation-live-001';
if (!/^ablation-live-[a-zA-Z0-9-]+$/.test(evidenceName))
  throw new Error(`invalid-multilevel-ablation-evidence-name:${evidenceName}`);
const baseline = resolve(process.env.KAIROS_MULTILEVEL_BASELINE
  ?? resolve(project, 'evidence', 'minecraft-multilevel-guided-training-live-v1',
    'FROZEN_MULTILEVEL_EXPERIENCE_0256.json'));
const foundationPath = resolve(process.env.KAIROS_MULTILEVEL_FOUNDATION_RESULT
  ?? resolve(project, 'evidence', 'minecraft-multilevel-foundation-live-v1',
    'foundation-live-001', 'FOUNDATION_QUALIFICATION_BATCH.json'));
const evidence = resolve(project, 'evidence', 'minecraft-multilevel-ablation-live-v1', evidenceName);
const foundation = await readFoundationQualificationBatchLiveV1(foundationPath);
const result = await runMinecraftMultilevelAblationsLiveV1(await loadConfiguration(), evidence,
  baseline, foundation, process.env.KAIROS_MULTILEVEL_BASELINE_SHA256);
console.log(JSON.stringify({ evidence, baseline, foundationPath, passed: result.score.passed,
  mechanismAdvantages: result.score.mechanismAdvantages,
  attentionDisabledCasesPassed: result.score.attentionDisabledCasesPassed,
  violations: result.score.contractViolations }, null, 2));
