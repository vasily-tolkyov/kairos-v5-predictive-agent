import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import {
  buildConsolidationReplayPlanV1,
  executeConsolidationReplayV1,
  idleForConsolidationReplayV1,
  type ReplayWritePortV1,
} from '../src/core/learning/consolidation-replay.js';

function sourceSnapshot() {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'replay-source', seedHex: '2002' });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'trace-b', offset: 0,
    drives: [{ siteId: 0, intensity: 0.8 }] });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'trace-a', offset: 0,
    drives: [{ siteId: 1, intensity: 0.8 }] });
  return medium.snapshot();
}

test('idle replay selection is deterministic and requires the controller idle signals', () => {
  const snapshot = sourceSnapshot();
  const left = buildConsolidationReplayPlanV1(snapshot, 'ab', 2);
  const right = buildConsolidationReplayPlanV1(snapshot, 'ab', 2);
  assert.deepEqual(left, right);
  assert.equal(left.provenance, 'replay');
  assert.equal(idleForConsolidationReplayV1({ goalActive: false, pendingAttention: false, novelty: 0, unknown: 0 }), true);
  assert.equal(idleForConsolidationReplayV1({ goalActive: true, pendingAttention: false, novelty: 0, unknown: 0 }), false);
  assert.equal(idleForConsolidationReplayV1({ goalActive: false, pendingAttention: false, novelty: 0.2, unknown: 0 }), false);
});

test('replay writer surface can only refresh existing physical structures', () => {
  const plan = buildConsolidationReplayPlanV1(sourceSnapshot(), 'ab', 1);
  const calls: string[] = [];
  const writer: ReplayWritePortV1 = {
    refreshPotentialDepth: (siteId, amount) => calls.push(`site:${siteId}:${amount}`),
    strengthenExistingBond: (reference, amount) => calls.push(`bond:${reference.fromSiteId}>${reference.toSiteId}:${amount}`),
    recordRehearsal: traceId => calls.push(`rehearsal:${traceId}`),
    homeostaticDownscale: factor => calls.push(`homeostasis:${factor}`),
  };
  const receipt = executeConsolidationReplayV1(plan, writer);
  assert.equal(receipt.provenance, 'replay');
  assert.ok(calls.some(call => call.startsWith('site:')));
  assert.ok(calls.some(call => call.startsWith('rehearsal:')));
  assert.equal(calls.some(call => call.includes('supportMass') || call.includes('evidence')), false);
});
