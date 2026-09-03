import test from 'node:test';
import assert from 'node:assert/strict';
import {
  R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
  R2ContinuousEventStore,
} from '../src/core/learning/r2-continuous-event.js';
import type {
  R1ClosedEventAtomV1,
  R2CompleteBoundaryReasonV1,
} from '../src/core/learning/r2-continuous-event.js';
import { vec3 } from '../src/core/vector.js';
import { sha } from '../src/util.js';

const NEUTRAL_FIXTURE_SEED = 0x52425241;
const LEGACY_IMMEDIATE_WRITE_FAILURE =
  'legacy-immediate-R2-write: one closed R1 was written as one R2 visit before a real multi-R1 boundary';

type NeutralEvidenceTier =
  | 'non-production'
  | 'provisional'
  | 'predictive'
  | 'intervention-supported';

interface NeutralR2Sample {
  readonly sampleId: string;
  readonly contextId: string;
  readonly orderedCoordinates: readonly (readonly number[])[];
  readonly anonymousCondition: Float64Array;
  readonly observedOutcome: Float64Array;
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function fixedPermutation(length: number, seed: number): number[] {
  const values = Array.from({ length }, (_unused, index) => index);
  const random = xorshift32(seed);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
  return values;
}

const ANONYMOUS_WIDTH = 8;
const FIXTURE_AXES = fixedPermutation(ANONYMOUS_WIDTH, NEUTRAL_FIXTURE_SEED);
// These indices exist only in the scorer-side fixture. They are never fields
// on a learner-facing sample and are shuffled by the frozen seed.
const CAUSAL_SCORER_AXIS = FIXTURE_AXES[0]!;
const SPURIOUS_SCORER_AXIS = FIXTURE_AXES[1]!;
const OUTCOME_SCORER_AXIS = FIXTURE_AXES[2]!;

const FORWARD_CHAIN = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([0.25, 0.10, 0]),
  Object.freeze([0.50, 0, 0]),
] as const);

function neutralAtom(
  identity: string,
  ordinal: number,
  coordinate: readonly [number, number, number],
  overrides: Partial<R1ClosedEventAtomV1> = {},
): R1ClosedEventAtomV1 {
  return {
    version: 'R1ClosedEventAtomV2',
    atomId: `opaque-atom-${identity}`,
    sourceEventId: `opaque-source-${identity}`,
    exactExperienceIdentity: `opaque-experience-${identity}`,
    publicTransitionTopologyId: sha({ transitionSlot: ordinal % 3 }),
    kind: 'action',
    completion: 'complete',
    trustedActualObservation: true,
    publicOnly: true,
    sessionId: 'opaque-session-00',
    continuityEpochId: 'opaque-epoch-00',
    startedAt: ordinal * 0.25,
    endedAt: ordinal * 0.25 + 0.20,
    startFrameSequence: ordinal * 10,
    endFrameSequence: ordinal * 10 + 9,
    publicContinuityDependencies: [{
      version: 'PublicContinuityDependencyV1',
      dependencyId: 'opaque-public-process-00',
      basis: 'successor-depends-on-prior-public-observation',
      evidence: {
        version: 'PublicContinuityEvidenceReferenceV1',
        sourceEventId: `opaque-source-${identity}`,
        subject: 'opaque-public-subject-00',
        property: 'opaque-public-state-00',
        beforeObservationSequence: ordinal * 10,
        afterObservationSequence: ordinal * 10 + 9,
        beforeValueSha256: '0'.repeat(64),
        afterValueSha256: '0'.repeat(64),
        factCategory: 'public-successor-precondition',
      },
    }],
    coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
    r2Coordinate: vec3(...coordinate),
    ...overrides,
  };
}

function neutralAtoms(): readonly [R1ClosedEventAtomV1, R1ClosedEventAtomV1, R1ClosedEventAtomV1] {
  return [
    neutralAtom('a', 0, [0, 0, 0]),
    neutralAtom('b', 1, [0.25, 0.10, 0]),
    neutralAtom('c', 2, [0.50, 0, 0]),
  ];
}

function closeComplete(
  store: R2ContinuousEventStore,
  reason: R2CompleteBoundaryReasonV1 = 'public-process-resolved',
) {
  return store.close({ version: 'R2EventBoundaryV1', completion: 'complete', reason });
}

