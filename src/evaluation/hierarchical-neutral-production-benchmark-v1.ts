import { R2_CONFIG } from '../core/config.js';
import {
  R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
  R2ContinuousEventStore,
  assessR2ContinuityV1,
  type R1ClosedEventAtomV1,
  type R2ContinuousEventV1,
} from '../core/learning/r2-continuous-event.js';
import {
  R2AStablePatternLearnerV1,
  type R2StablePatternV1,
} from '../core/learning/r2a-stable-pattern.js';
import { DeterministicTokenFieldEncoder } from '../core/learning/token-field.js';
import { vec3 } from '../core/vector.js';
import { sha } from '../util.js';

export const HIERARCHICAL_NEUTRAL_PRODUCTION_SEEDS_V1 = Object.freeze([
  11, 23, 37, 41, 53, 67, 79, 97,
] as const);

export interface HierarchicalNeutralProductionSeedResultV1 {
  readonly version: 'HierarchicalNeutralProductionSeedResultV1';
  readonly seed: number;
  readonly trainingEventCount: 64;
  readonly heldoutEventCount: 32;
  readonly r2BoundaryF1: number;
  readonly sameChainDifferentChainAuc: number;
  readonly equivalentAcceptanceRate: number;
  readonly reverseRejectionRate: number;
  readonly missingStepRejectionRate: number;
  readonly replacedStepRejectionRate: number;
  readonly multiAtomEligibleRate: number;
  readonly heldoutAtomIdentityOverlapCount: number;
  readonly stablePatternCount: number;
  readonly predictiveStablePatternCount: number;
  readonly querySnapshotsUnchanged: boolean;
  readonly learnerFacingForbiddenFieldCount: number;
  readonly stateSha256: string;
}

export interface HierarchicalNeutralProductionBenchmarkResultV1 {
  readonly version: 'HierarchicalNeutralProductionBenchmarkResultV1';
  readonly seeds: readonly HierarchicalNeutralProductionSeedResultV1[];
  readonly repeatedRunDeterministic: boolean;
  readonly minimumBoundaryF1: number;
  readonly minimumSameChainDifferentChainAuc: number;
  readonly minimumReverseRejectionRate: number;
  readonly minimumMultiAtomEligibleRate: number;
  readonly allQueriesReadOnly: boolean;
  readonly learnerFacingForbiddenFieldCount: number;
}

type AnonymousFamily = 'opaque-family-00' | 'opaque-family-01';
type HeldoutKind = 'equivalent' | 'reverse' | 'missing-step' | 'replaced-step';

interface AnonymousEventFixtureV1 {
  readonly family: AnonymousFamily;
  readonly heldoutKind: HeldoutKind | null;
  readonly atoms: readonly R1ClosedEventAtomV1[];
  readonly atomPrePerceptions: readonly Float64Array[];
}

interface ClassifiedHeldoutV1 {
  readonly kind: HeldoutKind;
  readonly expectedMember: boolean;
  readonly reverse: boolean;
  readonly score: number;
}

const FAMILY_DEFINITIONS = Object.freeze({
  'opaque-family-00': Object.freeze({
    exactExperienceIdentities: Object.freeze([
      'opaque-experience-00', 'opaque-experience-01', 'opaque-experience-02',
    ]),
    coordinates: Object.freeze([
      Object.freeze([-2.4, -0.4, 0.2]),
      Object.freeze([-1.8, 0.0, 0.3]),
      Object.freeze([-1.1, 0.5, 0.1]),
    ]),
  }),
  'opaque-family-01': Object.freeze({
    exactExperienceIdentities: Object.freeze([
      'opaque-experience-00', 'opaque-experience-01', 'opaque-experience-03',
      'opaque-experience-04',
    ]),
    coordinates: Object.freeze([
      Object.freeze([1.1, -0.5, -0.2]),
      Object.freeze([1.7, -0.1, -0.1]),
      Object.freeze([2.4, -0.7, 0.2]),
      Object.freeze([3.1, -1.1, 0.4]),
    ]),
  }),
} as const);

