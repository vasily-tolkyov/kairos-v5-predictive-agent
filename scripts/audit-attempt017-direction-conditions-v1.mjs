import { resolve } from 'node:path';
import { auditAttempt017DirectionConditionsV1 } from '../dist/src/evaluation/attempt017-direction-condition-audit-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const source = resolve(project, 'evidence',
  'minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup');
const rebuilt = resolve(project, 'evidence', 'r2-measurement-resolution-and-physical-basin-repair-v1',
  'rebuilt-attempt017-v7-action-event-measurement-v2');
const result = await auditAttempt017DirectionConditionsV1(source, resolve(rebuilt, 'experience-0128.json'),
  resolve(rebuilt, 'DIRECTION_CONDITION_AUDIT.json'));
console.log(JSON.stringify(result, null, 2));
