import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedBondStateV1, DistributedMediumSnapshotV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { sha } from '../src/util.js';

const CONDITION = [0, 1] as const;
const PREFIX = [100, 101] as const;
const ACTION = [200, 201] as const;
const TERMINAL = [300, 301] as const;

function local(left: number, right: number): DistributedBondStateV1 {
  return { fromSiteId: left, toSiteId: right, symmetricCoupling: 1,
    directedConductance: 0, supportMass: 8, lastUpdatedAt: 0, kind: 'local' };
}

function directed(left: number, right: number): DistributedBondStateV1 {
  return { fromSiteId: left, toSiteId: right, symmetricCoupling: 0,
    directedConductance: 1, supportMass: 8, lastUpdatedAt: 0, kind: 'plastic-directed' };
}

function conditionedRoad(): DistributedMediumSnapshotV1 {
  const empty = new DistributedPhysicalMedium3DV1({ name: 'conditioned-boundary' }).snapshot();
  const active = new Set<number>([...CONDITION, ...PREFIX, ...ACTION, ...TERMINAL]);
  return { ...empty,
    sites: empty.sites.map(site => ({ ...site,
      potentialDepth: active.has(site.siteId) ? 8 : 0,
      supportMass: active.has(site.siteId) ? 8 : 0,
      activation: 0 })),
    learnedBonds: [
      local(CONDITION[0], CONDITION[1]), local(PREFIX[0], PREFIX[1]),
      local(ACTION[0], ACTION[1]), local(TERMINAL[0], TERMINAL[1]),
      directed(CONDITION[0], TERMINAL[0]), directed(CONDITION[1], TERMINAL[1]),
      directed(PREFIX[0], ACTION[0]), directed(PREFIX[1], ACTION[1]),
      directed(ACTION[0], TERMINAL[0]), directed(ACTION[1], TERMINAL[1]),
    ] };
}

test('a current R3 population remains a read-only boundary drive and is not decoded as its own result', () => {
  const medium = DistributedPhysicalMedium3DV1.fromSnapshot(conditionedRoad());
  const before = sha(medium.snapshot());
  const readout = medium.probeConditionedSequence(CONDITION, [PREFIX, ACTION], 11n, 180);
  assert.equal(readout.ambiguous, false);
  assert(readout.coreSiteIds.every(siteId => TERMINAL.includes(siteId as 300 | 301)),
    `current condition or an intermediate population leaked into terminal readout: ${readout.coreSiteIds}`);
  assert(readout.coreSiteIds.length > 0, 'conditioned rollout never reached its terminal basin');
  assert.equal(readout.coreSiteIds.some(siteId => CONDITION.includes(siteId as 0 | 1)), false,
    'the externally held R3 condition was decoded as a predicted result');
  assert.equal(sha(medium.snapshot()), before, 'conditioned query wrote into the production medium');
});

test('conditioned queries reject ambiguous boundary populations instead of silently normalizing them', () => {
  const medium = DistributedPhysicalMedium3DV1.fromSnapshot(conditionedRoad());
  assert.throws(() => medium.probeConditionedSequence([0, 0], [PREFIX, ACTION], 1n, 180),
    /non-empty unique condition population/);
  assert.throws(() => medium.probeConditionedSequence([], [PREFIX, ACTION], 1n, 180),
    /non-empty unique condition population/);
});
