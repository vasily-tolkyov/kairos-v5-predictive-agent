import test from 'node:test';
import assert from 'node:assert/strict';
import { matches } from '../src/memory.js';
import { CASES, SealedToolFixture } from '../src/analysis-harness.js';
import { CognitiveWorkspace } from '../src/cognitive-workspace.js';
import { PublicObjectAliases } from '../src/analysis-actions.js';
import { SYSTEM_PROMPT } from '../src/analysis.js';
import type { PublicChange, Observation } from '../src/contracts.js';

const frame: Observation = { sequence: 40, activeSeconds: 2, contextId: 'isolated-test', targetId: null,
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot: 4, health: 20 } },
  objects: [{ id: 'visible-id', type: 'test_lamp', relativePosition: [0, 1, -2], properties: { lit: false } }] };
const change = (subject: string, property: string, before: number, after: number): PublicChange =>
  ({ subject, property, before, after, observationIndex: 1, meaning: 'observed-co-occurrence' });

test('real matching contract is exact for self, properties, values and historical object roles', () => {
  const c = change('self', 'selectedSlot', 4, 7);
  assert.equal(matches(c, { subject: 'self', property: 'selectedSlot', value: 7 }), true);
  for (const q of [{ subject: 'body' }, { subject: 'selectedSlot', property: 'value' }, { property: 'health' }, { value: 4 }])
    assert.equal(matches(c, q), false);
  assert.equal(matches(change('test_lamp#1', 'level', 0, 1), { subject: 'test_lamp', property: 'level', direction: 'increase' }), true);
  assert.equal(matches(change('test_lamp#1', 'level', 0, 1), { subject: 'o1' }), false);
});

test('sealed fixture cannot return an unrelated change for an incorrectly filled recall condition', async () => {
  const spec = CASES.find(c => c.kind === 'supported-history')!;
  const fixture = new SealedToolFixture(spec, new PublicObjectAliases().present(frame));
  for (const q of [{ subject: 'selectedSlot', property: 'value', value: 2 }, { subject: 'body', property: 'selectedSlot' },
    { subject: 'self', property: 'nonexistent-property' }]) {
    const r: any = await fixture.recall(q, 0);
    assert.equal(r.candidates.length, 0, JSON.stringify(q));
  }
});

test('current body facts explicitly expose self and historical roles separately from action aliases', () => {
  const presented = new PublicObjectAliases().present(frame) as any;
  assert.equal(presented.body.subject, 'self');
  assert.equal(presented.objects[0].id, 'o1');
  assert.equal(presented.objects[0].historyQuerySubject, 'test_lamp');
  assert.ok(presented.queryVocabulary.selfProperties.includes('selectedSlot'));
});

test('workspace sends public recall summaries rather than internal trace geometry or hashes', () => {
  const w = new CognitiveWorkspace(); w.startGoal('test context');
  w.observe(new PublicObjectAliases().present(frame));
  w.addEvidence('historical-experience', 'recall', { kind: 'historical-observation', total: 1, nextOffset: null,
    candidates: [{ eventId: 'e1', action: { kind: 'select-hotbar', parameters: { slot: 7 } },
      actualObserved: [change('self', 'selectedSlot', 4, 7)], observedBefore: { onGround: true },
      currentApplicability: { coreEvidenceSupport: .8 }, unknown: ['history is not now'],
      r1: { pageId: 'internal-r1-page', traceId: 'internal-trace' }, r2: [9876, 5432, 1011],
      r2a: [{ factorIds: ['internal-graph-node'], physicalKernels: new Array(40).fill([1, 2, 3]) }] }] });
  const text = w.material().text;
  assert.ok(text.includes('selectedSlot') && text.includes('coreEvidenceSupport'));
  assert.ok(!text.includes('internal-r1-page') && !text.includes('internal-graph-node') && !text.includes('9876'));
});

test('all six modes are named in the invariant prompt without a forced transition', () => {
  for (const mode of ['orient', 'recall', 'plan', 'act', 'explore', 'review']) assert.ok(SYSTEM_PROMPT.includes(mode), mode);
});

test('ordinary absent crosshair returns no-target body fact instead of an exception in the fixture', async () => {
  const spec = CASES.find(c => c.mode === 'act')!;
  const fixture = new SealedToolFixture(spec, new PublicObjectAliases().present(frame));
  const r = await fixture.execute([{ kind: 'interact', targetId: 'o1', parameters: {} }]) as any;
  assert.equal(r.results[0].executed, false);
  assert.equal(r.results[0].status, 'no-target');
  assert.equal(fixture.actions.length, 0);
});
