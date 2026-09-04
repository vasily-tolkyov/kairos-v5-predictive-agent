import test from 'node:test';
import assert from 'node:assert/strict';
import { runCapacityProbeV1 } from '../src/evaluation/capacity-probe-v1.js';

test('capacity probe keeps absent physical readouts explicitly unknown', () => {
  const report = runCapacityProbeV1([{ eventCount: 0, events: [] }]);
  assert.deepEqual(report.points[0], {
    eventCount: 0, r1AtomCount: 0, r2RoadCount: 0, r2aPatternCount: 0,
    readoutErrorRate: null, ambiguityRate: null, basinMergeRate: null,
    predictionReachRate: null,
  });
});

test('capacity probe rejects fixture count mismatches', () => {
  assert.throws(() => runCapacityProbeV1([{ eventCount: 1, events: [] }]),
    /event count mismatch/);
});
