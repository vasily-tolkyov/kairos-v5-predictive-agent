import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftJointControlHeldoutBatchV2 } from '../dist/src/evaluation/minecraft-joint-control-heldout-v2.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_HELDOUT_EVIDENCE_NAME ?? 'minecraft-heldout-batch-001';
if (!/^minecraft-heldout-batch-[a-zA-Z0-9-]+$/.test(evidenceName))
  throw new Error(`invalid-heldout-evidence-name:${evidenceName}`);
const evidence = resolve(project, 'evidence', 'joint-physical-control-field-v2', evidenceName);
const baseline = resolve(project, 'evidence', 'r2-measurement-resolution-and-physical-basin-repair-v1',
  'rebuilt-attempt017-v7-action-event-measurement-v2', 'experience-0128.json');
const result = await runMinecraftJointControlHeldoutBatchV2(await loadConfiguration(), evidence, baseline);
console.log(JSON.stringify({ evidence, passed: result.passed,
  cases: result.cases.map(value => ({ caseId: value.caseId, status: value.status,
    controllerStatus: value.controllerStatus, actions: value.actions,
    attentionNoticeCount: value.attentionNoticeCount })) }, null, 2));
