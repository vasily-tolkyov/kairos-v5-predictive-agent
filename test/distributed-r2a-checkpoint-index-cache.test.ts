import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedR2APhysicalPatternLearnerV2 }
  from '../src/core/learning/distributed-r2a-physical.js';
import type { DistributedR2APhysicalStateV3 }
  from '../src/core/learning/distributed-r2a-physical-contracts.js';
import { sha } from '../src/util.js';

test('an unchanged R2A checkpoint restores its frozen physical readout index byte-for-byte', () => {
  const source = new DistributedR2APhysicalPatternLearnerV2(() => true);
  const snapshot = source.snapshot();
  const restored = DistributedR2APhysicalPatternLearnerV2.restore(
    structuredClone(snapshot), () => true);
  assert.equal(restored.restoreIndexModeForAudit(), 'exact-cache');
  assert.equal(sha(restored.snapshot()), sha(snapshot));
});

test('a stale derived index is discarded and rediscovered without changing the physical medium', () => {
  const source = new DistributedR2APhysicalPatternLearnerV2(() => true);
  const snapshot = source.snapshot();
  const stale = structuredClone(snapshot) as DistributedR2APhysicalStateV3;
  Object.assign(stale.physicalIndexIdentity, {
    physicalIndexStateSha256: '0'.repeat(64),
  });
  const restored = DistributedR2APhysicalPatternLearnerV2.restore(stale, () => true);
  assert.equal(restored.restoreIndexModeForAudit(), 'physical-rediscovery');
  assert.equal(sha(restored.rawPhysicalMediumSnapshotForAudit()), sha(snapshot.medium));
  assert.equal(restored.patterns().length, 0);
  assert.equal(restored.relations().length, 0);
});

test('a legacy R2A V2 checkpoint is not accepted as a verified V5 index cache', () => {
  const current = new DistributedR2APhysicalPatternLearnerV2(() => true).snapshot();
  const legacy = { ...structuredClone(current), version: 'DistributedR2APhysicalStateV2' };
  assert.throws(() => DistributedR2APhysicalPatternLearnerV2.restore(
    legacy as unknown as DistributedR2APhysicalStateV3, () => true),
  /distributed-R2A-state-version-or-seed-mismatch/);
});

test('a V3 terminal-readout identity is rediscovered instead of reused as a V5 cache', () => {
  const current = new DistributedR2APhysicalPatternLearnerV2(() => true).snapshot();
  const stale = { ...structuredClone(current), physicalIndexIdentity: {
    ...current.physicalIndexIdentity,
    algorithmIdentity: 'distributed-r2a-matched-prefix-action-contrast-index-v3',
  } } as DistributedR2APhysicalStateV3;
  const restored = DistributedR2APhysicalPatternLearnerV2.restore(stale, () => true);
  assert.equal(restored.restoreIndexModeForAudit(), 'physical-rediscovery');
  assert.equal(sha(restored.rawPhysicalMediumSnapshotForAudit()), sha(current.medium));
});

test('a V4 weighted-readout identity is rediscovered instead of reused after assembly integration', () => {
  const current = new DistributedR2APhysicalPatternLearnerV2(() => true).snapshot();
  const stale = { ...structuredClone(current), physicalIndexIdentity: {
    ...current.physicalIndexIdentity,
    algorithmIdentity: 'distributed-r2a-matched-prefix-action-contrast-index-v4',
  } } as DistributedR2APhysicalStateV3;
  const restored = DistributedR2APhysicalPatternLearnerV2.restore(stale, () => true);
  assert.equal(restored.restoreIndexModeForAudit(), 'physical-rediscovery');
  assert.equal(sha(restored.rawPhysicalMediumSnapshotForAudit()), sha(current.medium));
});
