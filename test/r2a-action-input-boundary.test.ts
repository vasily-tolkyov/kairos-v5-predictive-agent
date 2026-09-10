import assert from 'node:assert/strict';
import test from 'node:test';
import { r2aInputAtActionBoundaryV1 } from '../src/core/learning/r2a-action-input-boundary.js';
import { continuationCandidateForInputV1 } from '../src/core/learning/distributed-r2a-physical.js';

const base = { eventId: 'event', traceId: 'trace', contextIds: [], conditionSignalIds: [],
  conditionSiteIds: [1], actionSiteIds: [2, 3], actionPulseSiteIds: [[2], [3]],
  projectedPulseSiteIds: [[10], [11], [12], [20], [21], [22]],
  nextActionPrefixPulseSiteIds: [[10], [11], [12]],
  episodePulseSiteIds: [[1], [2], [10], [11], [12], [3], [20], [21], [22]],
  terminalPulseSiteIds: [22] };
const event = { atomPulseRanges: [
  { atomId: 'a', startPulseIndex: 0, endPulseIndexExclusive: 3 },
  { atomId: 'b', startPulseIndex: 3, endPulseIndexExclusive: 6 },
] };
test('exact before-command boundary includes real command, never its unobserved result', () => {
  const result = r2aInputAtActionBoundaryV1(base, event);
  assert.deepEqual(result.projectedCommandPulseIndices, [1, 4]);
  assert.deepEqual(result.reachableContinuationPulseSiteIds, [[1], [2], [10], [11], [12], [3], [20], [21]]);
  assert.deepEqual(continuationCandidateForInputV1(result).seedPulses.map(p => p.map(d => d.siteId)),
    [[2], [10], [11], [12], [3], [20], [21]]);
  assert.equal('projectedCommandPulseIndices' in base, false);
});
test('changing the last result cannot change a prescribed input or its command ports', () => {
  const changed = { ...base, projectedPulseSiteIds: [...base.projectedPulseSiteIds.slice(0, 5), [99]],
    terminalPulseSiteIds: [99] };
  const a = r2aInputAtActionBoundaryV1(base, event), b = r2aInputAtActionBoundaryV1(changed, event);
  assert.deepEqual(a.reachableContinuationPulseDrives, b.reachableContinuationPulseDrives);
  assert.deepEqual(a.projectedCommandPulseIndices, b.projectedCommandPulseIndices);
  assert.notDeepEqual(a.terminalPulseSiteIds, b.terminalPulseSiteIds);
});