const FORBIDDEN_LEARNER_FIELDS = new Set([
  'family', 'heldoutKind', 'label', 'resultLabel', 'expectedPattern', 'success',
  'causal', 'q', 's', 'worldX', 'worldY', 'worldZ',
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = xorshift32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function anonymousPerception(context: number, atomIndex: number, jitter: number): Float64Array {
  const value = new Float64Array(256);
  for (let bit = 0; bit < 3; bit += 1) value[bit] = ((context >> bit) & 1) === 1 ? 1 : -1;
  value[8] = atomIndex * 0.5;
  value[9] = (context % 4) * 0.5;
  value[10] = jitter;
  return value;
}

function dependencyFor(
  sourceEventId: string,
  processId: string,
  subjectId: string,
  atomIndex: number,
  startFrameSequence: number,
  endFrameSequence: number,
) {
  return {
    version: 'PublicContinuityDependencyV1' as const,
    dependencyId: processId,
    basis: 'successor-depends-on-prior-public-observation' as const,
    evidence: {
      version: 'PublicContinuityEvidenceReferenceV1' as const,
      sourceEventId,
      subject: subjectId,
      property: 'opaque-public-attribute-00',
      beforeObservationSequence: startFrameSequence,
      afterObservationSequence: endFrameSequence,
      beforeValueSha256: sha({ processId, processState: atomIndex }),
      afterValueSha256: sha({ processId, processState: atomIndex + 1 }),
      factCategory: 'public-successor-precondition' as const,
    },
  };
}

function makeFixture(
  seed: number,
  sampleOrdinal: number,
  family: AnonymousFamily,
  context: number,
  heldoutKind: HeldoutKind | null,
): AnonymousEventFixtureV1 {
  const random = xorshift32((seed * 0x9e3779b1 + sampleOrdinal * 0x85ebca6b) >>> 0);
  const definition = FAMILY_DEFINITIONS[family];
  let identities = [...definition.exactExperienceIdentities];
  let coordinates = definition.coordinates.map(point => [...point]);
  if (heldoutKind === 'reverse') {
    identities = identities.reverse();
    coordinates = coordinates.reverse();
  } else if (heldoutKind === 'missing-step') {
    const removedIndex = Math.min(1, identities.length - 2);
    identities.splice(removedIndex, 1);
    coordinates.splice(removedIndex, 1);
  } else if (heldoutKind === 'replaced-step') {
    const replacedIndex = Math.min(2, identities.length - 1);
    identities[replacedIndex] = `opaque-replacement-${replacedIndex.toString().padStart(2, '0')}`;
    // Deliberately retain the same measured road. Separation must come from
    // the ordered R1 identity, not from an outcome label or Euclidean paging.
  }
  const duration = 0.18 + random() * 0.12;
  const baseTime = sampleOrdinal * 3 + seed * 0.000_1;
  const baseFrame = sampleOrdinal * 100;
  const pseudonym = sha({ seed, sampleOrdinal, context }).slice(0, 16);
  const processId = `opaque-process-${pseudonym}`;
  const subjectId = `opaque-subject-${sha({ pseudonym, context }).slice(0, 12)}`;
  const atoms = identities.map((identity, atomIndex): R1ClosedEventAtomV1 => {
    const sourceEventId = `opaque-source-${pseudonym}-${atomIndex}`;
    const startFrameSequence = baseFrame + atomIndex * 3;
    const endFrameSequence = startFrameSequence + 2;
    const coordinate = coordinates[atomIndex]!;
    const noise = () => (random() - 0.5) * 0.03;
    return {
      version: 'R1ClosedEventAtomV2',
      atomId: `opaque-atom-${pseudonym}-${atomIndex}`,
      sourceEventId,
      exactExperienceIdentity: identity,
      publicTransitionTopologyId: sha({ transitionSlot: atomIndex }),
      kind: 'action',
      completion: 'complete',
      trustedActualObservation: true,
      publicOnly: true,
      sessionId: `opaque-session-${pseudonym}`,
      continuityEpochId: `opaque-epoch-${pseudonym}`,
      startedAt: baseTime + atomIndex * duration,
      endedAt: baseTime + atomIndex * duration + duration * 0.8,
      startFrameSequence,
      endFrameSequence,
      publicContinuityDependencies: [dependencyFor(
        sourceEventId,
        processId,
        subjectId,
        atomIndex,
        startFrameSequence,
        endFrameSequence,
      )],
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
      r2Coordinate: vec3(
        coordinate[0]! + noise(),
        coordinate[1]! + noise(),
        coordinate[2]! + noise(),
      ),
    };
  });
  const atomPrePerceptions = atoms.map((_atom, atomIndex) =>
    anonymousPerception(context, atomIndex, (random() - 0.5) * 0.04));
  return { family, heldoutKind, atoms, atomPrePerceptions };
}

function commitFixture(store: R2ContinuousEventStore, fixture: AnonymousEventFixtureV1): R2ContinuousEventV1 {
  invariant(fixture.atoms.length >= 2, 'neutral production fixture must contain multiple R1 atoms');
  store.begin(fixture.atoms[0]!);
  for (const atom of fixture.atoms.slice(1)) store.append(atom);
  const receipt = store.close({
    version: 'R2EventBoundaryV1',
    completion: 'complete',
    reason: 'public-process-resolved',
  });
  invariant(receipt.status === 'committed', 'multi-R1 fixture was not committed by production R2');
  invariant(receipt.event.learningEligible, 'multi-R1 fixture was not physically represented by production R2');
  return receipt.event;
}

function vectorDistance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(...left.map((value, index) => value - right[index]!));
}

function productionPatternScore(pattern: R2StablePatternV1, event: R2ContinuousEventV1): number {
  if (pattern.orderedExperienceIdentities.length !== event.orderedExperienceIdentities.length
    || pattern.orderedExperienceIdentities.some((value, index) => value !== event.orderedExperienceIdentities[index])) {
    return 0;
  }
  const corridor = R2_CONFIG.kernelWidth * 0.75;
  return pattern.prototypeCoordinates.filter((point, index) =>
    vectorDistance(point, event.orderedCoordinates[index]!) <= corridor).length
    / pattern.prototypeCoordinates.length;
}

function auc(positives: readonly number[], negatives: readonly number[]): number {
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) {
    wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  }
  return wins / (positives.length * negatives.length);
}

