import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { SelfOrganizingAfferentProjectionV1 } from '../src/core/learning/self-organizing-afferent.js';
import { sha } from '../src/util.js';
import { eventRows } from '../src/events.js';

function event(id: string, before: boolean, after: boolean): RealEvent {
  const frame = (sequence: number, q: boolean): Observation => ({ sequence,
    activeSeconds: sequence * .05, contextId: id, targetId: 'o',
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1],
      properties: { q, background: 'constant', carrier: false } }] });
  return { version: 'RealEventV5', id, cue: { kind: 'interact', parameters: {}, targetRole: 'opaque' },
    frames: [frame(1, before), frame(2, after)], trackedIds: ['self', 'o'],
    bodyResult: { action: { kind: 'interact', parameters: {}, targetId: 'o' },
      executed: true, status: 'completed', startSequence: 1, endSequence: 2 },
    provenance: 'executed-real-body', complete: true };
}

test('an event does not turn never-changing target context into its terminal outcome population', () => {
  const projection = new SelfOrganizingAfferentProjectionV1();
  const medium = new DistributedPhysicalMedium3DV1({ name: 'scope' });
  const real = event('change', false, true), before = sha(real);
  projection.projectEvent(real, medium);
  const properties = projection.snapshot().bindings.filter(value => value.descriptor?.source === 'public-state')
    .map(value => value.descriptor!.publicProperty);
  assert.deepEqual([...new Set(properties)], ['q']);
  assert.equal(sha(real), before, 'raw observations were edited to simplify the event');
});

test('a previously observed outcome remains measurable in a later complete no-effect window', () => {
  const projection = new SelfOrganizingAfferentProjectionV1();
  const medium = new DistributedPhysicalMedium3DV1({ name: 'scope-negative' });
  projection.projectEvent(event('change', false, true), medium);
  const result = projection.projectEvent(event('no-effect', false, false), medium);
  const observed = projection.readPublicState(result.episode.pulses.at(-1)!.drives);
  assert.equal(observed.channels.find(channel => channel.property === 'q')?.value, false);
  assert.equal(observed.channels.some(channel => channel.property === 'background'), false);
  assert.deepEqual(result.episode.pulses[0]!.drives, result.episode.pulses.at(-1)!.drives,
    'no effect must describe the same observed state before and after the action');
});

test('restoring afferent evidence preserves unchanged-outcome scope without future observation', () => {
  const projection = new SelfOrganizingAfferentProjectionV1();
  const medium = new DistributedPhysicalMedium3DV1({ name: 'scope-restore' });
  projection.projectEvent(event('change', false, true), medium);
  const snapshot = projection.snapshot();
  const restored = SelfOrganizingAfferentProjectionV1.restore(snapshot);
  const clone = DistributedPhysicalMedium3DV1.fromSnapshot(medium.snapshot());
  assert.deepEqual(projection.projectEvent(event('next', true, true), medium),
    restored.projectEvent(event('next', true, true), clone));
});

test('an observation channel changed by a different action does not become this action outcome', () => {
  const projection = new SelfOrganizingAfferentProjectionV1();
  const medium = new DistributedPhysicalMedium3DV1({ name: 'separate-action-scope' });
  projection.projectEvent(event('interact-change', false, true), medium);
  const other = event('other-action', false, false);
  const otherWithChange: RealEvent = { ...other,
    cue: { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null },
    bodyResult: { ...other.bodyResult!, action: {
      kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } } },
    frames: other.frames.map((frame, index) => ({ ...frame, objects: frame.objects.map(object => ({
      ...object, properties: { ...object.properties, background: index === 0 ? 'a' : 'b' },
    })) })) };
  projection.projectEvent(otherWithChange, medium);
  const next = projection.projectEvent(event('interact-no-effect', false, false), medium);
  const channels = projection.readPublicState(next.episode.pulses.at(-1)!.drives).channels;
  assert.equal(channels.find(channel => channel.property === 'q')?.value, false);
  assert.equal(channels.some(channel => channel.property === 'background' && channel.status === 'decoded'), false);
  const frozen = sha(projection.snapshot());
  const current = event('current-only', false, false);
  const observed = projection.lookupCurrentObservation(current.frames[0]!, eventRows(current).roleBindings, current.cue);
  const decoded = projection.readPublicState(observed.drives
    ?? observed.siteIds.map(siteId => ({ siteId, intensity: 1 })));
  assert.equal(decoded.channels.find(channel => channel.property === 'q')?.value, false,
    'a past true outcome replaced the actually observed false prefix');
  assert.equal(decoded.channels.some(channel => channel.property === 'background'), false);
  assert.equal(sha(projection.snapshot()), frozen);
});

test('closing a process does not misreport a new query origin as a real return to zero', () => {
  const projection = new SelfOrganizingAfferentProjectionV1();
  const medium = new DistributedPhysicalMedium3DV1({ name: 'terminal-is-not-new-origin' });
  const original = event('real-turn', false, true);
  const real: RealEvent = { ...original, frames: original.frames.map((frame, index) => ({
    ...frame, self: { ...frame.self, yaw: index * Math.PI / 12,
      position: [index, 0, 0] as const },
  })) };
  projection.projectEvent(real, medium);
  const lookup = (purpose: 'query-origin' | 'observed-terminal') => {
    const result = projection.lookupCurrentObservation(real.frames.at(-1)!, eventRows(real).roleBindings,
      undefined, purpose);
    return projection.readPublicState(result.drives
      ?? result.siteIds.map(siteId => ({ siteId, intensity: 1 }))).channels;
  };
  const query = lookup('query-origin'), terminal = lookup('observed-terminal');
  assert.ok(query.some(value => value.property === 'yaw' && value.continuous?.estimate === 0));
  assert.ok(terminal.some(value => value.property === 'q' && value.value === true));
  assert.equal(terminal.some(value => value.property === 'yaw'
    || value.property.startsWith('displacement.')), false);
});

test('a result channel scope is read-only and includes observed alternate values, not other channels', () => {
  const projection = new SelfOrganizingAfferentProjectionV1();
  const medium = new DistributedPhysicalMedium3DV1({ name: 'result-channel-scope' });
  const result = projection.projectEvent(event('scope-values', false, true), medium);
  const frozen = sha(projection.snapshot()), physical = sha(medium.snapshot());
  const scope = new Set(projection.publicResultChannelSiteIds(result.episode.pulses.at(-1)!.drives
    .map(drive => drive.siteId)));
  const bindings = projection.snapshot().bindings.filter(binding => binding.siteIds.some(site => scope.has(site)));
  assert.deepEqual(bindings.map(binding => binding.descriptor?.categoricalValue).sort(), ['false', 'true']);
  assert.ok(bindings.every(binding => binding.descriptor?.publicProperty === 'q'));
  assert.equal(sha(projection.snapshot()), frozen);
  assert.equal(sha(medium.snapshot()), physical);
});
