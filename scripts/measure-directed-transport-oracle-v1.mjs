import { writeFile } from 'node:fs/promises';
import { DistributedPhysicalMedium3DV1 as Medium } from '../dist/src/core/physics/distributed-physical-medium.js';
import { canonical, sha } from '../dist/src/util.js';
const medium = new Medium({ name: 'directed-transport-exact-oracle', seedHex: '1204' });
const populations = [16, 768, 1536, 2048].map((base, p) => Array.from({ length: 24 }, (_, i) => ({
  siteId: base + i, intensity: .2 + ((i + p) % 5) * .16,
})));
for (let n = 0; n < 12; n++) {
  const route = n % 3 === 0 ? [0, 1, 2, 0] : n % 3 === 1 ? [0, 2, 3, 0] : [3, 2, 1, 0];
  medium.applyEpisode({ version: 'DistributedEpisodeV1', traceId: `real-${n}`,
    provenance: 'trusted-real-event', pulses: route.map((p, index) => ({
      version: 'SparseFieldPulseV1', offset: index * .1, drives: populations[p],
    })) });
}
medium.recover(.4);
const frozen = medium.snapshot();
const results = [];
const started = performance.now();
for (let i = 0; i < 8; i++) {
  const copy = Medium.fromSnapshot(frozen);
  const condition = i % 2 === 0 ? [] : populations[2];
  const route = i % 3 === 0 ? [populations[0], populations[1]] : [populations[3]];
  const result = condition.length ? copy.probeConditionedSequence(condition, route, BigInt(i + 41), 180)
    : copy.probeSequential(route, BigInt(i + 41), 180);
  results.push({ seed: i + 41, sha256: sha(result), accepted: result.run.acceptedSteps,
    rejected: result.run.rejectedSteps, mass: result.run.directedTransportMass });
  if (sha(copy.snapshot()) !== sha(frozen)) throw new Error('oracle-query-mutated-medium');
}
const result = { name: 'directed-transport-exact-oracle', beforeSha256: sha(frozen),
  results, durationMs: performance.now() - started };
if (!process.argv[2]) throw new Error('new-oracle-output-required');
await writeFile(process.argv[2], canonical(result), { flag: 'wx' });
console.log(canonical(result));
