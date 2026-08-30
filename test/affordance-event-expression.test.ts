import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import { eventRows, relativePublicFeatures } from '../src/events.js';

function frame(sequence: number, targetId: string | null): Observation {
  return { sequence, activeSeconds: sequence * .05,
    self: { position: [0, 0, 0], yaw: sequence * .1, pitch: 0, properties: {} },
    objects: [{ id: 'opaque-instance-9', type: 'opaque-control', relativePosition: [1, 0, 0], properties: {} }],
    targetId, contextId: 'layout-a' };
}

test('crosshair acquisition is a public event without leaking an instance id', () => {
  const frames = [frame(1, null), frame(2, 'opaque-instance-9')];
  const event: RealEvent = { version: 'RealEventV5', id: 'look-acquires-target',
    cue: { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null },
    frames, trackedIds: ['self', 'opaque-instance-9'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
      executed: true, status: 'completed', startSequence: 1, endSequence: 2 } };
  const series = eventRows(event);
  assert(series.changes.flat().some(change => change.subject === 'crosshair'
    && change.property === 'visible' && change.before === false && change.after === true));
  assert(series.changes.flat().some(change => change.subject === 'crosshair'
    && change.property === 'type' && change.before === null && change.after === 'opaque-control'));
  const features = relativePublicFeatures(frames[1]!);
  assert.equal(features['crosshair/present=true'], 1);
  assert.equal(features['crosshair/target-type="opaque-control"'], 1);
  assert.equal(Object.keys(features).some(key => key.includes('opaque-instance-9')), false);
});

test('R2A public conditions are invariant to a common world rotation', () => {
  const base = frame(1, null);
  const rotated: Observation = {
    ...base,
    self: { ...base.self, yaw: Math.PI / 2 },
    // At yaw 0 an object three blocks ahead is world -Z.  Rotating the body
    // and the same local scene +90 degrees puts it at world -X.
    objects: [{ ...base.objects[0]!, relativePosition: [-1, 0, 0] }],
  };
  const unrotated: Observation = {
    ...base,
    self: { ...base.self, yaw: 0 },
    objects: [{ ...base.objects[0]!, relativePosition: [0, 0, -1] }],
  };
  assert.deepEqual(relativePublicFeatures(rotated), relativePublicFeatures(unrotated));
  assert.equal(Object.keys(relativePublicFeatures(rotated)).some(key => key === 'self/yaw'), false);
});
