import assert from 'node:assert/strict';
import test from 'node:test';
import { experimentOscillatorSlotV1 } from '../src/control/experiment-oscillator.js';
import { metaAuthorityDecisionV1, META_INTERVENTION_AUTHORITY_CAP_V1,
  META_PREDICTIVE_AUTHORITY_CAP_V1 } from '../src/control/meta-authority.js';

test('experiment oscillator is phase-locked and independent of control state', () => {
  assert.deepEqual(experimentOscillatorSlotV1(0, 'aa'), experimentOscillatorSlotV1(7.99, 'aa'));
  assert.deepEqual(experimentOscillatorSlotV1(32, 'aa'), experimentOscillatorSlotV1(39.99, 'aa'));
  assert.equal(experimentOscillatorSlotV1(8, 'aa').scheduled, false);
  assert.equal(experimentOscillatorSlotV1(32, 'aa').scheduled, true);
  assert.notDeepEqual(experimentOscillatorSlotV1(32, 'aa'), experimentOscillatorSlotV1(32, 'ff'));
  assert.throws(() => experimentOscillatorSlotV1(-1, 'aa'), /nonnegative/);
});

test('meta authority is zero during validation and capped after qualification', () => {
  assert.deepEqual(metaAuthorityDecisionV1('meta-predictive-stable', true), {
    version: 'MetaAuthorityDecisionV1', grade: 'meta-predictive-stable',
    prospectiveValidation: true, driveBias: 0, interventionEligible: false,
  });
  assert.equal(metaAuthorityDecisionV1('meta-predictive-stable').driveBias,
    META_PREDICTIVE_AUTHORITY_CAP_V1);
  assert.equal(metaAuthorityDecisionV1('meta-intervention-supported').driveBias,
    META_INTERVENTION_AUTHORITY_CAP_V1);
  assert.equal(metaAuthorityDecisionV1('meta-repeated').driveBias, 0);
  assert.equal(metaAuthorityDecisionV1('insufficient').interventionEligible, false);
});
