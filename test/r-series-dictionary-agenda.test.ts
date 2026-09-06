import test from 'node:test';
import assert from 'node:assert/strict';
import { AttractorPublicEventDictionaryStoreV1, publicReadoutSignatureV1 } from '../src/core/learning/attractor-public-dictionary.js';
import { InterventionAgendaStoreV1, interventionPairIdentityV1 } from '../src/core/learning/intervention-agenda.js';
import { KairosV5RSeriesRuntimeV1, KAIROS_V5_R_SERIES_NAMESPACE_V1 }
  from '../src/r-series-runtime.js';
import { InterventionPairCollectorV1 } from '../src/core/learning/intervention-pair-collector.js';

const readout = (core: number[] = [1, 2]) => ({
  version: 'DistributedAttractorReadoutV1' as const, coreSiteIds: core,
  dwellSteps: 40, returnRate: .8, escapeRate: .1,
  evidenceLevel: 'predictive-stable' as const, ambiguous: false,
  terminalActivations: core.map(siteId => ({ siteId, meanActivation: .8 })),
  run: { version: 'DistributedFieldRunV1' as const, steps: 180, acceptedSteps: 10, rejectedSteps: 170, leaderSiteIds: core,
    finalActivations: core.map(siteId => ({ siteId, activation: .8 })) },
});

test('attractor dictionary names only observed physical readouts and preserves unknown/ambiguous', () => {
  const store = new AttractorPublicEventDictionaryStoreV1('R1-v5');
  const before = store.snapshot();
  const change = { subject: 'public-object', property: 'active', before: false, after: true,
    observationIndex: 3, meaning: 'observed-co-occurrence' as const };
  for (let index = 0; index < 8; index += 1) {
    store.observe({ source: 'trusted-real-event', sourceEventId: `event-${index}`,
      contextId: `context-${index % 4}`, mediumVersion: 'R1-v5', readout: readout(), publicEvent: [change] });
  }
  const resolved = store.resolve('R1-v5', readout());
  assert.equal(resolved.status, 'resolved');
  assert.deepEqual(resolved.publicEvent.map(value => value.after), [true]);
  assert.equal(store.resolve('R1-v5', readout([99])).status, 'unknown');
  assert.equal(store.snapshot().entries[0]?.status, 'stable');
  assert.equal(before.entries.length, 0);
  const signature = publicReadoutSignatureV1('R1-v5', readout());
  assert.equal(signature.signature.length, 64);
});

test('conflicting observations become ambiguous without majority coercion', () => {
  const store = new AttractorPublicEventDictionaryStoreV1('R1-v5');
  for (let index = 0; index < 2; index += 1) store.observe({ source: 'trusted-real-event',
    sourceEventId: `a-${index}`, contextId: `a-context-${index}`, mediumVersion: 'R1-v5', readout: readout(), publicEvent: [{
      subject: 'x', property: 'value', before: 0, after: 1, observationIndex: 0, meaning: 'observed-co-occurrence' } ] });
  store.observe({ source: 'trusted-real-event', sourceEventId: 'b', contextId: 'b-context', mediumVersion: 'R1-v5', readout: readout(), publicEvent: [{
    subject: 'x', property: 'value', before: 0, after: 2, observationIndex: 0, meaning: 'observed-co-occurrence' }] });
  assert.equal(store.resolve('R1-v5', readout()).status, 'ambiguous');
});

test('intervention cells open only after two physical violations and grade four matched arms', () => {
  const agenda = new InterventionAgendaStoreV1();
  const violation = (contextId: string) => agenda.recordPredictionViolation({
    source: 'trusted-real-prediction-outcome', sourceEventId: `event-${contextId}`, combinationId: 'combo', physicalPrefixId: 'prefix',
    predictedAttractorSignature: 'predicted', terminalAttractorSignature: 'actual',
    factorIds: ['factor-q', 'factor-r'], contextId, highConfidence: true,
  });
  assert.equal(violation('c0')?.violationCount, 1);
  assert.equal(violation('c0')?.violationCount, 1);
  assert.equal(violation('c1')?.violationCount, 2);
  assert.equal(agenda.pending()[0]?.status, 'open');
  assert.deepEqual(agenda.pendingArmRequests().map(value => value.arm),
    ['baseline', 'q-only', 'q+r', 'r-only']);
  for (const arm of ['baseline', 'q-only', 'r-only', 'q+r'] as const) for (let index = 0; index < 4; index += 1)
    agenda.recordMatchedArm({ source: 'trusted-real-intervention-result', pairId: interventionPairIdentityV1('combo', arm,
      `${arm}-b-${index}`, `${arm}-i-${index}`), combinationId: 'combo',
      factorIds: ['factor-q', 'factor-r'], arm, baselineEventId: `${arm}-b-${index}`,
      interventionEventId: `${arm}-i-${index}`, contextId: `context-${index}`, samePrefix: true,
      sameAction: true, onlyPlannedFactorsChanged: true, physicalBranchSelectionRate: 1,
      factorAblationLoss: .5 });
  assert.equal(agenda.snapshot().cells[0]?.status, 'intervention-supported');
});

test('R-series checkpoint is a distinct namespace and restores byte-identically', () => {
  const runtime = new KairosV5RSeriesRuntimeV1();
  const checkpoint = runtime.snapshot();
  assert.equal(checkpoint.namespace, KAIROS_V5_R_SERIES_NAMESPACE_V1);
  assert.deepEqual(KairosV5RSeriesRuntimeV1.restore(checkpoint).snapshot(), checkpoint);
  assert.throws(() => KairosV5RSeriesRuntimeV1.restore({
    ...checkpoint, namespace: 'legacy' as typeof KAIROS_V5_R_SERIES_NAMESPACE_V1,
  }), /namespace-invalid/);
});

test('intervention pair collector derives matched arms from real factor states', () => {
  const collector = new InterventionPairCollectorV1();
  const window = (eventId: string, q: 'active' | 'inactive', r: 'active' | 'inactive') => ({
    version: 'TrustedInterventionWindowV1' as const, source: 'trusted-real-event-window' as const,
    eventId, contextId: 'ctx', physicalPrefixId: 'prefix', exactActionIdentity: 'action',
    factorStates: [{ factorId: 'q', state: q }, { factorId: 'r', state: r }],
    terminalAttractorSignature: `terminal-${eventId}`,
  });
  assert.deepEqual(collector.add(window('baseline', 'inactive', 'inactive')), []);
  const pairs = collector.add(window('q', 'active', 'inactive'));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.arm, 'q-only');
  assert.equal(pairs[0]?.samePrefix, true);
  assert.deepEqual(InterventionPairCollectorV1.restore(collector.snapshot()).snapshot(), collector.snapshot());
});
