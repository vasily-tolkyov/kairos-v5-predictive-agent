import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextualReadout, type SensoryState } from '../src/contextual-readout.js';
import type { Action, Observation, PublicValue, RealEvent } from '../src/contracts.js';
import { ExperienceMedium } from '../src/experience-medium.js';
import { ExperienceAgent } from '../src/experience-agent.js';
import { cueFor } from '../src/events.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';

// Synthetic sensory/action measurements only. Category names and response
// functions belong to this apparatus and never enter the learner as rules.
function train(labels: readonly [PublicValue, PublicValue] = ['A', 'B'], variable = false) {
  const model = new ContextualReadout();
  for (let i = 0; i < 128; i++) {
    const side = i % 2;
    model.observe('motor', { condition: labels[side]!, nuisance: i % 3 },
      [['motion', 0, (side ? -1 : 1) + (variable ? (i % 4 < 2 ? -.2 : .2) : 0)]], { motion: 0 });
  }
  return model;
}
const read = (model: ContextualReadout, condition: PublicValue) => model.read('motor', 'motion', { condition });

test('unseen categories cannot inherit either local or regression support', () => {
  for (const variable of [false, true]) {
    const model = train(['A', 'B'], variable), before = JSON.stringify(model.snapshot());
    for (const category of ['A', 'B']) {
      const known = read(model, category)!;
      assert.equal(known.supported, !variable);
      assert.equal(known.externalSupported, true, 'a calibrated regression remains usable in its measured region');
    }
    const unknown = read(model, 'C');
    assert.equal(unknown?.supported ?? false, false);
    assert.equal(unknown?.externalSupported ?? false, false);
    assert.equal(JSON.stringify(model.snapshot()), before, 'support queries never manufacture calibration');
  }
});

test('category spelling, value type and presentation order do not determine support', () => {
  for (const [first, second, unknown] of [
    ['oak', 'snow', 'sand'], ['snow', 'oak', 'sand'], ['zz-last', '00-first', 'middle'],
    [true, false, 'false'], [null, 'present', 'null'], [1, '1', '01'],
  ] as const) {
    const model = train([first, second]);
    assert.equal(read(model, first)?.supported, true);
    assert.equal(read(model, second)?.supported, true);
    assert.equal(read(model, unknown)?.supported ?? false, false);
    assert.equal(read(model, unknown)?.externalSupported ?? false, false);
  }
});

test('new real categorical observations earn their own calibration instead of borrowing a sibling count', () => {
  const model = train();
  model.observe('motor', { condition: 'C' }, [['motion', 0, -1]], { motion: 0 });
  assert.equal(read(model, 'C')?.supported ?? false, false, 'one new C window is not eight calibrated C windows');
  assert.equal(read(model, 'C')?.externalSupported ?? false, false);
  for (let i = 0; i < 48; i++) model.observe('motor', { condition: 'C' }, [['motion', 0, -1]], { motion: 0 });
  assert.equal(read(model, 'C')?.supported, true, 'enough genuinely new C windows can support the same measured response');
  assert.equal(read(model, 'C')?.externalSupported, true);
  assert.equal(read(model, 'A')?.supported, true);
  assert.equal(read(model, 'B')?.supported, true);
});

test('missing relevant context never silently becomes a known branch, including after new incomplete measurements', () => {
  const model = train();
  const missing: SensoryState = { nuisance: 9 };
  assert.equal(model.read('motor', 'motion', missing)?.supported ?? false, false);
  assert.equal(model.read('motor', 'motion', missing)?.externalSupported ?? false, false);
  for (let i = 0; i < 16; i++) {
    model.observe('motor', missing, [['motion', 0, -1]], { motion: 0 });
    assert.equal(model.read('motor', 'motion', missing)?.externalSupported ?? false, false,
      'an unlocalized measurement must not erase the response dependency or inherit global calibration');
    assert.equal(read(model, 'A')?.supported, true, 'incomplete new context does not discard calibrated known measurements');
  }
});

test('unrelated extra or absent fields do not invalidate measured response domains', () => {
  const model = train();
  const inputs: SensoryState[] = [{ condition: 'A' }, { condition: 'A', neverSeen: 'new' },
    { condition: 'A', nuisance: 999, novelNumber: 1e9 }];
  for (const input of inputs) {
    const result = model.read('motor', 'motion', input)!;
    assert.equal(result.supported, true); assert.equal(result.externalSupported, true);
    assert.deepEqual(result.dependencies, ['condition']);
  }
  const invariant = new ContextualReadout();
  for (let i = 0; i < 64; i++) invariant.observe('motor', { label: i % 2 ? 'A' : 'B' }, [['motion', 0, 1]], { motion: 0 });
  assert.equal(invariant.read('motor', 'motion', { label: 'C' })?.supported, true,
    'a feature with no measured effect is not a blanket domain restriction');
});