function commitAtoms(store: R2ContinuousEventStore, atoms: readonly R1ClosedEventAtomV1[]) {
  assert(atoms[0]);
  store.begin(atoms[0]);
  for (const atom of atoms.slice(1)) store.append(atom);
  const receipt = closeComplete(store);
  assert.equal(receipt.status, 'committed');
  return receipt.event;
}

function retime(atom: R1ClosedEventAtomV1, ordinal: number): R1ClosedEventAtomV1 {
  const startFrameSequence = ordinal * 10;
  const endFrameSequence = ordinal * 10 + 9;
  return {
    ...structuredClone(atom),
    startedAt: ordinal * 0.25,
    endedAt: ordinal * 0.25 + 0.20,
    startFrameSequence,
    endFrameSequence,
    publicContinuityDependencies: atom.publicContinuityDependencies.map(dependency => ({
      ...structuredClone(dependency),
      evidence: {
        ...structuredClone(dependency.evidence),
        beforeObservationSequence: startFrameSequence,
        afterObservationSequence: endFrameSequence,
      },
    })),
  };
}

test('R2 stages a multi-R1 chain without physical writes and commits exactly once at a public boundary', () => {
  const store = new R2ContinuousEventStore();
  const atoms = neutralAtoms();
  const mediumBefore = sha(store.mediumSnapshot());

  store.begin(atoms[0]);
  assert.equal(store.pendingAtomCount, 1);
  assert.equal(store.committedEventCount, 0);
  assert.deepEqual(store.events(), []);
  assert.equal(sha(store.mediumSnapshot()), mediumBefore, LEGACY_IMMEDIATE_WRITE_FAILURE);

  store.append(atoms[1]);
  store.append(atoms[2]);
  assert.equal(store.pendingAtomCount, 3);
  assert.equal(store.committedEventCount, 0);
  assert.equal(sha(store.mediumSnapshot()), mediumBefore, LEGACY_IMMEDIATE_WRITE_FAILURE);

  const receipt = closeComplete(store);
  assert.equal(receipt.status, 'committed');
  assert.equal(store.pendingAtomCount, 0);
  assert.equal(store.committedEventCount, 1);
  assert.notEqual(sha(store.mediumSnapshot()), mediumBefore);
  assert.deepEqual(receipt.event.atomIds, atoms.map(atom => atom.atomId));
  assert.deepEqual(receipt.event.sourceEventIds, atoms.map(atom => atom.sourceEventId));
  assert.equal(receipt.event.publicDependencyLinks.length, 2);
  assert.equal(receipt.event.completion, 'complete');
  assert.equal(receipt.event.physicalStatus, 'deposited');
  assert.notEqual(receipt.event.pageId, null);
  assert.notEqual(receipt.event.traceId, null);
  assert.equal(receipt.event.learningEligible, true);
  assert.deepEqual(R2ContinuousEventStore.restore(store.snapshot()).snapshot(), store.snapshot());
});

test('R2 rejects a singleton without a physical write or learning event', () => {
  const store = new R2ContinuousEventStore();
  const mediumBefore = sha(store.mediumSnapshot());
  store.begin(neutralAtoms()[0]);
  const receipt = closeComplete(store, 'public-dependency-ended');
  assert.deepEqual(receipt, {
    version: 'R2CloseReceiptV1',
    status: 'singleton-rejected',
    atomId: 'opaque-atom-a',
    completion: 'complete',
    boundaryReason: 'public-dependency-ended',
  });
  assert.equal(store.pendingAtomCount, 0);
  assert.equal(store.committedEventCount, 0);
  assert.deepEqual(store.events(), []);
  assert.equal(sha(store.mediumSnapshot()), mediumBefore,
    'singleton R1 was incorrectly promoted to a physical R2 event');
});

test('a continuity reset retains one censored audit event without a medium write or R2A eligibility', () => {
  const store = new R2ContinuousEventStore();
  const atoms = neutralAtoms();
  const mediumBefore = sha(store.mediumSnapshot());
  store.begin(atoms[0]);
  store.append(atoms[1]);
  assert.equal(sha(store.mediumSnapshot()), mediumBefore, LEGACY_IMMEDIATE_WRITE_FAILURE);
  const receipt = store.interrupt('continuity-reset');
  assert.equal(receipt.status, 'committed');
  assert.equal(receipt.event.completion, 'censored');
  assert.equal(receipt.event.boundaryReason, 'continuity-reset');
  assert.equal(receipt.event.physicalStatus, 'audit-only-censored');
  assert.equal(receipt.event.pageId, null);
  assert.equal(receipt.event.traceId, null);
  assert.equal(receipt.event.learningEligible, false);
  assert.equal(store.events().length, 1);
  assert.deepEqual(store.events({ learningEligibleOnly: true }), []);
  assert.equal(sha(store.mediumSnapshot()), mediumBefore,
    'a reset/censored audit event leaked into the physical R2 learning medium');
});

