import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import { eventRows, publicTransitionTopologyAuditIdV1, publicTransitionTopologyIdV1,
  realEventHierarchyContinuityV1,
  relativePublicFeatures } from '../src/events.js';

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
    objects: [{ ...base.objects[0]!, relativePosition: [-1, 0, 0],
      properties: { facing: 'west' } }],
  };
  const unrotated: Observation = {
    ...base,
    self: { ...base.self, yaw: 0 },
    objects: [{ ...base.objects[0]!, relativePosition: [0, 0, -1],
      properties: { facing: 'north' } }],
  };
  assert.deepEqual(relativePublicFeatures(rotated), relativePublicFeatures(unrotated));
  assert.equal(Object.keys(relativePublicFeatures(rotated)).some(key => key === 'self/yaw'), false);
});

test('R1 event measurement and R2 topology use the actor frame rather than Minecraft world axes', () => {
  const movement = (id: string, yaw: number, worldStep: readonly [number, number, number],
    velocity: readonly [number, number, number]): RealEvent => {
    const observations: Observation[] = [0, 1, 2].map((step, index) => ({
      sequence: index + 1, activeSeconds: index * .05,
      self: { position: worldStep.map(value => value * step) as [number, number, number],
        yaw, pitch: 0, properties: { onGround: true,
          velocityX: index === 1 ? velocity[0] : 0,
          velocityY: index === 1 ? velocity[1] : 0,
          velocityZ: index === 1 ? velocity[2] : 0 } },
      objects: [], targetId: null, contextId: `context-${id}`,
    }));
    const action = { kind: 'move' as const, parameters: { direction: 'forward', ticks: 4 } };
    return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames: observations,
      trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
      bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 3 } };
  };
  const north = movement('north', 0, [0, 0, -0.4], [0, 0, -0.1]);
  const west = movement('west', Math.PI / 2, [-0.4, 0, 0], [-0.1, 0, 0]);
  assert.deepEqual(eventRows(north).rows, eventRows(west).rows,
    'a common world rotation tore one actor-relative action into two R1 measurements');
  assert.equal(publicTransitionTopologyIdV1(north), publicTransitionTopologyIdV1(west),
    'a common world rotation tore one result into two R2A topologies');
  assert.notDeepEqual(eventRows(north).changes, eventRows(west).changes,
    'the public world-axis facts were silently replaced rather than kept separate from measurement');
});

test('tracked-object motion and facing use the actor frame while raw public facts stay world-relative', () => {
  const make = (id: string, yaw: number, relative: readonly [number, number, number],
    facingBefore: string, facingAfter: string, velocity: readonly [number, number, number]): RealEvent => {
    const objectId = `object-${id}`;
    const frames: Observation[] = [0, 1].map(index => ({ sequence: index + 1,
      activeSeconds: index * .05, self: { position: [0, 0, 0], yaw, pitch: 0, properties: {} },
      objects: [{ id: objectId, type: 'rotating-object', relativePosition: [...relative],
        properties: { facing: index === 0 ? facingBefore : facingAfter,
          velocityX: index === 0 ? 0 : velocity[0], velocityY: index === 0 ? 0 : velocity[1],
          velocityZ: index === 0 ? 0 : velocity[2] } }], targetId: null, contextId: id }));
    const action = { kind: 'observe' as const, parameters: { ticks: 5 } };
    return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames,
      trackedIds: [objectId], provenance: 'executed-real-body', complete: true,
      bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 } };
  };
  const north = make('north-object', 0, [0, 0, -1], 'north', 'east', [0, 0, -.1]);
  const west = make('west-object', Math.PI / 2, [-1, 0, 0], 'west', 'north', [-.1, 0, 0]);
  assert.deepEqual(eventRows(north).measurementChanges, eventRows(west).measurementChanges);
  assert.equal(publicTransitionTopologyIdV1(north), publicTransitionTopologyIdV1(west));
  assert.notDeepEqual(eventRows(north).changes, eventRows(west).changes);
});

test('same-type event-local roles are determined by public geometry rather than tracked id order', () => {
  const make = (id: string, reverse: boolean): RealEvent => {
    const leftId = `left-${id}`, rightId = `right-${id}`;
    const object = (objectId: string, x: number, active: boolean) => ({ id: objectId, type: 'same-type',
      relativePosition: [x, 0, -2] as [number, number, number], properties: { active } });
    const frames: Observation[] = [0, 1].map(index => ({ sequence: index + 1,
      activeSeconds: index * .05, self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
      objects: [object(rightId, 1, false), object(leftId, -1, index === 1)],
      targetId: null, contextId: id }));
    const action = { kind: 'observe' as const, parameters: { ticks: 5 } };
    return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames,
      trackedIds: reverse ? [rightId, leftId] : [leftId, rightId],
      provenance: 'executed-real-body', complete: true,
      bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 } };
  };
  const ordered = make('ordered-roles', false), reversed = make('reversed-roles', true);
  assert.deepEqual(eventRows(ordered).measurementChanges, eventRows(reversed).measurementChanges);
  assert.equal(publicTransitionTopologyIdV1(ordered), publicTransitionTopologyIdV1(reversed));
});

