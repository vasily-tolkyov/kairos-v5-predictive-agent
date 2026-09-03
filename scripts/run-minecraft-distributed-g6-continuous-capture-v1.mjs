import { isAbsolute, relative, resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftDistributedG6ContinuousCaptureV1 } from
  '../dist/src/evaluation/minecraft-distributed-g6-continuous-capture-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);

const sourcePointer = process.env.KAIROS_DISTRIBUTED_G6_R1_BASELINE_POINTER;
if (!sourcePointer || !isAbsolute(sourcePointer))
  throw new Error('KAIROS_DISTRIBUTED_G6_R1_BASELINE_POINTER-absolute-path-required');
const evidenceName = process.env.KAIROS_DISTRIBUTED_G6_CONTINUOUS_CAPTURE_NAME;
if (!/^g6-continuous-capture-attempt-[0-9]{3}$/.test(evidenceName ?? ''))
  throw new Error('KAIROS_DISTRIBUTED_G6_CONTINUOUS_CAPTURE_NAME-invalid');
const root = resolve(project, 'evidence', 'distributed-physical-medium-v1');
const evidence = resolve(root, evidenceName);
if (relative(root, evidence).startsWith('..')) throw new Error('g6-capture-evidence-path-escaped-root');

const result = await runMinecraftDistributedG6ContinuousCaptureV1(
  await loadConfiguration(), evidence, sourcePointer);
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 2;