test('a complete zero-arc chain remains an unrepresented audit event and cannot become learning evidence', () => {
  const store = new R2ContinuousEventStore();
  const mediumBefore = sha(store.mediumSnapshot());
  const atoms = [
    neutralAtom('zero-a', 0, [0.25, 0.25, 0.25]),
    neutralAtom('zero-b', 1, [0.25, 0.25, 0.25]),
  ];
  store.begin(atoms[0]!);
  store.append(atoms[1]!);
  const receipt = closeComplete(store);
  assert.equal(receipt.status, 'committed');
  assert.equal(receipt.event.completion, 'complete');
  assert.equal(receipt.event.physicalStatus, 'unrepresented-zero-arc');
  assert.equal(receipt.event.pageId, null);
  assert.equal(receipt.event.traceId, null);
  assert.equal(receipt.event.learningEligible, false);
  assert.equal(store.events().length, 1,
    'zero-arc measurement loss incorrectly denied that a real continuous event occurred');
  assert.deepEqual(store.events({ learningEligibleOnly: true }), []);
  assert.equal(sha(store.mediumSnapshot()), mediumBefore,
    'unrepresented zero-arc event was incorrectly deposited into physical R2');
});

test('raw reversal is rejected, while legal retimed reversal and a nearby substitution cannot merge with forward order', () => {
  const atoms = neutralAtoms();

  const invalidReverse = new R2ContinuousEventStore();
  const invalidBefore = sha(invalidReverse.mediumSnapshot());
  invalidReverse.begin(atoms[2]);
  assert.throws(() => invalidReverse.append(atoms[1]),
    /R2-real-time-order-reversed|R2-frame-order-overlapped-or-reversed/);
  assert.equal(invalidReverse.committedEventCount, 0);
  assert.equal(sha(invalidReverse.mediumSnapshot()), invalidBefore);

  const forward = commitAtoms(new R2ContinuousEventStore(), atoms);
  const legalReverse = commitAtoms(new R2ContinuousEventStore(), [
    retime(atoms[2], 0), retime(atoms[1], 1), retime(atoms[0], 2),
  ]);
  assert.notEqual(legalReverse.eventId, forward.eventId,
    'a bag-of-R1 identity merged a legally timed reversed chain with the forward event');
  assert.deepEqual(legalReverse.atomIds, [...forward.atomIds].reverse());

  const nearbyReplacement = neutralAtom('d', 2, [0.500_001, 0.000_001, 0]);
  const substituted = commitAtoms(new R2ContinuousEventStore(), [atoms[0], atoms[1], nearbyReplacement]);
  assert(Math.hypot(
    substituted.orderedCoordinates[2]![0]! - forward.orderedCoordinates[2]![0]!,
    substituted.orderedCoordinates[2]![1]! - forward.orderedCoordinates[2]![1]!,
  ) < 1e-3, 'nearby-substitution fixture is no longer a strict proximity control');
  assert.notEqual(substituted.eventId, forward.eventId,
    'spatial proximity incorrectly overrode ordered atom identity after one-step substitution');
});

function neutralSample(
  sampleId: string,
  contextId: string,
  scorerCausalValue: -1 | 1,
  scorerSpuriousValue: -1 | 1,
  orderedCoordinates: readonly (readonly number[])[] = FORWARD_CHAIN,
): NeutralR2Sample {
  const anonymousCondition = new Float64Array(ANONYMOUS_WIDTH);
  anonymousCondition[CAUSAL_SCORER_AXIS] = scorerCausalValue;
  anonymousCondition[SPURIOUS_SCORER_AXIS] = scorerSpuriousValue;
  const observedOutcome = new Float64Array(ANONYMOUS_WIDTH);
  observedOutcome[OUTCOME_SCORER_AXIS] = scorerCausalValue;
  return {
    sampleId,
    contextId,
    orderedCoordinates: orderedCoordinates.map(point => [...point]),
    anonymousCondition,
    observedOutcome,
  };
}

