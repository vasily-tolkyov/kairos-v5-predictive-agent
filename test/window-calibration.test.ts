import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import { ExperienceMedium, experienceInputs, motorIdentity } from '../src/experience-medium.js';
import { ContextualReadout } from '../src/contextual-readout.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';
import { experienceSearchKey } from '../src/experience-agent.js';
import { LearnedAffordances } from '../src/learned-affordances.js';

// Synthetic counterexamples to evidence accounting, never native capability trials.
const action: Action = { kind: 'wait', parameters: { ticks: 2 } };
function frame(sequence: number, count = 9, red = .4): Observation {
  return { sequence, activeSeconds: sequence / 20, contextId: 'window-test', targetId: null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: Array.from({ length: count }, (_, i) => ({ id: 'o' + i, type: 'percept',
      relativePosition: [0, 0, -2] as const, properties: { red } })) };
}
function event(n: number, count = 9, red = .4): RealEvent {
  const before = frame(n * 2 + 1, count, red), after = frame(n * 2 + 2, count, red);
  return { version: 'RealEventV5', id: 'window-test:event-' + n, cue: cueFor(action, before),
    frames: [before, after], trackedIds: ['self', ...before.objects.map(o => o.id)],
    provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: after.sequence } };
}
const rows = (medium: ExperienceMedium) => medium.snapshot().contexts!.circuits.find(([id]) => id.endsWith('/object'))![1].samples;
test('one real window with nine objects cannot establish object prediction support', () => {
  const medium = new ExperienceMedium(41); medium.observe(event(0));
  assert(!medium.predict(cueFor(action, frame(100)), frame(100)).supportedFields.some(f => f.endsWith('/properties.red')));
});
test('all first-window object forecasts precede every object update', () => {
  const medium = new ExperienceMedium(41); medium.observe(event(0));
  assert.equal(rows(medium).filter(row => row.externalErrors?.['property/red'] !== undefined).length, 0);
  assert.equal(rows(medium).filter(row => row.errors['property/red'] !== undefined).length, 0);
  assert.equal(rows(medium).length, 9, 'fitting observations are retained');
});
test('five two-object windows cannot borrow ten independent calibration counts', () => {
  const medium = new ExperienceMedium(41); for (let i = 0; i < 5; i++) medium.observe(event(i, 2));
  const input = frame(100, 2), local = ContextualReadout.restore(medium.snapshot().contexts!)
    .read(motorIdentity(cueFor(action, input)) + '/object', 'property/red', experienceInputs(input, input.objects[0]))!;
  assert(local.externalCalibrated <= 4); assert.equal(local.supported, false);
});
test('independent subsequent windows establish support and duplicate events never recalibrate', () => {
  const medium = new ExperienceMedium(41); for (let i = 0; i < 20; i++) medium.observe(event(i, 2));
  const input = frame(100, 2), prediction = medium.predict(cueFor(action, input), input);
  assert(prediction.supportedFields.includes('object:o0/properties.red'));
  const before = sha(medium.snapshot());
  for (let i = 0; i < 20; i++) assert.equal(medium.observe(event(i, 2)).learned, false);
  assert.equal(sha(medium.snapshot()), before);
  assert.deepEqual(ExperienceMedium.restore(medium.snapshot()).predict(cueFor(action, input), input), prediction);
});
test('legacy rows retain their original errors and fit without inventing independent source windows', () => {
  const medium = new ExperienceMedium(41); for (let i = 0; i < 20; i++) medium.observe(event(i, 2));
  const snapshot = medium.snapshot(); snapshot.contexts!.version = 'ContextualReadout2';
  for (const [, circuit] of snapshot.contexts!.circuits) for (const row of circuit.samples) delete (row as any).windowId;
  const originalRows = structuredClone(snapshot.contexts!.circuits), migrated = ExperienceMedium.restore(snapshot);
  assert.deepEqual(migrated.snapshot().contexts!.circuits, originalRows);
  const input = frame(100, 2);
  assert(!migrated.predict(cueFor(action, input), input).supportedFields.includes('object:o0/properties.red'));
  for (let i = 20; i < 28; i++) migrated.observe(event(i, 2));
  assert(migrated.predict(cueFor(action, input), input).supportedFields.includes('object:o0/properties.red'));
});
test('unknown property placeholders are equivalent for subsequent predictions and learned offers', () => {
  const medium = new ExperienceMedium(41), affordances = new LearnedAffordances();
  for (let i = 0; i < 32; i++) {
    const e = event(i, 2); medium.observe(e);
    affordances.observe(e.frames[0]!, [{ version: 'ActionOfferV1', offerId: String(i),
      observationSequence: e.frames[0]!.sequence, action, cue: e.cue }]);
  }
  const base = medium.predict(cueFor(action, frame(100, 2)), frame(100, 2)).observation!;
  const variants = [false, true, 98, 'unobserved'].map(value => ({ ...base, self: { ...base.self,
    properties: { ...base.self.properties, hidden: value } }, objects: base.objects.map(o => ({ ...o,
      properties: { ...o.properties, hidden: value } })) }));
  const digest = sha([medium.snapshot(), affordances.snapshot()]);
  const reference = variants[0]!;
  for (const variant of variants) {
    assert.deepEqual(experienceInputs(variant), experienceInputs(reference));
    assert.deepEqual(affordances.imagined(variant), affordances.imagined(reference));
    assert.equal(experienceSearchKey(variant), experienceSearchKey(reference));
    let left: Observation = variant, right: Observation = reference;
    for (let depth = 0; depth < 3; depth++) {
      const a = medium.predict(cueFor(action, left), left), b = medium.predict(cueFor(action, right), right);
      assert.deepEqual({ ...a, observation: null }, { ...b, observation: null });
      assert.deepEqual(a.observation!.predictionBounds, b.observation!.predictionBounds);
      assert.equal(experienceSearchKey(a.observation!), experienceSearchKey(b.observation!));
      left = a.observation!; right = b.observation!;
    }
  }
  const { hidden: _hidden, ...properties } = reference.self.properties;
  const missing = { ...reference, self: { ...reference.self, properties } };
  assert.notEqual(experienceSearchKey(missing), experienceSearchKey(reference), 'field presence remains binding information');
  const known = { ...reference, predictionSupport: [...reference.predictionSupport!, 'self/properties.hidden'] };
  assert.notEqual(experienceSearchKey(known), experienceSearchKey(reference));
  assert.notEqual(experienceSearchKey({ ...known, self: { ...known.self, properties: { ...known.self.properties, hidden: true } } }), experienceSearchKey(known));
  assert.equal(sha([medium.snapshot(), affordances.snapshot()]), digest);
});
test('a previously unseen outcome category is scored before expanding the classifier vocabulary', () => {
  const medium = new ExperienceMedium(41);
  const changed = (n: number, after: boolean): RealEvent => {
    const e = event(n, 0);
    return { ...e, frames: e.frames.map((f, i) => ({ ...f, self: { ...f.self, properties: { signal: i === 0 ? false : after } } })) };
  };
  for (let i = 0; i < 20; i++) medium.observe(changed(i, false));
  const state = medium.snapshot(), head = state.networks.find(([id]) => id.endsWith('/self'))![1].heads.find(h => h.key === 'property/signal')!;
  // Force the known category's score below a newly appended zero-weight row.
  // This is a synthetic decoder boundary, not a learned/native parameter edit.
  for (const row of [...head.readout, ...head.categoryReadout]) { row.fill(0); row[0] = -1; }
  const restored = ExperienceMedium.restore(state); restored.observe(changed(20, true));
  const row = restored.snapshot().contexts!.circuits.find(([id]) => id.endsWith('/self'))![1].samples.at(-1)!;
  assert.equal(row.externalErrors!['property/signal'], 2);
});
test('multiple planes cannot inflate the independent-window count of a motion fallback', () => {
  const medium = new ExperienceMedium(41);
  for (let i = 0; i < 32; i++) medium.observe(event(i, 0));
  const sensed = (sequence: number): Observation => {
    const f = frame(sequence, 2);
    return { ...f, targetId: 'o1', perception: { version: 'AttentivePerception8', attendedId: 'o0', gazeId: 'o1',
      receptors: 8, groups: 2, tracks: f.objects.map((o, i) => ({ id: o.id, position: o.relativePosition,
        color: [.4, .4, .4], extent: .5, sampleCount: 4, visible: true, confidence: 1, ambiguity: 0,
        age: 2, missed: 0, anchorEpoch: 0, motionEvidence: [false, false, false],
        surface: { normal: [0, 1, 2].map(axis => Number(axis === (i + Math.floor((sequence - 1) / 2)) % 3)) as [number, number, number], point: o.relativePosition } })) } };
  };
  const learn = (i: number) => { const e = event(i, 2);
    medium.observe({ ...e, frames: e.frames.map(f => sensed(f.sequence)) }); };
  for (let i = 32; i < 37; i++) learn(i);
  const motion = medium.snapshot().networks.find(([id]) => id.endsWith('/object'))![1].motion!;
  assert.equal(motion.observations, 10); assert.equal(motion.calibration?.length, 4);
  const query = sensed(1001);
  assert(!medium.predict(cueFor(action, query), query).supportedFields.includes('object:o0/relativeDistance'));
  for (let i = 37; i < 69; i++) learn(i);
  assert.equal(medium.snapshot().networks.find(([id]) => id.endsWith('/object'))![1].motion!.calibration!.length, 32);
  assert(medium.predict(cueFor(action, query), query).supportedFields.includes('object:o0/relativeDistance'));
});
test('context certificates aggregate worst error and physical residual separately per window', () => {
  const readout = new ContextualReadout();
  for (let i = 0; i < 9; i++) readout.observeWindow('p', 'w' + i, [
    { input: {}, targets: [['x', 0, 0]], externalErrors: { x: .9 } },
    { input: {}, targets: [['x', 0, 10]], externalErrors: { x: .2 } }
  ]);
  const local = readout.read('p', 'x', {})!;
  assert.equal(local.externalCalibrated, 9);
  assert(Math.abs(local.externalErrorRadius! - .155) < 1e-12, 'the largest raw residual belongs to the smaller normalized score');
  const digest = sha(readout.snapshot());
  assert.throws(() => readout.observeWindow('p', 'w8', [{ input: {}, targets: [['x', 0, 0]] }]), /duplicate-context-window/);
  assert.equal(sha(readout.snapshot()), digest);
});
