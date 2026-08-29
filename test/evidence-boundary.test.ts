import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT, MODE_PROMPTS, TOOL_SCHEMAS } from '../src/analysis.js';
import { EVIDENCE_BOUNDARY_CASES, EVIDENCE_BOUNDARY_FIXTURES, SealedToolFixture } from '../src/analysis-harness.js';
import { sha } from '../src/util.js';

test('only one generic evidence-boundary paragraph changes; tools, mode prompts and model authority do not change', () => {
  const rule = '变化是否影响当前目标，与变化是否由上次行动造成，是两个不同问题。目标仍满足不证明变化之间没有因果关系；缺少已引用的受控对照或已验证条件证据时，只报告观察、时序或共现，并保留原因未知。无需先解决所有原因才能继续、修订或结束目标。';
  assert.equal(SYSTEM_PROMPT.split(rule).length, 2);
  assert.equal(sha({ SYSTEM_PROMPT: SYSTEM_PROMPT.replace(rule + '\n', ''), MODE_PROMPTS }),
    '65231bb55addcae9f517f930c0861fa22bfe2d8055513ecd5518dd2d5fa8d459');
  assert.equal(sha(TOOL_SCHEMAS), '3ea5953fe8d07164198e454d0be443aa4d8bb1f9630b3fff0d22ed3d1b278270');
  assert.ok(!/槽位|生命|food|health|\d/.test(rule));
});

for (const [index, target] of [5, 8].entries()) test(`new boundary fixture ${index + 1} preserves the production matcher, body result and a separate real test notice`, async () => {
  const publicFrame = { sequence: 40, activeSeconds: 2, body: { selectedSlot: 4, health: 20, food: 20 }, objects: [], crosshair: null };
  const spec = EVIDENCE_BOUNDARY_CASES[index]!, options = EVIDENCE_BOUNDARY_FIXTURES[index]!;
  const fixture = new SealedToolFixture(spec, publicFrame, options);
  let notice: any; fixture.core = { wake: (n: unknown) => { notice = n; } } as any;
  assert.deepEqual((await fixture.recall({ direction: 'change' }, 0) as any).candidates, []);
  assert.equal((await fixture.predict({ kind: 'select-hotbar', parameters: { slot: target } }, []) as any).support, 0);
  const r = await fixture.execute([{ kind: 'select-hotbar', parameters: { slot: target } }]) as any;
  assert.equal(r.results[0].executed, true);
  assert.equal(r.results[0].after.selectedSlot, index === 0 ? target : options.initialBody!.selectedSlot);
  assert.equal(r.results[0].actualChange, index === 0);
  assert.equal(notice.sequence, r.publicObservation.sequence);
  assert.ok(notice.sequence > r.results[0].endSequence);
  const change = notice.evidence.changes[0];
  assert.equal(r.results[0].after[change.property], change.before);
  assert.equal(r.publicObservation.body[change.property], change.after);
  assert.equal(notice.evidence.prediction, null); assert.equal(change.meaning, 'observed-co-occurrence');
  assert.deepEqual(publicFrame.body, { selectedSlot: 4, health: 20, food: 20 });
});
