import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DistributedR2APhysicalPatternLearnerV2,
  summarizeDistributedR2AInterventionsV2 }
  from '../src/core/learning/distributed-r2a-physical.js';
import type { DistributedR2AInterventionAssessmentV2 }
  from '../src/core/learning/distributed-r2a-physical-contracts.js';

const assessment = (index: number): DistributedR2AInterventionAssessmentV2 => ({
  version: 'DistributedR2AInterventionPairV2', pairId: `pair-${index}`,
  relationId: 'relation', changedFactorId: 'factor',
  baselineR2EventId: `baseline-${index}`, interventionR2EventId: `intervention-${index}`,
  otherObservedChannelsMatched: true, manipulatedFactorActuallyChanged: true,
  interventionReachedRelationBranch: true,
  fullFactorSelectionRate: .75 + index * .05,
  factorAblationSelectionRate: .5,
  factorAblationLoss: .25 + index * .05,
});

test('incremental intervention aggregate is exactly the former full-rebuild reduction at every grade step', () => {
  const values = Array.from({ length: 4 }, (_unused, index) => assessment(index));
  for (let count = 1; count <= values.length; count++) {
    const prefix = values.slice(0, count);
    const full = prefix.reduce((sum, value) => sum + value.fullFactorSelectionRate, 0) / count;
    const loss = prefix.reduce((sum, value) => sum + value.factorAblationLoss, 0) / count;
    const expectedGrade = count >= 4 && full >= .75 && loss >= .25
      ? 'intervention-supported' : 'causal-hypothesis';
    assert.deepEqual(summarizeDistributedR2AInterventionsV2(prefix, 'predictive-stable', 0, 0), {
      matchedInterventionCount: count,
      physicallyCorrectInterventionCount: count,
      meanFullFactorSelectionRate: full,
      meanFactorAblationLoss: loss,
      grade: expectedGrade,
    });
  }
});

test('intervention aggregate is byte-stable across live insertion and snapshot pair-id order', () => {
  const values = [assessment(3), assessment(0), assessment(2), assessment(1)];
  assert.deepEqual(
    summarizeDistributedR2AInterventionsV2(values, 'predictive-stable', 0, 0),
    summarizeDistributedR2AInterventionsV2([...values].sort((left, right) =>
      left.pairId.localeCompare(right.pairId, 'en')), 'predictive-stable', 0, 0),
  );
});

test('one unchanged physical medium is structurally scanned once across all read-only indexes', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  assert.deepEqual(learner.patterns(), []);
  assert.deepEqual(learner.relations(), []);
  assert.deepEqual(learner.physicalBranches(), []);
  const first = learner.physicalStructurePerformanceAudit();
  assert.equal(first.fullStructureScanCount, 1);
  assert(first.cachedMediumSha256);
  assert.deepEqual(learner.patterns(), []);
  assert.deepEqual(learner.relations(), []);
  assert.deepEqual(learner.physicalBranches(), []);
  assert.deepEqual(learner.physicalStructurePerformanceAudit(), first);
});

test('receipt-only stable-pattern count cannot trigger physical structure discovery', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  assert.equal(learner.indexedStablePatternCount(), 0);
  assert.deepEqual(learner.physicalStructurePerformanceAudit(), {
    fullStructureScanCount: 0,
    cachedMediumSha256: null,
  });
});

test('restore is byte-equivalent and revalidates rather than trusting a stored intervention assessment', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  const state = learner.snapshot();
  const restored = DistributedR2APhysicalPatternLearnerV2.restore(state, () => true);
  assert.deepEqual(restored.snapshot(), state);
  const forged = { ...state, interventions: [assessment(0)] };
  assert.throws(() => DistributedR2APhysicalPatternLearnerV2.restore(forged, () => true),
    /intervention-references-invalid-real-events/);
});

test('record path keeps canonical pair idempotence and never rebuilds unchanged physical relations', async () => {
  const source = await readFile('src/core/learning/distributed-r2a-physical.ts', 'utf8');
  const start = source.indexOf('  recordMatchedIntervention(');
  const batchStart = source.indexOf('  recordMatchedInterventions(', start);
  const end = source.indexOf('\n  compareCurrentFactors(', batchStart);
  assert(start >= 0 && end > start);
  const record = source.slice(start, batchStart);
  const batch = source.slice(batchStart, end);
  assert.match(record, /#interventions\.get\(pairId\)[\s\S]*return structuredClone\(existing\)/);
  assert.match(record, /recordMatchedInterventions\(\[value\]\)/);
  assert.match(batch, /#refreshInterventionAggregate\(relationId\)/);
  assert.doesNotMatch(record, /#rebuildPhysicalRelations\(/);
});