function f1(tp: number, fp: number, fn: number): number {
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return 2 * precision * recall / Math.max(Number.EPSILON, precision + recall);
}

function publicKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return [];
  if (Array.isArray(value)) return value.flatMap(publicKeys);
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => [key, ...publicKeys(child)]);
}

function negativeBoundaryAssessment(seed: number, ordinal: number): boolean {
  const leftFixture = makeFixture(seed, 10_000 + ordinal * 2, 'opaque-family-00', ordinal % 8, null);
  const rightFixture = makeFixture(seed, 10_001 + ordinal * 2, 'opaque-family-00', ordinal % 8, null);
  const left = leftFixture.atoms.at(-1)!;
  const original = rightFixture.atoms[0]!;
  const mode = ordinal % 4;
  let right: R1ClosedEventAtomV1 = original;
  if (mode !== 0) {
    const startFrameSequence = left.endFrameSequence + (mode === 2 ? 2 : 1);
    const endFrameSequence = startFrameSequence + 2;
    const dependencyId = mode === 3
      ? `${left.publicContinuityDependencies[0]!.dependencyId}-disconnected`
      : left.publicContinuityDependencies[0]!.dependencyId;
    right = {
      ...original,
      sessionId: left.sessionId,
      continuityEpochId: mode === 1 ? `${left.continuityEpochId}-reset` : left.continuityEpochId,
      startedAt: left.endedAt + 0.01,
      endedAt: left.endedAt + 0.11,
      startFrameSequence,
      endFrameSequence,
      publicContinuityDependencies: [{
        ...original.publicContinuityDependencies[0]!,
        dependencyId,
        evidence: {
          ...original.publicContinuityDependencies[0]!.evidence,
          beforeObservationSequence: startFrameSequence,
          afterObservationSequence: endFrameSequence,
        },
      }],
    };
  }
  return assessR2ContinuityV1(left, right).continuous;
}

