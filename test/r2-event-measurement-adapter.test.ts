import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import { eventRows, relativePublicFeatures, R2_EVENT_MEASUREMENT_ADAPTER_V2 } from '../src/events.js';
import { PathProjector, rawGeometryDistance } from '../src/core/learning/path-projector.js';
import { PhysicalMemory } from '../src/memory.js';
import { canonical, sha } from '../src/util.js';

function transitionEvent(before: number, after: number, staticVariant: string): RealEvent {
  const frames: Observation[] = Array.from({ length: 5 }, (_, index) => ({
    sequence: index + 1,
    activeSeconds: index * 0.05,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [{ id: 'object-instance', type: 'opaque-panel', relativePosition: [0, 0, -1],
      properties: { state: index < 2 ? before : after, staticVariant } }],
    targetId: 'object-instance',
    contextId: `layout-${staticVariant}`,
  }));
  return {
    version: 'RealEventV5', id: `event-${before}-${after}-${staticVariant}`,
    cue: { kind: 'interact', parameters: {}, targetRole: 'opaque-panel' },
    frames, trackedIds: ['self', 'object-instance'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'interact', parameters: {}, targetId: 'object-instance' },
      executed: true, status: 'completed', startSequence: 1, endSequence: 5 },
  };
}

test('R2 event measurement excludes unchanged scene conditions while R2A still observes them', () => {
  assert.equal(R2_EVENT_MEASUREMENT_ADAPTER_V2, 'R2EventMeasurementAdapterV2');
  const left = transitionEvent(0, 1, 'left-layout');
  const right = transitionEvent(0, 1, 'right-layout');
  assert.equal(canonical(eventRows(left).rows), canonical(eventRows(right).rows));
  assert.notEqual(canonical(relativePublicFeatures(left.frames[0]!)),
    canonical(relativePublicFeatures(right.frames[0]!)));
  assert.equal(JSON.stringify(eventRows(left).rows).includes('staticVariant'), false);
});

test('a completed no-change window is an explicit terminal event observation', () => {
  const measured = eventRows(transitionEvent(1, 1, 'stable-layout'));
  assert.deepEqual(measured.changes.slice(0, -1), [[], [], [], []]);
  assert.deepEqual(measured.changes.at(-1), [{ subject: 'event', property: 'change-within-observed-window',
    before: false, after: false, observationIndex: 4, meaning: 'observed-co-occurrence' }]);
  assert.equal(measured.rows.slice(0, -1).some(row => row['event/no-public-change-within-window'] === 1), false);
  assert.equal(measured.rows.at(-1)?.['event/no-public-change-within-window'], 1);
  assert.equal(eventRows(transitionEvent(0, 1, 'changing-layout')).rows
    .some(row => row['event/no-public-change-within-window'] === 1), false);
});

test('opposite public transitions remain distinct without a result label', () => {
  const increase = eventRows(transitionEvent(0, 1, 'same-layout')).rows;
  const decrease = eventRows(transitionEvent(1, 0, 'same-layout')).rows;
  assert.notEqual(canonical(increase), canonical(decrease));
  assert.equal(increase.at(-1)?.['change/opaque-panel#0/state/before'], 0);
  assert.equal(increase.at(-1)?.['change/opaque-panel#0/state/after'], 1);
  assert.equal(increase.at(-1)?.['change/opaque-panel#0/state/delta'], 1);
  assert.equal(decrease.at(-1)?.['change/opaque-panel#0/state/before'], 1);
  assert.equal(decrease.at(-1)?.['change/opaque-panel#0/state/after'], 0);
  assert.equal(decrease.at(-1)?.['change/opaque-panel#0/state/delta'], -1);
});

test('event geometry keeps one global frame and remains invariant to equivalent densification', () => {
  const forward = [new Float64Array([0, 0, 0]), new Float64Array([1, 0, 0]), new Float64Array([2, 0, 0])];
  const reverse = [new Float64Array([0, 0, 0]), new Float64Array([-1, 0, 0]), new Float64Array([-2, 0, 0])];
  const dense = [new Float64Array([0, 0, 0]), new Float64Array([0.5, 0, 0]),
    new Float64Array([1, 0, 0]), new Float64Array([1.5, 0, 0]), new Float64Array([2, 0, 0])];
  const projector = new PathProjector();
  const forwardGeometry = projector.geometry(forward);
  const reverseGeometry = projector.geometry(reverse);
  assert(forwardGeometry.at(-3)! > 0);
  assert(reverseGeometry.at(-3)! < 0);
  assert(rawGeometryDistance(forwardGeometry, reverseGeometry) > 1);
  assert(rawGeometryDistance(forwardGeometry, projector.geometry(dense)) < 1e-12);
  const translated = forward.map(point => new Float64Array([point[0]! + 100, point[1]! - 20, point[2]! + 7]));
  assert(rawGeometryDistance(forwardGeometry, projector.geometry(translated)) < 1e-12);
});

test('R2 event geometry retains the initiating subjective action without importing static conditions', () => {
  const interact = transitionEvent(0, 1, 'same-layout');
  const observed = { ...structuredClone(interact), id: 'same-outcome-different-cue',
    cue: { kind: 'wait' as const, parameters: {}, targetRole: null },
    bodyResult: { ...structuredClone(interact.bodyResult!),
      action: { kind: 'wait' as const, parameters: {} } } };
  assert.notEqual(canonical(eventRows(interact).rows), canonical(eventRows(observed).rows));
});

test('invalid interact evidence fails before any physical memory state changes', () => {
  const valid = transitionEvent(0, 1, 'valid-layout');
  const invalid = [
    { ...structuredClone(valid), id: 'wrong-crosshair', frames: valid.frames.map((frame, index) =>
      index === 0 ? { ...structuredClone(frame), targetId: null } : structuredClone(frame)) },
    { ...structuredClone(valid), id: 'missing-target', frames: valid.frames.map((frame, index) =>
      index === 0 ? { ...structuredClone(frame), objects: [] } : structuredClone(frame)) },
    { ...structuredClone(valid), id: 'wrong-cue', cue: { ...structuredClone(valid.cue), targetRole: 'wrong-type' } },
    { ...structuredClone(valid), id: 'wrong-body-action', bodyResult: { ...structuredClone(valid.bodyResult!),
      action: { kind: 'wait' as const, parameters: {} } } },
  ];
  for (const event of invalid) {
    const memory = new PhysicalMemory(), before = sha(memory.snapshot());
    assert.throws(() => memory.observe(event),
      /invalid-interact-event-precondition|event-cue-does-not-match-body-action/);
    assert.equal(sha(memory.snapshot()), before);
    assert.equal(memory.bufferedEvents, 0); assert.equal(memory.writes, 0);
  }
});