function sequenceSignature(sample: NeutralR2Sample): string {
  return sha(sample.orderedCoordinates.map(point => [...point]));
}

function squaredDistance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  assert.equal(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    sum += difference * difference;
  }
  return sum;
}

function pearson(left: readonly number[], right: readonly number[]): number {
  assert.equal(left.length, right.length);
  if (left.length < 2) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquare += leftDelta * leftDelta;
    rightSquare += rightDelta * rightDelta;
  }
  return leftSquare === 0 || rightSquare === 0
    ? 0
    : numerator / Math.sqrt(leftSquare * rightSquare);
}

/**
 * Scorer-side acceptance oracle for the R2A evidence contract. This is not a
 * production learner: it deliberately exposes the evidence gates while the
 * production R2A interface is being rebuilt. Inputs contain only anonymous
 * vectors, ordered R2 coordinates, context identity and observed outcomes.
 */
class NeutralR2AEvidenceOracle {
  readonly #samples = new Map<string, NeutralR2Sample[]>();
  readonly #supportedAxes = new Set<number>();
  readonly #contradictedAxes = new Set<number>();
  readonly #supportedPatterns = new Set<string>();

  observe(sample: NeutralR2Sample): void {
    const signature = sequenceSignature(sample);
    const current = this.#samples.get(signature) ?? [];
    assert.equal(current.some(value => value.sampleId === sample.sampleId), false,
      `duplicate neutral sample id: ${sample.sampleId}`);
    current.push(structuredClone(sample));
    this.#samples.set(signature, current);
  }

  patternTier(sample: NeutralR2Sample): NeutralEvidenceTier {
    const signature = sequenceSignature(sample);
    const samples = this.#samples.get(signature) ?? [];
    const contexts = new Set(samples.map(value => value.contextId));
    if (samples.length <= 1) return 'non-production';
    if (samples.length < 8 || contexts.size < 4) return 'provisional';
    return this.#supportedPatterns.has(signature) ? 'intervention-supported' : 'predictive';
  }

  factorTier(sample: NeutralR2Sample, axis: number): NeutralEvidenceTier {
    if (this.#contradictedAxes.has(axis)) return 'non-production';
    const patternTier = this.patternTier(sample);
    if (patternTier === 'non-production' || patternTier === 'provisional') return patternTier;
    const samples = this.#samples.get(sequenceSignature(sample)) ?? [];
    const inputs = samples.map(value => value.anonymousCondition[axis]!);
    let bestObservedCorrelation = 0;
    for (let outcomeAxis = 0; outcomeAxis < ANONYMOUS_WIDTH; outcomeAxis += 1) {
      const outcomes = samples.map(value => value.observedOutcome[outcomeAxis]!);
      bestObservedCorrelation = Math.max(bestObservedCorrelation, Math.abs(pearson(inputs, outcomes)));
    }
    if (bestObservedCorrelation < 0.95) return 'non-production';
    return this.#supportedAxes.has(axis) ? 'intervention-supported' : 'predictive';
  }

  recordMatchedIntervention(
    baseline: NeutralR2Sample,
    intervention: NeutralR2Sample,
  ): Readonly<{ changedAxis: number; outcomeChanged: boolean }> {
    assert.equal(sequenceSignature(baseline), sequenceSignature(intervention),
      'matched intervention changed the ordered R2 event');
    assert.equal(baseline.contextId, intervention.contextId,
      'matched intervention changed the public context');
    const changedAxes = Array.from({ length: ANONYMOUS_WIDTH }, (_unused, index) => index)
      .filter(index => Math.abs(
        baseline.anonymousCondition[index]! - intervention.anonymousCondition[index]!,
      ) > 1e-12);
    assert.equal(changedAxes.length, 1,
      'controlled evidence must change exactly one anonymous factor coordinate');
    const changedAxis = changedAxes[0]!;
    const outcomeChanged = squaredDistance(
      baseline.observedOutcome,
      intervention.observedOutcome,
    ) > 1e-12;
    if (outcomeChanged) {
      this.#supportedAxes.add(changedAxis);
      this.#supportedPatterns.add(sequenceSignature(baseline));
    } else {
      this.#contradictedAxes.add(changedAxis);
      this.#supportedAxes.delete(changedAxis);
    }
    return { changedAxis, outcomeChanged };
  }

  productionFactorAxes(sample: NeutralR2Sample): readonly number[] {
    return Array.from({ length: ANONYMOUS_WIDTH }, (_unused, index) => index)
      .filter(index => this.factorTier(sample, index) === 'intervention-supported');
  }
}

function confoundedEightAcrossFourContexts(): NeutralR2Sample[] {
  return Array.from({ length: 8 }, (_unused, index) => {
    const sharedValue = index % 2 === 0 ? -1 : 1;
    return neutralSample(
      `opaque-observation-${index.toString().padStart(2, '0')}`,
      `opaque-context-${index % 4}`,
      sharedValue,
      sharedValue,
    );
  });
}

function allKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (ArrayBuffer.isView(value)) return [];
  if (Array.isArray(value)) return value.flatMap(allKeys);
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => [key, ...allKeys(child)]);
}

