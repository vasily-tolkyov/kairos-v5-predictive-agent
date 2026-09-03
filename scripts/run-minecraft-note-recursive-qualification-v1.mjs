import { resolve } from 'node:path';
import { runMinecraftNoteRecursiveQualificationV1 } from '../dist/src/evaluation/minecraft-note-recursive-qualification-v1.js';
import { loadConfiguration } from '../dist/src/services.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_NOTE_RECURSIVE_EVIDENCE_NAME ?? 'minecraft-note-recursive-qualification-001';
if (!/^minecraft-note-recursive-qualification-[a-zA-Z0-9-]+$/.test(evidenceName))
  throw new Error(`invalid-note-recursive-evidence-name:${evidenceName}`);
const configuredBudget = process.env.KAIROS_NOTE_RECURSIVE_ACTION_BUDGET;
const actionBudget = configuredBudget === undefined ? undefined : Number(configuredBudget);
const evidence = resolve(project, 'evidence', 'minecraft-note-recursive-qualification-v1', evidenceName);
const baselinePath = resolve(project, 'evidence', 'r2-measurement-resolution-and-physical-basin-repair-v1',
  'rebuilt-attempt017-v7-action-event-measurement-v2', 'experience-0128.json');
const result = await runMinecraftNoteRecursiveQualificationV1(await loadConfiguration(), evidence,
  { baselinePath, ...(actionBudget === undefined ? {} : { actionBudget }) });
console.log(JSON.stringify({ evidence, passed: result.passed, failure: result.failure,
  controllerStatus: result.controllerStatus, actionsExecuted: result.actionsExecuted,
  actionBudget: result.actionBudget, baselineUnchanged:
    result.baseline.fileSha256Before === result.baseline.fileSha256After,
  milestones: result.score?.milestones ?? null }, null, 2));
if (!result.passed) process.exitCode = 1;