function runOneSeed(seed: number): HierarchicalNeutralProductionSeedResultV1 {
  const trainingPlan = shuffle(Array.from({ length: 64 }, (_unused, index) => ({
    family: (index % 2 === 0 ? 'opaque-family-00' : 'opaque-family-01') as AnonymousFamily,
    context: index % 8,
  })), seed ^ 0xa5a5a5a5);
  const training = trainingPlan.map((item, processOrdinal) => makeFixture(
    seed, processOrdinal, item.family, item.context, null));
  const encoder = new DeterministicTokenFieldEncoder();
  encoder.fit(training.flatMap(fixture => fixture.atomPrePerceptions));
  encoder.freeze();
  const trainingStore = new R2ContinuousEventStore();
  const learner = new R2AStablePatternLearnerV1(encoder);
  const committedTraining: R2ContinuousEventV1[] = [];
  for (const fixture of training) {
    const event = commitFixture(trainingStore, fixture);
    committedTraining.push(event);
    learner.observe({
      version: 'R2PatternEvidenceInputV1',
      event,
      contextId: `opaque-caller-context-${fixture.atoms[0]!.atomId}`,
      atomPrePerceptions: fixture.atomPrePerceptions,
      trustedActualObservation: true,
    }, (pageId, traceId) => trainingStore.isTraceActive(pageId, traceId));
  }

  const heldoutKinds: readonly HeldoutKind[] = [
    ...Array.from({ length: 16 }, () => 'equivalent' as const),
    ...Array.from({ length: 8 }, () => 'reverse' as const),
    ...Array.from({ length: 4 }, () => 'missing-step' as const),
    ...Array.from({ length: 4 }, () => 'replaced-step' as const),
  ];
  const heldoutFixtures = shuffle(heldoutKinds.map((kind, index) => makeFixture(
    seed ^ 0x5bd1e995,
    1_000 + index,
    index % 2 === 0 ? 'opaque-family-00' : 'opaque-family-01',
    (index + 3) % 8,
    kind,
  )), seed ^ 0x27d4eb2d);
  const heldoutStore = new R2ContinuousEventStore();
  const committedHeldout = heldoutFixtures.map(fixture => ({ fixture, event: commitFixture(heldoutStore, fixture) }));

  const learnerBeforeRead = sha(learner.snapshot());
  const trainingStoreBeforeRead = sha(trainingStore.snapshot());
  const heldoutStoreBeforeRead = sha(heldoutStore.snapshot());
  const patterns = learner.patterns();
  const classifications: ClassifiedHeldoutV1[] = committedHeldout.map(({ fixture, event }) => ({
    kind: fixture.heldoutKind!,
    expectedMember: fixture.heldoutKind === 'equivalent',
    reverse: fixture.heldoutKind === 'reverse',
    score: Math.max(...patterns.map(pattern => productionPatternScore(pattern, event)), 0),
  }));
  const queryPerception = training[0]!.atomPrePerceptions[0]!;
  for (const pattern of patterns) {
    learner.assessContinuation(pattern.patternId, pattern.prototypeCoordinates.slice(0, 2), queryPerception,
      pattern.orderedExperienceIdentities.slice(0, 2));
  }
  trainingStore.events();
  heldoutStore.events();
  const querySnapshotsUnchanged = learnerBeforeRead === sha(learner.snapshot())
    && trainingStoreBeforeRead === sha(trainingStore.snapshot())
    && heldoutStoreBeforeRead === sha(heldoutStore.snapshot());

  let truePositive = 0;
  let falseNegative = 0;
  for (const fixture of [...training, ...heldoutFixtures]) {
    for (let index = 1; index < fixture.atoms.length; index += 1) {
      if (assessR2ContinuityV1(fixture.atoms[index - 1]!, fixture.atoms[index]!).continuous) truePositive++;
      else falseNegative++;
    }
  }
  let falsePositive = 0;
  for (let ordinal = 0; ordinal < 32; ordinal += 1) {
    if (negativeBoundaryAssessment(seed, ordinal)) falsePositive++;
  }
  const allEvents = [...committedTraining, ...committedHeldout.map(value => value.event)];
  const forbiddenFieldCount = [...training, ...heldoutFixtures]
    .flatMap(fixture => fixture.atoms)
    .flatMap(publicKeys)
    .filter(key => FORBIDDEN_LEARNER_FIELDS.has(key)).length;
  const positives = classifications.filter(value => value.expectedMember).map(value => value.score);
  const negatives = classifications.filter(value => !value.expectedMember).map(value => value.score);
  const reverse = classifications.filter(value => value.reverse);
  const missing = classifications.filter(value => value.kind === 'missing-step');
  const replaced = classifications.filter(value => value.kind === 'replaced-step');
  const trainingAtomIds = new Set(committedTraining.flatMap(event => event.atomIds));
  const stateSha256 = sha({
    trainingStore: trainingStore.snapshot(),
    learner: learner.snapshot(),
    heldoutScores: classifications,
  });
  return {
    version: 'HierarchicalNeutralProductionSeedResultV1',
    seed,
    trainingEventCount: 64,
    heldoutEventCount: 32,
    r2BoundaryF1: f1(truePositive, falsePositive, falseNegative),
    sameChainDifferentChainAuc: auc(positives, negatives),
    equivalentAcceptanceRate: positives.filter(score => score >= 0.8).length / positives.length,
    reverseRejectionRate: reverse.filter(value => value.score < 0.8).length / reverse.length,
    missingStepRejectionRate: missing.filter(value => value.score < 0.8).length / missing.length,
    replacedStepRejectionRate: replaced.filter(value => value.score < 0.8).length / replaced.length,
    multiAtomEligibleRate: allEvents.filter(event => event.atomIds.length > 1).length / allEvents.length,
    heldoutAtomIdentityOverlapCount: committedHeldout.flatMap(value => value.event.atomIds)
      .filter(atomId => trainingAtomIds.has(atomId)).length,
    stablePatternCount: patterns.length,
    predictiveStablePatternCount: patterns.filter(pattern => pattern.grade === 'predictive-stable').length,
    querySnapshotsUnchanged,
    learnerFacingForbiddenFieldCount: forbiddenFieldCount,
    stateSha256,
  };
}

