import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compute } from '../dist/src/compute.js';
import {
  collectHierarchicalMultilevelQualificationLiveV1,
  hierarchicalMultilevelBridgeTargetArmLiveV1,
  minecraftHierarchicalMultilevelQualificationGateLiveV1,
} from '../dist/src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.js';
import { assert, canonical, fileSha, saveJson, sha } from '../dist/src/util.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.argv[2]
  ?? 'hierarchical-multilevel-goal-chain-live-v1-attempt-017';
if (!/^hierarchical-multilevel-goal-chain-live-v1-attempt-[0-9]{3}$/.test(evidenceName))
  throw new Error(`invalid-hierarchical-multilevel-evidence-name:${evidenceName}`);

const evidenceDirectory = resolve(project, 'evidence', evidenceName);
const snapshotPath = resolve(evidenceDirectory,
  'REBUILT_ROLE_BOUND_HIERARCHICAL_EXPERIENCE.json');
const probesPath = resolve(evidenceDirectory, 'GATE_D_PROBES.json');
const evidencePath = resolve(evidenceDirectory, 'GATE_D_EVIDENCE.json');
const resultPath = resolve(evidenceDirectory, 'GATE_D_RESULT.json');
const auditPath = resolve(evidenceDirectory, 'GATE_D_OFFLINE_PARALLEL_AUDIT.json');

for (const target of [evidencePath, resultPath, auditPath]) {
  try {
    await access(target);
    throw new Error(`offline-gate-output-already-exists:${target}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('offline-gate-output-already-exists:'))
      throw error;
  }
}

const snapshotBytesBefore = await fileSha(snapshotPath);
const probesBytesBefore = await fileSha(probesPath);
const frozen = JSON.parse(await readFile(snapshotPath, 'utf8'));
const probes = JSON.parse(await readFile(probesPath, 'utf8'));
assert(frozen.version === 'KairosV5HierarchicalMemoryV10',
  'offline-gate-requires-role-bound-V10-snapshot');
assert(Array.isArray(probes) && probes.length === 7,
  'offline-gate-requires-seven-sealed-probes');

async function runJob(id, selectedProbes) {
  const compute = new Compute();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    await compute.call('restore', frozen);
    const restoredHash = await compute.call('hash');
    assert(restoredHash === sha(frozen), `offline-gate-restore-hash-mismatch:${id}`);
    const value = await collectHierarchicalMultilevelQualificationLiveV1(
      compute, frozen, selectedProbes);
    const finalHash = await compute.call('hash');
    assert(finalHash === restoredHash, `offline-gate-query-mutated-snapshot:${id}`);
    return Object.freeze({ id, probeIds: Object.freeze(selectedProbes.map(probe => probe.comparison.id)),
      startedAt, completedAt: new Date().toISOString(), durationMilliseconds: performance.now() - started,
      restoredHash, finalHash, value });
  } finally {
    await compute.close();
  }
}

// Each single-probe job computes exactly one production arm and its contrast.
// The two bridge jobs contain only the forward prerequisite plus the relevant
// factor-transition arm.  Every job owns a restored read-only physical worker;
// no result is shared between workers or written back to the frozen snapshot.
const singleJobs = probes.map(probe => ({ id: `arm-${probe.comparison.id}`, probes: [probe] }));
const forward = probes.find(probe => probe.comparison.id === 'forward-clear-vs-blocked');
assert(forward, 'offline-gate-forward-probe-missing');
const bridgeJobs = ['forward-blocked-to-left', 'forward-blocked-to-right'].map(id => {
  const targetArm = hierarchicalMultilevelBridgeTargetArmLiveV1(id);
  const target = probes.find(probe => probe.comparison.targetArm === targetArm);
  assert(target, `offline-gate-bridge-target-probe-missing:${id}`);
  return { id: `bridge-${id}`, bridgeId: id, probes: [forward, target] };
});
const jobs = await Promise.all([...singleJobs, ...bridgeJobs]
  .map(job => runJob(job.id, job.probes)));

const singles = jobs.slice(0, singleJobs.length);
const bridgeResults = jobs.slice(singleJobs.length);
const representation = singles[0].value.representation;
for (const job of jobs)
  assert(canonical(job.value.representation) === canonical(representation),
    `offline-gate-representation-disagrees:${job.id}`);

const arms = singles.flatMap(job => job.value.arms);
const contrasts = singles.flatMap(job => job.value.contrasts);
const bridges = bridgeJobs.map((job, index) => {
  const value = bridgeResults[index].value.bridges.find(bridge => bridge.id === job.bridgeId);
  assert(value, `offline-gate-bridge-result-missing:${job.bridgeId}`);
  return value;
});
assert(new Set(arms.map(value => value.arm)).size === 7,
  'offline-gate-production-arm-merge-incomplete');
assert(new Set(contrasts.map(value => value.arm)).size === 7,
  'offline-gate-contrast-arm-merge-incomplete');

const qualificationEvidence = Object.freeze({
  version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1',
  representation,
  arms: Object.freeze(arms),
  contrasts: Object.freeze(contrasts),
  bridges: Object.freeze(bridges),
  queryChangedSnapshot: jobs.some(job => job.value.queryChangedSnapshot),
});
const qualification = minecraftHierarchicalMultilevelQualificationGateLiveV1(qualificationEvidence);

const snapshotBytesAfter = await fileSha(snapshotPath);
const probesBytesAfter = await fileSha(probesPath);
assert(snapshotBytesAfter === snapshotBytesBefore, 'offline-gate-snapshot-file-mutated');
assert(probesBytesAfter === probesBytesBefore, 'offline-gate-probes-file-mutated');
await saveJson(evidencePath, qualificationEvidence);
await saveJson(resultPath, qualification);
await saveJson(auditPath, {
  version: 'HierarchicalMultilevelOfflineParallelGateAuditV1',
  evidenceName,
  executionMode: 'offline-parallel-read-only-physical-workers',
  minecraftConnected: false,
  snapshotPath,
  snapshotFileSha256: snapshotBytesBefore,
  snapshotCanonicalSha256: sha(frozen),
  probesPath,
  probesFileSha256: probesBytesBefore,
  probeCount: probes.length,
  jobs: jobs.map(job => ({ id: job.id, probeIds: job.probeIds,
    startedAt: job.startedAt, completedAt: job.completedAt,
    durationMilliseconds: job.durationMilliseconds,
    restoredHash: job.restoredHash, finalHash: job.finalHash })),
  merge: { productionArms: arms.length, contrastArms: contrasts.length,
    factorBridges: bridges.length, queryChangedSnapshot: qualificationEvidence.queryChangedSnapshot },
  qualification,
});
process.stdout.write(`${JSON.stringify({ evidenceDirectory, qualification,
  snapshotSha256: snapshotBytesBefore, probesSha256: probesBytesBefore,
  jobs: jobs.map(job => ({ id: job.id, durationMilliseconds: job.durationMilliseconds })) }, null, 2)}\n`);
