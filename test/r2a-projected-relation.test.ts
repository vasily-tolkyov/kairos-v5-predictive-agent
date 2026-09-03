import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareProjectedR2ARelationV1,
  selectProjectedR2ARelationV1,
} from '../src/core/learning/r2a-stable-pattern.js';
import type {
  R2ACurrentFactorComparisonV1,
  R2AEvidenceGradeV1,
  R2AProjectedFactorDeltaV1,
} from '../src/core/learning/r2a-stable-pattern.js';

function current(options: {
  readonly relationId?: string;
  readonly required?: readonly string[];
  readonly matched?: readonly string[];
  readonly conflicted?: readonly string[];
  readonly unknown?: readonly string[];
  readonly grade?: R2AEvidenceGradeV1;
  readonly physicalPatternActive?: boolean;
} = {}): R2ACurrentFactorComparisonV1 {
  const required = options.required ?? ['opaque-factor-1', 'opaque-factor-2'];
  const matched = options.matched ?? [];
  const conflicted = options.conflicted ?? required.filter(value => !matched.includes(value)
    && !(options.unknown ?? []).includes(value));
  const unknown = options.unknown ?? [];
  return {
    version: 'R2ACurrentFactorComparisonV1',
    relationId: options.relationId ?? 'opaque-relation-parent',
    targetPatternId: `pattern:${options.relationId ?? 'opaque-relation-parent'}`,
    requiredFactorIds: required,
    matchedFactorIds: matched,
    conflictedFactorIds: conflicted,
    unknownFactorIds: unknown,
    physicalPatternActive: options.physicalPatternActive ?? true,
    applicability: conflicted.length === 0 && unknown.length === 0 ? 0.8 : 0,
    evidenceGrade: options.grade ?? 'intervention-supported',
    predictionEligible: false,
    highConfidenceActionEligible: false,
  };
}

function delta(options: {
  readonly activated?: readonly string[];
  readonly deactivated?: readonly string[];
  readonly unknown?: readonly string[];
  readonly r1?: boolean;
  readonly r2?: boolean;
} = {}): R2AProjectedFactorDeltaV1 {
  return {
    version: 'R2AProjectedFactorDeltaV1',
    activatedFactorIds: options.activated ?? [],
    deactivatedFactorIds: options.deactivated ?? [],
    unknownFactorIds: options.unknown ?? [],
    sourceR1Active: options.r1 ?? true,
    sourceR2Active: options.r2 ?? true,
  };
}

test('a projected activation of only one required factor cannot unlock the parent relation', () => {
  const result = compareProjectedR2ARelationV1(current(), delta({ activated: ['opaque-factor-1'] }));
  assert.deepEqual(result.matchedFactorIds, ['opaque-factor-1']);
  assert.deepEqual(result.conflictedFactorIds, ['opaque-factor-2']);
  assert.deepEqual(result.unknownFactorIds, []);
  assert.equal(result.applicability, 0);
  assert.equal(result.predictionEligible, false);
  assert.equal(result.productionEligible, false);
});

test('all required projected factors must be satisfied before the parent relation is eligible', () => {
  const result = compareProjectedR2ARelationV1(current(), delta({
    activated: ['opaque-factor-2', 'opaque-factor-1'],
  }));
  assert.deepEqual(result.matchedFactorIds, ['opaque-factor-1', 'opaque-factor-2']);
  assert.deepEqual(result.conflictedFactorIds, []);
  assert.deepEqual(result.unknownFactorIds, []);
  assert.equal(result.applicability, 1);
  assert.equal(result.predictionEligible, true);
  assert.equal(result.productionEligible, true);
});

test('projected conflict and unknown evidence cannot be counted as a match', () => {
  const conflict = compareProjectedR2ARelationV1(current({ matched: ['opaque-factor-1'] }), delta({
    deactivated: ['opaque-factor-1'], activated: ['opaque-factor-2'],
  }));
  assert.deepEqual(conflict.conflictedFactorIds, ['opaque-factor-1']);
  assert.equal(conflict.productionEligible, false);

  const unknown = compareProjectedR2ARelationV1(current(), delta({
    activated: ['opaque-factor-1'], unknown: ['opaque-factor-2'],
  }));
  assert.deepEqual(unknown.unknownFactorIds, ['opaque-factor-2']);
  assert.equal(unknown.applicability, 0);
  assert.equal(unknown.productionEligible, false);
});

test('a physically unknown current factor remains unknown under a hypothetical activation', () => {
  const result = compareProjectedR2ARelationV1(current({
    conflicted: ['opaque-factor-2'], unknown: ['opaque-factor-1'],
  }), delta({ activated: ['opaque-factor-1', 'opaque-factor-2'] }));
  assert.deepEqual(result.matchedFactorIds, ['opaque-factor-2']);
  assert.deepEqual(result.unknownFactorIds, ['opaque-factor-1']);
  assert.equal(result.productionEligible, false);
});

test('evidence grade is preserved and a provisional relation is never upgraded by projection', () => {
  const stable = compareProjectedR2ARelationV1(current({ grade: 'predictive-stable' }), delta({
    activated: ['opaque-factor-1', 'opaque-factor-2'],
  }));
  assert.equal(stable.evidenceGrade, 'predictive-stable');
  assert.equal(stable.predictionEligible, true);
  assert.equal(stable.productionEligible, false);

  const provisional = compareProjectedR2ARelationV1(current({ grade: 'repeated-correlation' }), delta({
    activated: ['opaque-factor-1', 'opaque-factor-2'],
  }));
  assert.equal(provisional.evidenceGrade, 'repeated-correlation');
  assert.equal(provisional.predictionEligible, false);
  assert.equal(provisional.productionEligible, false);
});

test('inactive R1, R2, or R2A physical support independently disables projected eligibility', () => {
  const activation = ['opaque-factor-1', 'opaque-factor-2'];
  for (const value of [
    compareProjectedR2ARelationV1(current(), delta({ activated: activation, r1: false })),
    compareProjectedR2ARelationV1(current(), delta({ activated: activation, r2: false })),
    compareProjectedR2ARelationV1(current({ physicalPatternActive: false }), delta({ activated: activation })),
  ]) {
    assert.equal(value.productionEligible, false);
    assert.equal(value.predictionEligible, false);
  }
});

test('multi-relation selection retains every result and follows production-first semantics', () => {
  const result = selectProjectedR2ARelationV1([
    current({ relationId: 'relation-a-predictive', required: ['opaque-factor-1'],
      grade: 'predictive-stable' }),
    current({ relationId: 'relation-z-production', required: ['opaque-factor-1'],
      grade: 'intervention-supported' }),
  ], delta({ activated: ['opaque-factor-1'] }));
  assert.equal(result.memberResults.length, 2);
  assert.equal(result.selectedRelationId, 'relation-z-production');
  assert.equal(result.selected?.productionEligible, true);
});

test('projected relation queries are read-only and reject ambiguous factor partitions', () => {
  const relation = current();
  const projected = delta({ activated: ['opaque-factor-1'] });
  const before = JSON.stringify({ relation, projected });
  compareProjectedR2ARelationV1(relation, projected);
  selectProjectedR2ARelationV1([relation], projected);
  assert.equal(JSON.stringify({ relation, projected }), before);

  assert.throws(() => compareProjectedR2ARelationV1(relation, delta({
    activated: ['opaque-factor-1'], unknown: ['opaque-factor-1'],
  })), /projected-factor-state-delta-partition-invalid/);
  assert.throws(() => compareProjectedR2ARelationV1(relation, delta({
    activated: ['opaque-factor-1', 'opaque-factor-1'],
  })), /identity-duplicated/);
});