test('topology drops sub-resolution motion noise but retains a real return trajectory', () => {
  const movement = (id: string, y: readonly number[], velocityY: readonly number[]): RealEvent => {
    const observations: Observation[] = y.map((height, index) => ({ sequence: index + 1,
      activeSeconds: index * .05,
      self: { position: [0, height, 0], yaw: 0, pitch: 0,
        properties: { onGround: true, velocityX: 0, velocityY: velocityY[index]!, velocityZ: 0 } },
      objects: [], targetId: null, contextId: `context-${id}` }));
    const action = { kind: 'jump' as const, parameters: { forward: false, ticks: 4 } };
    return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames: observations,
      trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
      bodyResult: { action, executed: true, status: 'completed', startSequence: 1,
        endSequence: observations.length } };
  };
  const still = movement('still', [0, 0, 0], [0, 1e-5, 0]);
  const tiny = movement('tiny', [0, 1e-5, 0], [0, -1e-5, 0]);
  const belowVelocityResolution = movement('below-velocity-resolution', [0, 0, 0], [0, .02, 0]);
  const atVelocityResolution = movement('at-velocity-resolution', [0, 0, 0], [0, .05, 0]);
  const jump = movement('jump', [0, .5, 0], [0, .2, 0]);
  assert.equal(publicTransitionTopologyIdV1(still), publicTransitionTopologyIdV1(tiny),
    'sub-resolution numerical motion became a false result branch');
  assert.equal(publicTransitionTopologyIdV1(still), publicTransitionTopologyIdV1(belowVelocityResolution),
    'event-local velocity used a coarser resolution than the public velocity sensor');
  assert.notEqual(publicTransitionTopologyIdV1(still), publicTransitionTopologyIdV1(atVelocityResolution),
    'a velocity change at the public resolution was erased');
  assert.notEqual(publicTransitionTopologyIdV1(still), publicTransitionTopologyIdV1(jump),
    'a real transient trajectory was erased with numerical noise');
});

test('filtered continuous noise cannot change the order of retained topology transitions', () => {
  const make = (id: string, includeNoise: boolean): RealEvent => {
    const frames: Observation[] = [0, 1, 2].map(index => ({ sequence: index + 1,
      activeSeconds: index * .05, self: { position: [0, 0, 0], yaw: 0, pitch: 0,
        properties: { marker: index === 2, velocityX: 0,
          velocityY: includeNoise && index === 1 ? .02 : 0, velocityZ: 0 } },
      objects: [], targetId: null, contextId: id }));
    const action = { kind: 'observe' as const, parameters: { ticks: 5 } };
    return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames,
      trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
      bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 3 } };
  };
  const clean = make('clean-order', false), noisy = make('noisy-order', true);
  assert.equal(publicTransitionTopologyIdV1(clean), publicTransitionTopologyIdV1(noisy));
  assert.notEqual(publicTransitionTopologyAuditIdV1(clean), publicTransitionTopologyAuditIdV1(noisy),
    'the full audit identity lost a real observed sub-resolution fluctuation');
});

test('equal-distance public objects have deterministic egocentric ordinals', () => {
  const base = frame(1, null);
  const unrotated: Observation = { ...base,
    self: { ...base.self, yaw: 0 },
    objects: [
      { id: 'world-a', type: 'smooth_stone', relativePosition: [-1, 0, -1], properties: {} },
      { id: 'world-b', type: 'smooth_stone', relativePosition: [1, 0, -1], properties: {} },
    ] };
  const rotatedAndShuffled: Observation = { ...base,
    self: { ...base.self, yaw: Math.PI / 2 },
    objects: [
      { id: 'other-b', type: 'smooth_stone', relativePosition: [-1, 0, -1], properties: {} },
      { id: 'other-a', type: 'smooth_stone', relativePosition: [-1, 0, 1], properties: {} },
    ] };
  const merelyShuffled: Observation = { ...unrotated, objects: [...unrotated.objects].reverse() };
  assert.deepEqual(relativePublicFeatures(merelyShuffled), relativePublicFeatures(unrotated));
  assert.deepEqual(relativePublicFeatures(rotatedAndShuffled), relativePublicFeatures(unrotated));
  const leftOnly: Observation = { ...unrotated, objects: [unrotated.objects[0]!] };
  const rightOnly: Observation = { ...unrotated, objects: [unrotated.objects[1]!] };
  assert.notDeepEqual(relativePublicFeatures(leftOnly), relativePublicFeatures(rightOnly));
});

