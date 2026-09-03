import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { scanAnonymousPhysicalStructureV1 }
  from '../src/core/physics/distributed-physical-structure-scanner.js';

const PREFIX = [0, 1, 33, 32] as const;
const LEFT = [100, 101, 133, 132] as const;
const RIGHT = [200, 201, 233, 232] as const;
const EARLY_PREFIX = [300, 301, 333, 332] as const;
const UNRELATED_PREFIX = [1000, 1001, 1033, 1032] as const;
const UNRELATED_TERMINAL = [1100, 1101, 1133, 1132] as const;

function episode(traceId: string, pulses: readonly (readonly number[])[]): DistributedEpisodeV1 {
  return { version: 'DistributedEpisodeV1', traceId, provenance: 'trusted-real-event',
    pulses: pulses.map((siteIds, index) => ({ version: 'SparseFieldPulseV1',
      pulseId: `${traceId}:${index}`, offset: index * .04,
      drives: siteIds.map(siteId => ({ siteId, intensity: 1 })) })) };
}

function twoBranchMedium(reverse = false): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'anonymous-scan', seedHex: '1122aabbccdd3344' });
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode(episode(`opaque-a-${repetition}`, reverse ? [LEFT, PREFIX] : [PREFIX, LEFT]));
    medium.applyEpisode(episode(`opaque-b-${repetition}`, reverse ? [RIGHT, PREFIX] : [PREFIX, RIGHT]));
  }
  return medium;
}

function twoLevelBranchMedium(): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'anonymous-scan', seedHex: '1122aabbccdd3344' });
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode(episode(`two-level-a-${repetition}`, [EARLY_PREFIX, PREFIX, LEFT]));
    medium.applyEpisode(episode(`two-level-b-${repetition}`, [EARLY_PREFIX, PREFIX, RIGHT]));
  }
  return medium;
}

test('anonymous structural scan finds two terminal basins reached through one shared-prefix corridor', () => {
  const scan = scanAnonymousPhysicalStructureV1(twoBranchMedium().snapshot());
  assert.equal(scan.terminalAttractors.length, 2, JSON.stringify(scan));
  assert.equal(scan.sharedPrefixCorridors.length, 1, JSON.stringify(scan));
  const corridor = scan.sharedPrefixCorridors[0]!;
  assert.deepEqual(corridor.prefixCoreSiteIds, [...PREFIX].sort((left, right) => left - right));
  assert.equal(corridor.terminalAttractorIds.length, 2);
  assert(corridor.forwardConductance > 0);
  assert.equal(corridor.reverseConductance, 0);
  assert.equal(corridor.reverseRejectionRate, 1);
});

test('renaming or deleting audit metadata cannot change an anonymous physical scan', () => {
  const snapshot = twoBranchMedium().snapshot();
  const metadataAblated: DistributedMediumSnapshotV1 = { ...snapshot, bindings: [], footprints: [] };
  assert.deepEqual(scanAnonymousPhysicalStructureV1(metadataAblated),
    scanAnonymousPhysicalStructureV1(snapshot));
});

test('reversing temporal channels or cutting them removes the shared-prefix branch capability', () => {
  const reversed = scanAnonymousPhysicalStructureV1(twoBranchMedium(true).snapshot());
  assert.equal(reversed.terminalAttractors.length, 1);
  assert.equal(reversed.sharedPrefixCorridors.length, 0);

  const snapshot = twoBranchMedium().snapshot();
  const cut: DistributedMediumSnapshotV1 = { ...snapshot,
    learnedBonds: snapshot.learnedBonds.filter(bond => bond.kind !== 'plastic-directed') };
  const disconnected = scanAnonymousPhysicalStructureV1(cut);
  assert.equal(disconnected.terminalAttractors.length, 0);
  assert.equal(disconnected.sharedPrefixCorridors.length, 0);
});

test('the anonymous scanner is byte-stable for an identical fixed-seed substrate', () => {
  assert.deepEqual(scanAnonymousPhysicalStructureV1(twoBranchMedium().snapshot()),
    scanAnonymousPhysicalStructureV1(twoBranchMedium().snapshot()));
});

test('a locally repeated branch does not disappear when an unrelated assembly is much stronger', () => {
  const medium = twoBranchMedium();
  const before = scanAnonymousPhysicalStructureV1(medium.snapshot());
  assert.equal(before.terminalAttractors.length, 2, JSON.stringify(before));
  for (let repetition = 0; repetition < 64; repetition += 1)
    medium.applyEpisode(episode(`unrelated-dominant-${repetition}`,
      [UNRELATED_PREFIX, UNRELATED_TERMINAL]));
  const after = scanAnonymousPhysicalStructureV1(medium.snapshot());
  const originalTerminalSites = new Set<number>([...LEFT, ...RIGHT]);
  const preserved = after.terminalAttractors.filter(value =>
    value.coreSiteIds.some(siteId => originalTerminalSites.has(siteId)));
  assert.equal(preserved.length, 2,
    `an unrelated stronger assembly erased locally repeated physical branches: ${JSON.stringify({
      thresholds: after.thresholds,
      terminals: after.terminalAttractors,
    })}`);
});

test('a singleton remains below structural qualification while the second local repeat becomes visible', () => {
  const medium = new DistributedPhysicalMedium3DV1({
    name: 'anonymous-scan', seedHex: '1122aabbccdd3344',
  });
  medium.applyEpisode(episode('singleton-0', [PREFIX, LEFT]));
  const singleton = scanAnonymousPhysicalStructureV1(medium.snapshot());
  assert.equal(singleton.qualifiedSiteCount, 0);
  assert.equal(singleton.terminalAttractors.length, 0);
  medium.applyEpisode(episode('singleton-1', [PREFIX, LEFT]));
  const repeated = scanAnonymousPhysicalStructureV1(medium.snapshot());
  assert(repeated.qualifiedSiteCount > 0);
  assert.equal(repeated.terminalAttractors.length, 1, JSON.stringify(repeated));
});

test('the absolute local provisional floor preserves an earlier physical ancestor corridor', () => {
  const snapshot = twoLevelBranchMedium().snapshot();
  const scan = scanAnonymousPhysicalStructureV1(snapshot);
  const branchConductance = snapshot.learnedBonds
    .filter(bond => bond.kind === 'plastic-directed'
      && PREFIX.includes(bond.fromSiteId as typeof PREFIX[number])
      && (LEFT.includes(bond.toSiteId as typeof LEFT[number])
        || RIGHT.includes(bond.toSiteId as typeof RIGHT[number])))
    .map(bond => bond.directedConductance);
  assert(branchConductance.length > 0);
  assert.equal(scan.thresholds.directedConductance, snapshot.config.directedLearningRate * 2);
  assert(branchConductance.every(value => value >= scan.thresholds.directedConductance),
    'a repeated branch channel fell below the substrate activity floor');
  assert.equal(scan.terminalAttractors.length, 2, JSON.stringify(scan));
  assert.equal(scan.sharedPrefixCorridors.length, 2, JSON.stringify(scan));
  assert.deepEqual(scan.sharedPrefixCorridors.map(value => value.prefixCoreSiteIds), [
    [...PREFIX].sort((left, right) => left - right),
    [...EARLY_PREFIX].sort((left, right) => left - right),
  ], 'a temporally earlier physical ancestor that reaches both terminals was discarded');
});
