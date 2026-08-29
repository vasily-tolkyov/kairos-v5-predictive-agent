import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Observation, BodyResult, RealEvent, Action } from '../src/contracts.js';
import type { MinecraftBody } from '../src/body.js';
import type { Compute } from '../src/compute.js';
import type { Configuration } from '../src/services.js';
import { V5Runtime } from '../src/runtime.js';

test('real runtime context/notes/alias display never write; a delivered attention notice stops the unexecuted chain', async () => {
  let physicalWrites = 0, bodyCalls = 0, hashCalls = 0, runtime: V5Runtime;
  let frame: Observation = { sequence: 1, activeSeconds: .05, targetId: null, contextId: 'unit-test-only',
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} }, objects: [] };
  const mockBody = Object.assign(new EventEmitter(), { executing: false, check() {}, latest: () => frame,
    async execute(action: Action) {
      bodyCalls++; const before = frame;
      frame = { ...frame, sequence: frame.sequence + 1, activeSeconds: frame.activeSeconds + .05,
        self: { ...frame.self, position: [0, .1, 0] } };
      const result: BodyResult = { action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: frame.sequence };
      const event: RealEvent = { version: 'RealEventV5', id: 'explicit-synthetic-not-physical-proof', cue: { kind: action.kind, parameters: action.parameters, targetRole: null },
        frames: [before, frame], trackedIds: ['self'], bodyResult: result, provenance: 'executed-real-body', complete: true };
      const notice = { kind: 'unknown-change' as const, subjectId: 'self', sequence: frame.sequence, forecastCompletedBeforeSequence: null,
        evidence: { changes: [{ before: 0, after: .1 }], unknown: 'test-notification-boundary-not-a-producer-qualification' } };
      runtime.attention.notices.push(notice); runtime.attention.wake(notice);
      return { result, event };
    }, async close() {} });
  const mockCompute = { async call(method: string) {
    if (method === 'observe') return { writes: ++physicalWrites, buffered: 0, mapSha256: null };
    if (method === 'hash') { hashCalls++; return 'unchanged-core-test-double'; }
    if (method === 'predict') return { kind: 'hypothetical-prediction', support: 0, samples: [], evidence: null, unknown: ['empty'], mapSha256: null };
    return { candidates: [] };
  }, async close() {} };
  runtime = new V5Runtime(mockBody as unknown as MinecraftBody, { actionBudget: 512, analysis: {
    baseUrl: 'http://127.0.0.1:18080/v1', context: 8192, maximumOutputTokens: 768, timeoutMs: 2000,
    nativeThinking: false, temperature: 0, topP: 1, topK: 0, minP: 0, presencePenalty: 0, seed: 1 } } as Configuration,
    'D:/Kairos_V5_Predictive_Agent/tmp/not-written-by-test', () => {}, { compute: mockCompute as unknown as Compute });
  runtime.analysis.workspace.startGoal('retain this original task');
  const goalBefore = runtime.analysis.workspace.read('t0');
  for (let i = 0; i < 5; i++) { runtime.context(); runtime.display(); await runtime.observe(); }
  await runtime.recall({ direction: 'change' }, 0);
  const prediction = await runtime.predict({ kind: 'jump', parameters: { forward: false, ticks: 4 } }, ['hypothesis only']) as any;
  assert.equal(prediction.assumptions.status, '未模拟的假设'); assert.equal(prediction.assumptions.usedByPhysicalPrediction, false);
  assert.equal(physicalWrites, 0); assert.equal(bodyCalls, 0);
  assert.equal(hashCalls, 0, 'whole-core serialization must not be on the production prediction hot path');
  const result = await runtime.execute([{ kind: 'jump', parameters: { forward: false, ticks: 4 } }, { kind: 'wait', parameters: { ticks: 4 } }]) as any;
  assert.equal(result.interrupted, true); assert.equal(result.remainingActionsNotExecuted, 1);
  assert.equal(bodyCalls, 1); assert.equal(physicalWrites, 1); assert.deepEqual(runtime.analysis.workspace.read('t0'), goalBefore);
  const notice = runtime.analysis.workspace.evidence(runtime.analysis.workspace.snapshot().pendingAttention[0]!);
  assert.deepEqual((notice.data as any).evidence.changes, [{ before: 0, after: .1 }]); assert.equal(notice.observationSequence, 2);
  await runtime.close();
});