function publicStateEvent(id: string, objectId: string, before: number, after: number,
  startSequence: number, selfX = 0): RealEvent {
  const make = (sequence: number, note: number): Observation => ({ sequence,
    activeSeconds: sequence * .05,
    self: { position: [selfX, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: objectId, type: 'opaque-control', relativePosition: [1, 0, 0],
      properties: { note } }], targetId: null, contextId: `context-${id}` });
  const frames = [make(startSequence, before), make(startSequence + 1, before),
    make(startSequence + 2, after)];
  return { version: 'RealEventV5', id,
    cue: { kind: 'observe', parameters: { ticks: 5 }, targetRole: null }, frames,
    trackedIds: [objectId], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'observe', parameters: { ticks: 5 } }, executed: true,
      status: 'completed', startSequence, endSequence: startSequence + 2 } };
}

test('public transition topology is identity/time/world invariant but distinguishes discrete transitions', () => {
  const first = publicStateEvent('a', 'instance-a', 0, 1, 10, 0);
  const same = publicStateEvent('b', 'instance-b', 0, 1, 1_000, 512);
  assert.equal(publicTransitionTopologyIdV1(first), publicTransitionTopologyIdV1(same));
  const oneToTwo = publicStateEvent('c', 'instance-c', 1, 2, 2_000, -128);
  const twoToThree = publicStateEvent('d', 'instance-d', 2, 3, 3_000, 64);
  assert.notEqual(publicTransitionTopologyIdV1(first), publicTransitionTopologyIdV1(oneToTwo));
  assert.notEqual(publicTransitionTopologyIdV1(oneToTwo), publicTransitionTopologyIdV1(twoToThree));
});

test('public transition topology omits absolute continuous values and keeps public resolution bands', () => {
  const make = (id: string, objectId: string, before: number, after: number): RealEvent => {
    const frames: Observation[] = [before, after].map((distance, index) => ({ sequence: index + 1,
      activeSeconds: index * .05, self: { position: [100, 64, -100], yaw: 0, pitch: 0, properties: {} },
      objects: [{ id: objectId, type: 'opaque-control', relativePosition: [distance, 0, 0], properties: {} }],
      targetId: null, contextId: id }));
    return { version: 'RealEventV5', id, cue: { kind: 'observe', parameters: { ticks: 1 }, targetRole: null },
      frames, trackedIds: [objectId], provenance: 'executed-real-body', complete: true,
      bodyResult: { action: { kind: 'observe', parameters: { ticks: 1 } }, executed: true,
        status: 'completed', startSequence: 1, endSequence: 2 } };
  };
  assert.equal(publicTransitionTopologyIdV1(make('near', 'n', 1, 1.24)),
    publicTransitionTopologyIdV1(make('far', 'f', 6, 6.24)));
  assert.notEqual(publicTransitionTopologyIdV1(make('increase', 'i', 1, 1.24)),
    publicTransitionTopologyIdV1(make('decrease', 'd', 6, 5.76)));
});

test('an explicit stable observation scope remains real public continuity evidence', () => {
  const event = publicStateEvent('stable-scope', 'opaque-scoped-object', 0, 0, 40);
  const continuity = realEventHierarchyContinuityV1(event, 'scope-session');
  assert.equal(continuity.processStatusAfter, 'publicly-resolved');
  assert.equal(continuity.dependencies.some(value => value.subject === 'opaque-scoped-object'
    && value.property === 'visible' && value.factCategory === 'public-state-persistence'), true);
  assert.equal(continuity.dependencies.some(value => value.subject === 'opaque-scoped-object'
    && value.property === 'note' && value.factCategory === 'public-state-persistence'), true);
});

test('an observe verification carries the public embodied state needed to close a preceding action', () => {
  const event = publicStateEvent('embodied-verification', 'opaque-scoped-object', 0, 0, 80);
  const continuity = realEventHierarchyContinuityV1(event, 'scope-session');
  assert.equal(continuity.dependencies.some(value => value.dependencyId === 'self:motion-state'
    && value.subject === 'self' && value.property === 'motion-state'), true);
  assert.equal(continuity.dependencies.some(value => value.dependencyId === 'self:orientation'
    && value.subject === 'self' && value.property === 'orientation'), true);
});
