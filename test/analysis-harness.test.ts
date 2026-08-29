import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, scoreCase, SealedToolFixture, auditOldQueries, type CaseResult } from '../src/analysis-harness.js';
import { CognitiveWorkspace } from '../src/cognitive-workspace.js';
import { matches } from '../src/memory.js';

const publicFrame = { sequence: 40, activeSeconds: 2, body: { subject: 'self', health: 20, selectedSlot: 4, yawDegrees: 0, pitchDegrees: 0 },
  objects: [{ id: 'o1', type: 'copper_bulb', historyQuerySubject: 'copper_bulb', positionFRU: [2, 0, 0], properties: { lit: false } },
    { id: 'o2', type: 'copper_bulb', historyQuerySubject: 'copper_bulb', positionFRU: [6, 0, 0], properties: { lit: true } }], crosshair: null };

test('new driver separates three first questions, five conditional questions and isolated initial modes', () => {
  assert.equal(CASES.length, 8);
  assert.deepEqual(CASES.slice(0, 6).map(c => c.mode), ['orient', 'recall', 'plan', 'act', 'explore', 'review']);
  assert.ok(CASES.slice(6).every(c => c.mode === 'orient'));
  assert.equal(new Set(CASES.map(c => c.id)).size, 8);
});
test('all 17 historical wrong-query counterexamples are rejected by the unmodified production matcher', async () => {
  const audit = await auditOldQueries() as any;
  assert.equal(audit.calls, 22); assert.equal(audit.nonempty, 17); assert.equal(audit.mismatchedNonempty, 17);
  assert.ok(audit.queries.flatMap((q: any) => q.correctExactQueryResults).every((q: any) => q.matches));
});
test('fixture uses real matching and pagination across self, a second property and two same-type historical roles', async () => {
  const fixture = new SealedToolFixture(CASES[1]!, publicFrame);
  for (const query of [{ subject: 'self', property: 'health', direction: 'decrease' as const }, { property: 'food', value: 20 },
    { subject: 'copper_bulb', property: 'lit' }, { subject: 'copper_bulb#2', property: 'lit', value: false }]) {
    const r = await fixture.recall(query, 0) as any;
    assert.ok(r.candidates.length > 0);
    assert.ok(r.candidates.every((c: any) => c.actualObserved.every((change: any) => matches(change, query))));
  }
  const type = await fixture.recall({ subject: 'copper_bulb', property: 'lit' }, 0) as any;
  assert.deepEqual(type.candidates.map((c: any) => c.actualObserved[0].subject), ['copper_bulb#1', 'copper_bulb#2']);
  assert.ok(type.candidates.every((c: any) => c.action.targetId === undefined && c.action.targetRole === 'copper_bulb'));
  assert.equal((await fixture.recall({ subject: 'o1', property: 'lit' }, 0) as any).candidates.length, 0);
  const pages = await Promise.all([0, 2, 4].map(offset => fixture.recall({ subject: 'self', property: 'selectedSlot', value: 7 }, offset))) as any[];
  assert.deepEqual(pages.map(p => p.candidates.length), [2, 2, 1]);
  assert.deepEqual(pages.map(p => p.nextOffset), [2, 4, null]); assert.ok(pages.every(p => p.total === 5));
});
test('normal fixture body failure distinguishes absent crosshair, range and executed no-effect', async () => {
  const f = new SealedToolFixture(CASES[3]!, publicFrame);
  let r = await f.execute([{ kind: 'interact', targetId: 'o1', parameters: {} }]) as any;
  assert.equal(r.results[0].status, 'no-target'); assert.equal(r.results[0].executed, false);
  f.observation.crosshair = 'o2';
  r = await f.execute([{ kind: 'interact', targetId: 'o2', parameters: {} }]) as any;
  assert.equal(r.results[0].status, 'out-of-reach'); assert.equal(r.results[0].executed, false);
  r = await f.execute([{ kind: 'select-hotbar', parameters: { slot: 7 } }]) as any;
  assert.equal(r.results[0].executed, true); assert.equal(r.results[0].actualChange, false);
  assert.equal(f.actions.length, 1); assert.equal(f.attempts.length, 3); assert.equal(f.observation.body.selectedSlot, 4);
});
test('externally scheduled new facts and notification share exact sequence/subject/value with latest state', async () => {
  const f = new SealedToolFixture(CASES[5]!, publicFrame);
  const old = (f.context() as any).publicObservation;
  const now = (f.context() as any).publicObservation;
  assert.equal(old.body.selectedSlot, 4); assert.equal(now.body.selectedSlot, 3); assert.ok(now.sequence > old.sequence);
  assert.equal((await f.observe() as any).publicObservation.sequence, now.sequence);
  const interrupt = new SealedToolFixture(CASES[7]!, publicFrame); let notice: any;
  interrupt.core = { wake(n: unknown) { notice = n; } } as any;
  const r = await interrupt.execute([{ kind: 'select-hotbar', parameters: { slot: 7 } }, { kind: 'wait', parameters: { ticks: 1 } }]) as any;
  assert.equal(r.interrupted, true); assert.equal(r.remainingActionsNotExecuted, 1); assert.equal(interrupt.actions.length, 1);
  assert.equal(notice.sequence, r.publicObservation.sequence); assert.equal(notice.subjectId, 'self');
  assert.equal(notice.evidence.changes[0].after, r.publicObservation.body.health);
});
function resultFor(specIndex: number, report: string): CaseResult {
  const w = new CognitiveWorkspace(); w.startGoal(CASES[specIndex]!.goal);
  const e = w.observe(publicFrame).evidence;
  return { id: CASES[specIndex]!.id, calls: 1, milliseconds: 1, finish: { status: 'completed', report }, error: null,
    workspace: w.snapshot(), fixtureActions: [], fixtureAttempts: [], finalPublicObservation: publicFrame, physicalActions: 0, physicalWrites: 0,
    events: [{ kind: 'analysis-request', time: '', value: { mode: 'orient', inputTokens: 1000 } },
      { kind: 'tool-end', time: '', value: { name: 'finish', args: { evidenceRefs: [e.ref] } } }] };
}
test('post-hoc score cannot convert a cited historical value into current fact or count a no-op as exploration', () => {
  const wrong = scoreCase(CASES[0]!, resultFor(0, '当前选中槽位为7，已经满足。'));
  assert.equal(wrong.checks.currentFactNotHistoricalAfter, false); assert.equal(wrong.passed, false);
  const current = scoreCase(CASES[0]!, resultFor(0, '当前选中槽位为4，尚未达到7。'));
  assert.equal(current.checks.currentFactNotHistoricalAfter, true); assert.equal(current.checks.historyActuallyRead, false);
  const noop = resultFor(4, '我探索成功'); noop.fixtureActions = [{ kind: 'look', parameters: { yawDegrees: 0, pitchDegrees: 0 } }];
  assert.equal(scoreCase(CASES[4]!, noop).checks.notZeroAngleNoOp, false);
});
test('completion of a candid no-effect attempt is separate from completion of the desired world state', () => {
  const result = resultFor(3, '已完成尝试，当前槽位仍为4，未实现目标7。');
  const w = new CognitiveWorkspace(); w.startGoal('test');
  const e = w.addEvidence('actual-action', 'execute_chain', { results: [{ executed: true, actualChange: false }] });
  result.workspace = w.snapshot(); result.fixtureAttempts = [{ executed: true }];
  result.events = [{ kind: 'tool-end', time: '', value: { name: 'finish', args: { evidenceRefs: [e.ref] } } }];
  assert.equal(scoreCase(CASES[3]!, result).checks.attemptVsGoalReported, true);
});
