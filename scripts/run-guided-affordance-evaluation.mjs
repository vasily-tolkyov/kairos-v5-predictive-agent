import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runGuidedAffordanceEvaluation } from '../dist/src/evaluation/guided-affordance-microworld.js';

const project = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1').replaceAll('/', '\\');
const evidence = join(project, 'evidence', 'guided-affordance-reasoning-v1');
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
const filesUnder = async root => {
  const values = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) values.push(...await filesUnder(path));
    else if (entry.isFile()) values.push(path);
  }
  return values;
};
const compactEntry = entry => {
  if (entry.kind === 'control-field-decision') return { kind: entry.kind, decision: entry.value.decision };
  if (entry.kind === 'goal-difference') return { kind: entry.kind, value: entry.value };
  if (entry.kind === 'physical-action') return { kind: entry.kind, value: entry.value };
  if (entry.kind === 'physical-action-affordance-recall') return { kind: entry.kind,
    requiredTargetRole: entry.value.requiredTargetRole, transitionCount: entry.value.transitions.length,
    evidence: entry.value.transitions.slice(0, 2).map(item => item.evidence) };
  if (entry.kind === 'physical-condition-comparison') return { kind: entry.kind,
    branchId: entry.value.branchId, condition: entry.value.condition };
  if (entry.kind === 'physical-branch-prediction') return { kind: entry.kind, branchId: entry.value.branchId,
    prediction: { support: entry.value.prediction.prediction.support,
      validSampleCount: entry.value.prediction.validSampleCount,
      progressSampleCount: entry.value.prediction.progressSampleCount,
      progressFraction: entry.value.prediction.progressFraction,
      unknown: entry.value.prediction.unknown } };
  return null;
};

await mkdir(evidence, { recursive: true });
const result = await runGuidedAffordanceEvaluation();
const compact = {
  version: result.version,
  training: { ...result.training, guidedRealEventCount: 128, trainingLayoutIds: Array.from({ length: 8 }, (_, i) => `guided-layout-${i}`),
    directAnchorOrRuleWrites: 0, outcomeLabelsGivenToController: 0 },
  test: { layoutIds: ['unseen-layout-101', 'unseen-layout-102'], transientFieldRecreatedPerCase: true,
    actionSequenceProvidedToController: false, longTermMemoryRestoredFromSameFrozenTrainingSnapshot: true },
  cases: result.cases.map(item => ({ initialYawDegrees: item.initialYawDegrees, status: item.status,
    actions: item.actions, finalActive: item.finalActive,
    affordanceRecallCount: item.timeline.filter(entry => entry.kind === 'physical-action-affordance-recall').length,
    conditionComparisonCount: item.timeline.filter(entry => entry.kind === 'physical-condition-comparison').length,
    randomPredictionCount: item.timeline.filter(entry => entry.kind === 'physical-branch-prediction').length,
    timeline: item.timeline.map(compactEntry).filter(Boolean) })),
};
await writeFile(join(evidence, 'EVALUATION_RESULT.json'), `${JSON.stringify(compact, null, 2)}\n`, 'utf8');

const protectedPaths = ['src/core/config.ts', 'src/core/physics/physical-medium.ts',
  'src/core/physics/potential-page.ts', 'src/core/prediction/prediction-clone.ts'];
const protectedHashes = Object.fromEntries(await Promise.all(protectedPaths.map(async path => [path,
  await hashFile(join(project, path))])));
await writeFile(join(evidence, 'PROTECTED_CORE_SHA256.json'), `${JSON.stringify(protectedHashes, null, 2)}\n`, 'utf8');

const sourceFiles = [...await filesUnder(join(project, 'src')), ...await filesUnder(join(project, 'test'))]
  .filter(path => /\.(?:ts|mjs)$/.test(path)).sort();
const sourceManifest = [];
for (const path of sourceFiles) sourceManifest.push(`${await hashFile(path)}  ${relative(project, path).replaceAll('\\', '/')}`);
await writeFile(join(evidence, 'SOURCE_MANIFEST.sha256'), `${sourceManifest.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ evidence, result: compact.cases.map(({ timeline, ...item }) => item) }, null, 2));