test('numeric points, missing values and intervals share one observed-domain gate', () => {
  const model = train([0, 1]);
  assert.equal(read(model, 0)?.supported, true); assert.equal(read(model, 1)?.supported, true);
  const inputs: SensoryState[] = [{}, { condition: 2 }, { condition: '1' }, { condition: null },
    { condition: NaN }, { condition: Infinity }];
  for (const input of inputs) {
    const result = model.read('motor', 'motion', input);
    assert.equal(result?.supported ?? false, false); assert.equal(result?.externalSupported ?? false, false);
  }
  assert.equal(model.read('motor', 'motion', { condition: 1 }, { condition: [1, 1] })?.supported, true);
  for (const range of [[1, 2], [0, 1], [0, .25], [1, 0], [NaN, 1], [1, Infinity]] as const) {
    const result = model.read('motor', 'motion', { condition: 1 }, { condition: range });
    assert.equal(result?.supported ?? false, false, 'invalid, ambiguous or inconsistent bounds do not certify the point');
    assert.equal(result?.externalSupported ?? false, false);
  }
});

test('numeric support allows floating-point roundoff but does not silently extend the measured domain', () => {
  const model = train([0, 1]);
  assert.equal(read(model, 1 + Number.EPSILON)?.supported, true);
  for (const condition of [-.01, 1.01]) {
    assert.equal(read(model, condition)?.supported ?? false, false);
    assert.equal(read(model, condition)?.externalSupported ?? false, false);
  }
  const uncertain = model.read('motor', 'motion', { condition: 1 }, { condition: [1, 1.01] });
  assert.equal(uncertain?.supported ?? false, false); assert.equal(uncertain?.externalSupported ?? false, false);
});

test('categorical and numeric support domains survive snapshot restoration without added evidence', () => {
  for (const labels of [['A', 'B'], [0, 1]] as const) {
    const model = train(labels), snapshot = model.snapshot(), restored = ContextualReadout.restore(snapshot);
    const inputs: SensoryState[] = [{ condition: labels[0] }, { condition: labels[1] }, { condition: 'C' }, {},
      { condition: labels[1], nuisance: 999 }];
    for (const input of inputs) {
      assert.deepEqual(restored.read('motor', 'motion', input), model.read('motor', 'motion', input));
    }
    assert.equal(restored.read('motor', 'motion', { condition: 'C' })?.externalSupported ?? false, false);
    assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
  }
});

test('an unseen category cannot certify a plan but remains available for an explicitly unsupported probe', () => {
  const medium = new ExperienceMedium(41);
  const action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  const frame = (sequence: number, condition: string, z = 0): Observation => ({ sequence, activeSeconds: sequence / 20,
    contextId: 'synthetic-category-apparatus', self: { position: [0, 0, z], yaw: 0, pitch: 0, properties: { condition } },
    objects: [], targetId: null });
  for (let i = 0; i < 256; i++) {
    const condition = i % 2 ? 'B' : 'A', before = frame(i * 2 + 1, condition), after = frame(i * 2 + 2, condition, i % 2 ? -1 : 1);
    const event: RealEvent = { version: 'RealEventV5', id: 'category:' + i, cue: cueFor(action, before), frames: [before, after],
      trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
      bodyResult: { action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: after.sequence } };
    medium.observe(event);
  }
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'terminal-displacement', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'past-boundary', subject: { kind: 'self' }, observable: 'position.2',
      comparator: 'less-than', target: -.5 } } };
  const offer = (observation: Observation): ActionOfferV1 => ({ version: 'ActionOfferV1', offerId: 'current-motor',
    observationSequence: observation.sequence, action, cue: cueFor(action, observation) });
  const before = JSON.stringify(medium.snapshot()), agent = new ExperienceAgent(medium), known = frame(1000, 'B');
  assert(medium.predict(offer(known).cue, known).supportedFields.includes('self/position.2'));
  assert.equal(agent.plan(goal, known, [offer(known)]).reason, 'predicted-goal');
  const unknown = frame(1000, 'C'), prediction = medium.predict(offer(unknown).cue, unknown);
  assert(!prediction.supportedFields.includes('self/position.2'));
  assert.equal(agent.plan(goal, unknown, [offer(unknown)]).steps.length, 0);
  const probe = medium.predict(offer(unknown).cue, unknown, { probe: true });
  assert.equal(probe.accepted, false); assert.deepEqual(probe.supportedFields, []);
  assert(probe.hypothesizedFields?.includes('self/position.2'));
  assert.equal(JSON.stringify(medium.snapshot()), before);
  assert.deepEqual(ExperienceMedium.restore(medium.snapshot()).predict(offer(unknown).cue, unknown), prediction);
});
