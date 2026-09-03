import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  buildDistributedG5PreInterventionBaselineV1,
  consolidateDistributedG5InterventionsV1,
  validateDistributedG5SharedBaselineV1,
  runDistributedG5NeutralCanaryV1,
  runDistributedG5NeutralCanaryWithBaselineV1,
  runDistributedG5NeutralMatrixV1,
  runDistributedG5NeutralMatrixWithBaselineV1,
} from '../dist/src/evaluation/distributed-g5-neutral-control-v1.js';

const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'canary' },
  depth: { type: 'string', default: '2' },
  variant: { type: 'string', default: '0' },
  seed: { type: 'string', default: '0' },
  output: { type: 'string' },
  prebaseline: { type: 'string' },
  baseline: { type: 'string' },
  'baseline-output': { type: 'string' },
} });

if (!['prepare', 'canary', 'matrix'].includes(values.mode))
  throw new Error('mode-must-be-prepare-canary-or-matrix');
const depth = Number(values.depth), variantIndex = Number(values.variant), seedIndex = Number(values.seed);
if (depth !== 2 && depth !== 3) throw new Error('depth-must-be-2-or-3');
if (![variantIndex, seedIndex].every(Number.isInteger))
  throw new Error('variant-and-seed-must-be-integers');

async function writeFrozenGzip(path, value) {
  const output = resolve(path);
  try { await access(output); throw new Error(`refusing-to-overwrite:${output}`); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('refusing-to-overwrite:')) throw error;
  }
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 }), { flag: 'wx' });
  await rename(temporary, output);
}

async function writeFrozenJson(path, value) {
  const output = resolve(path);
  try { await access(output); throw new Error(`refusing-to-overwrite:${output}`); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('refusing-to-overwrite:')) throw error;
  }
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, output);
}

async function readFrozenGzip(path) {
  return JSON.parse(gunzipSync(await readFile(resolve(path))).toString('utf8'));
}

if (values.mode === 'prepare') {
  if (!values.output) throw new Error('prepare-requires-output');
  const started = performance.now();
  const pre = buildDistributedG5PreInterventionBaselineV1();
  await writeFrozenGzip(values.output, pre);
  process.stdout.write(`${JSON.stringify({ version: pre.version, mode: values.mode,
    snapshotSha256: pre.snapshotSha256, interventionPlans: pre.interventionPlans.length,
    patternCount: pre.snapshot.r2a.patterns.length, relationCount: pre.snapshot.r2a.relations.length,
    durationMs: performance.now() - started }, null, 2)}\n`);
  process.exit(0);
}

let baseline = values.baseline ? await readFrozenGzip(values.baseline) : null;
if (baseline) validateDistributedG5SharedBaselineV1(baseline);
if (values.prebaseline) {
  if (baseline) throw new Error('g5-use-either-prebaseline-or-baseline');
  baseline = consolidateDistributedG5InterventionsV1(await readFrozenGzip(values.prebaseline));
  validateDistributedG5SharedBaselineV1(baseline);
}
if (baseline && values['baseline-output']) await writeFrozenGzip(values['baseline-output'], baseline);

const result = values.mode === 'matrix'
  ? (baseline ? await runDistributedG5NeutralMatrixWithBaselineV1(baseline)
    : await runDistributedG5NeutralMatrixV1())
  : (baseline ? await runDistributedG5NeutralCanaryWithBaselineV1(baseline,
      { depth, variantIndex, seedIndex })
    : await runDistributedG5NeutralCanaryV1({ depth, variantIndex, seedIndex }));

if (values.output) {
  await writeFrozenJson(values.output, result);
}

const summary = values.mode === 'matrix'
  ? { version: result.version, mode: values.mode, caseCount: result.caseCount,
      twoStepPassed: result.twoStepPassed, threeStepPassed: result.threeStepPassed,
      fullMatrixPassed: result.fullMatrixPassed, totalDurationMs: result.totalDurationMs }
  : { version: result.version, mode: values.mode, baselineBuildMs: result.baselineBuildMs,
      caseId: result.case.caseId, passed: result.case.passed,
      status: result.case.result?.status ?? null, error: result.case.error,
      durationMs: result.case.durationMs,
      physicalPredictionInvocations: result.case.physicalPredictionInvocations,
      physicalPredictionMicrosteps: result.case.physicalPredictionMicrosteps };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = values.mode === 'matrix'
  ? (result.fullMatrixPassed ? 0 : 1) : (result.case.passed ? 0 : 1);
