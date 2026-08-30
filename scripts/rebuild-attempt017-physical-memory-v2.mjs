import { resolve } from 'node:path';
import { rebuildAttempt017PhysicalMemoryV2 } from '../dist/src/evaluation/rebuild-attempt017-physical-memory-v2.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const source = resolve(project, 'evidence',
  'minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup');
const output = resolve(project, 'evidence', 'r2-measurement-resolution-and-physical-basin-repair-v1',
  'rebuilt-attempt017-v7-action-event-measurement-v2');
const result = await rebuildAttempt017PhysicalMemoryV2(source, output);
console.log(JSON.stringify({ output, pointer: result.pointer, rawAudit: result.rawAudit,
  rebuildAudit: result.rebuildAudit }, null, 2));
