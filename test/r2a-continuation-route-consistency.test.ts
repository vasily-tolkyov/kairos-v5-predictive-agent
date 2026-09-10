import assert from 'node:assert/strict';
import test from 'node:test';
import { continuationCandidateForInputV1 } from '../src/core/learning/distributed-r2a-physical.js';
import type { DistributedR2AEventPhysicalInputV2 } from '../src/core/learning/distributed-r2a-physical-contracts.js';

const pulse = (siteId: number) => [{ siteId, intensity: .125 }];
function input(explicit: boolean): DistributedR2AEventPhysicalInputV2 {
  const route = [pulse(1), pulse(2), pulse(3), pulse(4), pulse(5)];
  return { eventId: 'opaque-e', traceId: 'trace-e', contextIds: ['context-e'], conditionSignalIds: [],
    actionSiteIds: [2, 5], projectedPulseSiteIds: [[3], [4], [6]],
    conditionSiteIds: [1], conditionDrives: pulse(1),
    actionPulseSiteIds: [[2], [5]], actionPulseDrives: [pulse(2), pulse(5)],
    nextActionPrefixPulseSiteIds: [[3], [4]], nextActionPrefixPulseDrives: [pulse(3), pulse(4)],
    episodePulseSiteIds: [...route.map(p => p.map(d => d.siteId)), [6]],
    episodePulseDrives: [...route, pulse(6)], terminalPulseSiteIds: [6], terminalPulseDrives: pulse(6),
    ...(explicit ? { reachableContinuationPulseSiteIds: route.map(p => p.map(d => d.siteId)),
      reachableContinuationPulseDrives: route } : {}) };
}

for (const explicit of [true, false]) test(`pre-action route keeps earlier action wires; explicit=${explicit}`, () => {
  const result = continuationCandidateForInputV1(input(explicit));
  assert.deepEqual(result.seedPulses, [pulse(2), pulse(3), pulse(4), pulse(5)]);
  assert.deepEqual(result.conditionDrives, pulse(1));
  assert(!result.seedPulses.flat().some(drive => drive.siteId === 6));
});

test('changing a historical result changes the passive mask, never the simulation input', () => {
  const original = continuationCandidateForInputV1(input(true));
  const changed = continuationCandidateForInputV1({ ...input(true), terminalPulseSiteIds: [99],
    terminalPulseDrives: pulse(99) });
  assert.deepEqual(changed.seedPulses, original.seedPulses);
  assert.equal(changed.key, original.key);
  assert.notDeepEqual(changed.terminalSites, original.terminalSites);
});