export function runHierarchicalNeutralProductionBenchmarkV1(
  seeds: readonly number[] = HIERARCHICAL_NEUTRAL_PRODUCTION_SEEDS_V1,
): HierarchicalNeutralProductionBenchmarkResultV1 {
  invariant(seeds.length === 8 && new Set(seeds).size === seeds.length,
    'hierarchical neutral benchmark requires eight distinct fixed seeds');
  const results = seeds.map(runOneSeed);
  const repeated = seeds.map(runOneSeed);
  return {
    version: 'HierarchicalNeutralProductionBenchmarkResultV1',
    seeds: results,
    repeatedRunDeterministic: sha(results) === sha(repeated),
    minimumBoundaryF1: Math.min(...results.map(value => value.r2BoundaryF1)),
    minimumSameChainDifferentChainAuc: Math.min(...results.map(value => value.sameChainDifferentChainAuc)),
    minimumReverseRejectionRate: Math.min(...results.map(value => value.reverseRejectionRate)),
    minimumMultiAtomEligibleRate: Math.min(...results.map(value => value.multiAtomEligibleRate)),
    allQueriesReadOnly: results.every(value => value.querySnapshotsUnchanged),
    learnerFacingForbiddenFieldCount: results.reduce((sum, value) =>
      sum + value.learnerFacingForbiddenFieldCount, 0),
  };
}