test('neutral R2A evidence fixture keeps one occurrence non-production, two provisional, and eight/four predictive-candidate eligible', () => {
  const oracle = new NeutralR2AEvidenceOracle();
  const samples = confoundedEightAcrossFourContexts();
  oracle.observe(samples[0]!);
  assert.equal(oracle.patternTier(samples[0]!), 'non-production');
  oracle.observe(samples[1]!);
  assert.equal(oracle.patternTier(samples[0]!), 'provisional');
  for (const sample of samples.slice(2)) oracle.observe(sample);
  // This same-batch gate is only predictive-candidate eligibility. A held-out
  // or prospective run is still required before claiming validated prediction.
  assert.equal(oracle.patternTier(samples[0]!), 'predictive');
});

test('neutral q-by-s interventions support only the causal anonymous axis and exclude the equally repeated correlate', () => {
  const oracle = new NeutralR2AEvidenceOracle();
  const samples = confoundedEightAcrossFourContexts();
  for (const sample of samples) oracle.observe(sample);

  // Pure repetition makes both hidden axes observationally predictive. Neither
  // is production-causal before a matched intervention.
  assert.equal(oracle.factorTier(samples[0]!, CAUSAL_SCORER_AXIS), 'predictive');
  assert.equal(oracle.factorTier(samples[0]!, SPURIOUS_SCORER_AXIS), 'predictive');
  assert.deepEqual(oracle.productionFactorAxes(samples[0]!), []);

  const baseline = neutralSample('opaque-do-00', 'opaque-do-context', -1, -1);
  const causalDo = neutralSample('opaque-do-01', 'opaque-do-context', 1, -1);
  const spuriousDo = neutralSample('opaque-do-02', 'opaque-do-context', -1, 1);
  const causalReceipt = oracle.recordMatchedIntervention(baseline, causalDo);
  assert.deepEqual(causalReceipt, { changedAxis: CAUSAL_SCORER_AXIS, outcomeChanged: true });
  assert.equal(oracle.patternTier(samples[0]!), 'intervention-supported');
  assert.equal(oracle.factorTier(samples[0]!, CAUSAL_SCORER_AXIS), 'intervention-supported');
  assert.equal(oracle.factorTier(samples[0]!, SPURIOUS_SCORER_AXIS), 'predictive');

  const spuriousReceipt = oracle.recordMatchedIntervention(baseline, spuriousDo);
  assert.deepEqual(spuriousReceipt, { changedAxis: SPURIOUS_SCORER_AXIS, outcomeChanged: false });
  assert.equal(oracle.factorTier(samples[0]!, SPURIOUS_SCORER_AXIS), 'non-production');
  assert.deepEqual(oracle.productionFactorAxes(samples[0]!), [CAUSAL_SCORER_AXIS]);
});

test('neutral learner-facing fixtures expose no scorer factor or result labels', () => {
  const samples = confoundedEightAcrossFourContexts();
  const atoms = neutralAtoms();
  const forbidden = new Set([
    'q', 's', 'label', 'factorLabel', 'resultLabel', 'resultClass',
    'expectedOutcome', 'expectedChain', 'target', 'success',
  ]);
  assert.equal(allKeys([...samples, ...atoms]).some(key => forbidden.has(key)), false);
  assert.equal(samples.every(sample => sample.sampleId.startsWith('opaque-')
    && sample.contextId.startsWith('opaque-')), true);
});
