import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExperiencePointer } from '../src/runtime.js';
import {
  auditDistributedG6BaselineProvenanceV1,
  computeDistributedProductionSourceIdentityV1,
} from '../src/evaluation/minecraft-distributed-g6-live-v1.js';
import {
  createDistributedG6ProvenanceV1,
  DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1,
} from '../src/runtime.js';

function pointer(provenance: ExperiencePointer['distributedG6Provenance']): ExperiencePointer {
  return { runtimeVersion: 'KairosV5DistributedPhysicalRuntimeV1',
    sourceContextVersion: 'V5PublicRelativeLayoutV1', filename: 'experience-0256.json',
    sha256: 'a'.repeat(64), habitFilename: 'control-habit-0256.json',
    habitSha256: 'b'.repeat(64), actions: 256, eventCount: 256, writes: 256,
    ...(provenance === undefined ? {} : { distributedG6Provenance: provenance }) };
}

test('G6 baseline provenance is required and cryptographically self-consistent', () => {
  const missing = auditDistributedG6BaselineProvenanceV1(pointer(undefined));
  assert.equal(missing.valid, false);
  assert.ok(missing.blockers.includes('distributed-g6-baseline-provenance-missing'));
  const valid = createDistributedG6ProvenanceV1({
    version: 'DistributedG6ExperienceProvenanceV1', producer: 'trusted-r1-rebuild-v1',
    producerIdentitySha256: DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1,
    sourceId: 'hierarchical-multilevel-goal-chain-live-v1-attempt-018',
    sourceEventsSha256: 'c'.repeat(64),
  });
  const accepted = auditDistributedG6BaselineProvenanceV1(pointer(valid));
  assert.equal(accepted.valid, true);
  assert.equal(accepted.producer, 'trusted-r1-rebuild-v1');
  const altered = { ...valid, sourceEventsSha256: 'd'.repeat(64) };
  const rejected = auditDistributedG6BaselineProvenanceV1(pointer(altered));
  assert.equal(rejected.valid, false);
  assert.ok(rejected.blockers.includes('distributed-g6-provenance-commitment-mismatch'));
});

test('G6 production identity includes both baseline producers without generated dist artifacts', async () => {
  const identity = await computeDistributedProductionSourceIdentityV1(process.cwd());
  const paths = new Set(identity.files.map(value => value.path));
  assert.ok(paths.has('src/evaluation/minecraft-distributed-g6-continuous-capture-v1.ts'));
  assert.ok(paths.has('src/evaluation/rebuild-minecraft-distributed-g6-r1-baseline-v1.ts'));
  assert.ok(paths.has('scripts/run-minecraft-distributed-g6-continuous-capture-v1.mjs'));
  assert.ok(paths.has('scripts/rebuild-minecraft-distributed-g6-r1-baseline-v1.mjs'));
  assert.equal([...paths].some(path => path.startsWith('dist/')), false);
});
