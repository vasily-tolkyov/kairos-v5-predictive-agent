import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import { eventRows } from '../src/events.js';

function frame(sequence: number, type: string): Observation {
  return { sequence, activeSeconds: sequence * .05, contextId: 'ctx', targetId: null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { onGround: true } },
    objects: [{ id: 'block:2,64,4', type, relativePosition: [0, 0, -2],
      properties: { lit: false } }] };
}

function typeChangeEvent(): RealEvent {
  return { version: 'RealEventV5', id: 'ev-oxidation',
    cue: { kind: 'observe', parameters: { ticks: 5 }, targetRole: null },
    frames: [frame(1, 'copper_bulb'), frame(2, 'copper_bulb'),
      frame(3, 'exposed_copper_bulb'), frame(4, 'exposed_copper_bulb')],
    trackedIds: ['self', 'block:2,64,4'],
    bodyResult: { action: { kind: 'observe', parameters: { ticks: 5 } }, executed: true,
      status: 'completed', startSequence: 1, endSequence: 4 },
    provenance: 'executed-real-body', complete: true };
}

test('a mid-event public type transition (copper oxidizing in place) is evidence, never a fatal error', () => {
  const rows = eventRows(typeChangeEvent());
  const transitions = rows.changes.flat()
    .filter(change => change.property === 'type' && change.subject === 'copper_bulb#0');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.before, 'copper_bulb');
  assert.equal(transitions[0]!.after, 'exposed_copper_bulb');
  assert.equal(transitions[0]!.observationIndex, 2, 'the transition sits at the real frame');
  assert.equal(transitions[0]!.meaning, 'observed-co-occurrence');
});
