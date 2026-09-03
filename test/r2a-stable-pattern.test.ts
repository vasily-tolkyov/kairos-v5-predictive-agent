import test from 'node:test';
import assert from 'node:assert/strict';
import {
  R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
  R2ContinuousEventStore,
} from '../src/core/learning/r2-continuous-event.js';
import type {
  R1ClosedEventAtomV1,
  R2ContinuousEventV1,
} from '../src/core/learning/r2-continuous-event.js';
import {
  derivePhysicalRoadPartitionV1,
  R2AStablePatternLearnerV1,
  R2_STABLE_PATTERN_MINIMUM_CORE_V1,
  R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1,
} from '../src/core/learning/r2a-stable-pattern.js';
import type {
  R2AInterventionEvidenceV1,
  R2AStablePatternHyperedgeV1,
  R2StablePatternV1,
} from '../src/core/learning/r2a-stable-pattern.js';
import {
  DeterministicTokenFieldEncoder,
  TOKEN_FIELD_WIDTH,
} from '../src/core/learning/token-field.js';
import { vec3 } from '../src/core/vector.js';
import { R2_CONFIG } from '../src/core/config.js';
import { sha } from '../src/util.js';

const SCORER_Q_AXIS = 17;
const SCORER_S_AXIS = 43;
const CONTEXT_AXIS_A = 101;
const CONTEXT_AXIS_B = 173;
const CALLER_CONTEXT_SENTINEL = 'caller-context-must-not-supply-independent-evidence';
const ACTION_IDENTITY = 'opaque-action-00';

type Sign = -1 | 0 | 1;
type Point = readonly [number, number, number];
type Path = readonly Point[];

const CONTEXT_CODES: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const BRANCH_LEFT: Path = [
  [0, 0, 0],
  [0.5, 0, 0],
  [1, 0, 0],
];

const BRANCH_RIGHT: Path = [
  [0, 0, 0],
  [0.5, 0, 0],
  [0.5, 1, 0],
];

const BRANCH_UP: Path = [
  [0, 0, 0],
  [0.5, 0, 0],
  [0.5, 0, 1],
];

const BRANCH_UNRELATED_PREFIX: Path = [
  [0, 0, 0],
  [0, 2, 0],
  [0.5, 1, 0],
];

const BRANCH_MIDDLE_LEFT: Path = [
  [0, 0, 0],
  [1, 0, 0],
  [1.5, 0.5, 0],
];

const BRANCH_MIDDLE_RIGHT: Path = [
  [0, 0, 0],
  [0, 1, 0],
  [1.5, 0.5, 0],
];

function perception(q: Sign, s: Sign, contextIndex: number): Float64Array {
  const value = new Float64Array(TOKEN_FIELD_WIDTH);
  const context = CONTEXT_CODES[contextIndex % CONTEXT_CODES.length]!;
  value[SCORER_Q_AXIS] = q;
  value[SCORER_S_AXIS] = s;
  value[CONTEXT_AXIS_A] = context[0]!;
  value[CONTEXT_AXIS_B] = context[1]!;
  return value;
}

function frozenEncoder(): DeterministicTokenFieldEncoder {
  const encoder = new DeterministicTokenFieldEncoder();
  const calibration: Float64Array[] = [];
  for (const q of [-1, 1] as const) for (const s of [-1, 1] as const) {
    for (let contextIndex = 0; contextIndex < CONTEXT_CODES.length; contextIndex += 1) {
      calibration.push(perception(q, s, contextIndex));
    }
  }
  assert.equal(calibration.length, 16);
  encoder.fit(calibration);
  encoder.freeze();
  return encoder;
}

class RealR2EvidenceFixture {
  readonly store = new R2ContinuousEventStore();
  #eventSequence = 0;

  readonly traceActive = (pageId: string, traceId: string): boolean =>
    this.store.isTraceActive(pageId, traceId);

  event(label: string, path: Path, orderedExperienceIdentities?: readonly string[],
    orderedTransitionTopologyIds?: readonly string[]): R2ContinuousEventV1 {
    orderedExperienceIdentities ??= path.map((_point, index) => index === path.length - 1
      ? ACTION_IDENTITY : `opaque-prefix-action-${index}`);
    assert.equal(orderedExperienceIdentities.length, path.length);
    orderedTransitionTopologyIds ??= path.map((_point, index) => sha({ transitionSlot: index }));
    assert.equal(orderedTransitionTopologyIds.length, path.length);
    const eventSequence = this.#eventSequence++;
    const atoms = path.map((point, atomIndex) => this.#atom(label, eventSequence, atomIndex, point,
      orderedExperienceIdentities[atomIndex]!, orderedTransitionTopologyIds[atomIndex]!));
    this.store.begin(atoms[0]!);
    for (const atom of atoms.slice(1)) this.store.append(atom);
    const receipt = this.store.close({
      version: 'R2EventBoundaryV1',
      completion: 'complete',
      reason: 'public-process-resolved',
    });
    assert.equal(receipt.status, 'committed');
    if (receipt.status !== 'committed') return assert.fail('real R2 evidence was not committed');
    assert.equal(receipt.event.learningEligible, true);
    assert.equal(receipt.event.physicalStatus, 'deposited');
    return receipt.event;
  }

  #atom(label: string, eventSequence: number, atomIndex: number, point: Point,
    exactExperienceIdentity: string, publicTransitionTopologyId: string): R1ClosedEventAtomV1 {
    const identity = `${eventSequence.toString().padStart(4, '0')}-${label}-${atomIndex}`;
    const sourceEventId = `opaque-source-${identity}`;
    const startFrameSequence = eventSequence * 1_000 + atomIndex * 2;
    const endFrameSequence = startFrameSequence + 1;
    const startedAt = eventSequence + atomIndex * 0.05;
    return {
      version: 'R1ClosedEventAtomV2',
      atomId: `opaque-atom-${identity}`,
      sourceEventId,
      exactExperienceIdentity,
      publicTransitionTopologyId,
      kind: 'action',
      completion: 'complete',
      trustedActualObservation: true,
      publicOnly: true,
      sessionId: 'opaque-session-r2a-production-test',
      continuityEpochId: 'opaque-epoch-r2a-production-test',
      startedAt,
      endedAt: startedAt + 0.04,
      startFrameSequence,
      endFrameSequence,
      publicContinuityDependencies: [{
        version: 'PublicContinuityDependencyV1',
        dependencyId: `opaque-process-${eventSequence.toString().padStart(4, '0')}`,
        basis: 'public-state-carried-forward',
        evidence: {
          version: 'PublicContinuityEvidenceReferenceV1',
          sourceEventId,
          subject: 'opaque-public-subject-00',
          property: 'opaque-public-state-00',
          beforeObservationSequence: startFrameSequence,
          afterObservationSequence: endFrameSequence,
          beforeValueSha256: '0'.repeat(64),
          afterValueSha256: '0'.repeat(64),
          factCategory: 'public-state-persistence',
        },
      }],
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
      r2Coordinate: vec3(...point),
    };
  }
}

function observe(
  learner: R2AStablePatternLearnerV1,
  fixture: RealR2EvidenceFixture,
  event: R2ContinuousEventV1,
  publicPerception: Float64Array,
): R2StablePatternV1 {
  return learner.observe({
    version: 'R2PatternEvidenceInputV1',
    event,
    contextId: CALLER_CONTEXT_SENTINEL,
    atomPrePerceptions: event.atomIds.map(() => new Float64Array(publicPerception)),
    trustedActualObservation: true,
  }, fixture.traceActive);
}

function observeWithAtomEvidence(
  learner: R2AStablePatternLearnerV1,
  fixture: RealR2EvidenceFixture,
  event: R2ContinuousEventV1,
  atomPrePerceptions: readonly Float64Array[],
): R2StablePatternV1 {
  return learner.observe({
    version: 'R2PatternEvidenceInputV1',
    event,
    contextId: CALLER_CONTEXT_SENTINEL,
    atomPrePerceptions,
    trustedActualObservation: true,
  }, fixture.traceActive);
}

function densityRoad(eventId: string, lateral: number, endedAt: number) {
  return {
    eventId,
    endedAt,
    orderedExperienceIdentities: ['opaque-density-prepare', 'opaque-density-act', 'opaque-density-observe'],
    orderedCoordinates: [[0, 0, 0], [.5, lateral, 0], [1, lateral, 0]],
  } as const;
}

test('physical road density separates two repeated modes inside the coarse comparison corridor', () => {
  const first = Array.from({ length: 8 }, (_unused, index) =>
    densityRoad(`opaque-density-a-${index}`, (index - 3.5) * .002, index));
  const second = Array.from({ length: 8 }, (_unused, index) =>
    densityRoad(`opaque-density-b-${index}`, .22 + (index - 3.5) * .002, 8 + index));
  const partitions = derivePhysicalRoadPartitionV1([...first, ...second]);
  assert.equal(partitions.length, 2);
  assert.deepEqual(partitions.map(value => value.coreEventIds.length), [8, 8]);
  assert(partitions.every(value => value.status === 'resolved'
    && value.physicalDiameter < R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1
    && value.separationMargin !== null
    && value.separationMargin > R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1),
  'a persistent physical gap inside the broad comparison band was not preserved');
});

test('a stable physical core labels at most twenty percent as peripheral evidence', () => {
  const core = Array.from({ length: 8 }, (_unused, index) =>
    densityRoad(`opaque-density-core-${index}`, (index - 3.5) * .002, index));
  const twoPeripheral = [densityRoad('opaque-density-peripheral-0', .10, 8),
    densityRoad('opaque-density-peripheral-1', .11, 9)];
  const admitted = derivePhysicalRoadPartitionV1([...core, ...twoPeripheral]);
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0]!.coreEventIds.length, 8);
  assert.equal(admitted[0]!.peripheralEventIds.length, 2);
  const third = derivePhysicalRoadPartitionV1([...core, ...twoPeripheral,
    densityRoad('opaque-density-peripheral-2', .12, 10)]);
  assert.equal(third.length, 2);
  assert.equal(third.find(value => value.coreEventIds.length === 8)!.peripheralEventIds.length, 0,
    'more than twenty percent peripheral evidence was laundered into a stable core');
  assert(third.some(value => value.coreEventIds.length < R2_STABLE_PATTERN_MINIMUM_CORE_V1));
});

test('physical density partitions and revision identities are independent of presentation order', () => {
  const values = [...Array.from({ length: 8 }, (_unused, index) =>
    densityRoad(`opaque-order-a-${index}`, (index - 3.5) * .002, index)),
  ...Array.from({ length: 8 }, (_unused, index) =>
    densityRoad(`opaque-order-b-${index}`, .22 + (index - 3.5) * .002, 8 + index))];
  const canonicalPartitions = derivePhysicalRoadPartitionV1(values);
  const reversedPartitions = derivePhysicalRoadPartitionV1([...values].reverse());
  const summarize = (partitions: ReturnType<typeof derivePhysicalRoadPartitionV1>) => partitions
    .map(value => ({ revision: value.revisionSha256, core: [...value.coreEventIds].sort(),
      peripheral: [...value.peripheralEventIds].sort(), status: value.status }))
    .sort((left, right) => left.revision.localeCompare(right.revision, 'en'));
  assert.deepEqual(summarize(reversedPartitions), summarize(canonicalPartitions));
});

test('a stable physical mode is not fragmented by unsupported internal subclusters', () => {
  const firstSubcluster = Array.from({ length: 3 }, (_unused, index) =>
    densityRoad(`opaque-multimodal-a0-${index}`, index * .0001, index));
  const secondSubcluster = Array.from({ length: 3 }, (_unused, index) =>
    densityRoad(`opaque-multimodal-a1-${index}`, .065 + index * .0001, 3 + index));
  const thirdSubcluster = Array.from({ length: 2 }, (_unused, index) =>
    densityRoad(`opaque-multimodal-a2-${index}`, .18 + index * .0001, 6 + index));
  const competingMode = Array.from({ length: 10 }, (_unused, index) =>
    densityRoad(`opaque-multimodal-b-${index}`, .8 + index * .0001, 8 + index));
  const partitions = derivePhysicalRoadPartitionV1(
    [...firstSubcluster, ...secondSubcluster, ...thirdSubcluster, ...competingMode]);
  assert.equal(partitions.length, 2);
  assert.deepEqual(partitions.map(value => value.coreEventIds.length).sort((a, b) => a - b), [8, 10]);
});

test('a seven-plus-three internal physical sampling split remains one repeated mode', () => {
  const firstSubcluster = Array.from({ length: 7 }, (_unused, index) =>
    densityRoad(`opaque-seven-three-a-${index}`, index * .0001, index));
  const secondSubcluster = Array.from({ length: 3 }, (_unused, index) =>
    densityRoad(`opaque-seven-three-b-${index}`, .18 + index * .0001, 7 + index));
  const partitions = derivePhysicalRoadPartitionV1([...firstSubcluster, ...secondSubcluster]);
  assert.equal(partitions.length, 1);
  assert.equal(partitions[0]!.coreEventIds.length, 10);
});

test('seven observations per physical branch remain non-predictive evidence', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const first: Path = [[0, 0, 0], [.5, 0, 0], [1, 0, 0]];
  const second: Path = [[0, 0, 0], [.5, .22, 0], [1, .22, 0]];
  for (let index = 0; index < 7; index += 1) observe(learner, fixture,
    fixture.event(`opaque-seven-a-${index}`, first), perception(-1, 0, index));
  for (let index = 0; index < 7; index += 1) observe(learner, fixture,
    fixture.event(`opaque-seven-b-${index}`, second), perception(1, 0, index));
  assert.equal(learner.patterns().length, 2);
  assert(learner.patterns().every(pattern => pattern.coreEventIds.length === 7
    && pattern.grade === 'repeated-correlation'));
  assert.equal(learner.relations().length, 0);
});

test('coordinate-near R2 roads with a substituted opaque action identity form separate patterns', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const identityA = ['opaque-prepare', 'opaque-transition', 'opaque-action-a'] as const;
  const identityB = ['opaque-prepare', 'opaque-transition', 'opaque-action-b'] as const;
  const first = observe(learner, fixture, fixture.event('opaque-object-layout-a', BRANCH_LEFT, identityA),
    perception(0, 0, 0));
  const objectAndEventRenamed = observe(learner, fixture,
    fixture.event('opaque-object-layout-b', BRANCH_LEFT, identityA), perception(0, 0, 1));
  assert.equal(objectAndEventRenamed.patternId, first.patternId,
    'event/object identity placement leaked into the layout-independent opaque action identity');
  const substituted = observe(learner, fixture, fixture.event('opaque-identity-b', BRANCH_LEFT, identityB),
    perception(0, 0, 1));
  assert.notEqual(substituted.patternId, first.patternId,
    'coordinate fit merged a road whose exact ordered action identity was substituted');
});

test('a real middle-atom branch is discovered from that action prefix and its own pre-action perception', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  let targetPatternId = '';
  for (let index = 0; index < 8; index += 1) {
    observeWithAtomEvidence(learner, fixture, fixture.event(`opaque-middle-left-${index}`, BRANCH_MIDDLE_LEFT,
      ['opaque-prepare', 'opaque-middle-action', 'opaque-observe']),
      [perception(0, 0, index), perception(-1, 0, index), perception(0, 0, index)]);
  }
  for (let index = 0; index < 8; index += 1) {
    targetPatternId = observeWithAtomEvidence(learner, fixture,
      fixture.event(`opaque-middle-right-${index}`, BRANCH_MIDDLE_RIGHT,
        ['opaque-prepare', 'opaque-middle-action', 'opaque-observe']),
      [perception(0, 0, index), perception(1, 0, index), perception(0, 0, index)]).patternId;
  }
  const relation = learner.relations().find(value => value.targetPatternId === targetPatternId
    && (value as R2AStablePatternHyperedgeV1 & { readonly branchAtomIndex?: number }).branchAtomIndex === 1);
  assert(relation, 'the middle action branch remained invisible behind the terminal observe atom');
  assert.equal(relation.exactNextActionIdentity, 'opaque-middle-action');
});

test('public transition topology stays audit-only while physical branches expose conditions', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const common = [sha('prefix-transition'), sha('branch-outcome-a'), sha('terminal-transition')];
  const alternate = [common[0]!, sha('branch-outcome-b'), common[2]!];
  let alternatePatternId = '';
  for (let index = 0; index < 8; index += 1) {
    observe(learner, fixture, fixture.event(`topology-a-${index}`, BRANCH_LEFT, undefined, common),
      perception(-1, 0, index % 4));
  }
  for (let index = 0; index < 8; index += 1) {
    alternatePatternId = observe(learner, fixture,
      fixture.event(`topology-b-${index}`, BRANCH_LEFT, undefined, alternate),
      perception(1, 0, index % 4)).patternId;
  }
  const patterns = learner.patterns();
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0]!.supportCount, 16);
  assert.equal(patterns[0]!.grade, 'predictive-stable');
  assert.equal(alternatePatternId, patterns[0]!.patternId);
  assert.deepEqual(patterns[0]!.orderedTransitionTopologyVariantCounts, [1, 2, 1]);
  assert.equal(learner.relations().length, 0,
    'a public transition hash manufactured a physical branch relation');
  const alternatePrefix = learner.assessContinuation(patterns[0]!.patternId,
    patterns[0]!.prototypeCoordinates.slice(0, 2), perception(1, 0, 0),
    patterns[0]!.orderedExperienceIdentities.slice(0, 2), alternate.slice(0, 2));
  assert.equal(alternatePrefix.predictionEligible, true,
    'an observed topology variant was rejected despite a matching physical prefix');

  const prefixLearner = new R2AStablePatternLearnerV1(frozenEncoder());
  const prefixFixture = new RealR2EvidenceFixture();
  const changedPrefix = [sha('different-prefix'), common[1]!, common[2]!];
  const changedPhysicalOutcome: Path = [[0, 0, 0], [.5, .6, 0], [1, 0, 0]];
  for (let index = 0; index < 8; index += 1) {
    observe(prefixLearner, prefixFixture,
      prefixFixture.event(`prefix-a-${index}`, BRANCH_LEFT, undefined, common),
      perception(-1, 0, index % 4));
    observe(prefixLearner, prefixFixture,
      prefixFixture.event(`prefix-b-${index}`, changedPhysicalOutcome, undefined, changedPrefix),
      perception(1, 0, index % 4));
  }
  assert.equal(prefixLearner.relations().some(value => value.branchAtomIndex === 1), true,
    'an extra public prefix transition hid a physically comparable branch from condition discovery');

  const unrelatedPrefixLearner = new R2AStablePatternLearnerV1(frozenEncoder());
  const unrelatedPrefixFixture = new RealR2EvidenceFixture();
  const farPrefix: Path = [[3, 0, 0], [.5, .1, 0], [1, 0, 0]];
  for (let index = 0; index < 8; index += 1) {
    observe(unrelatedPrefixLearner, unrelatedPrefixFixture,
      unrelatedPrefixFixture.event(`far-prefix-a-${index}`, BRANCH_LEFT,
        ['opaque-prepare', 'opaque-middle-action', 'opaque-observe'], common),
      perception(-1, 0, index % 4));
    observe(unrelatedPrefixLearner, unrelatedPrefixFixture,
      unrelatedPrefixFixture.event(`far-prefix-b-${index}`, farPrefix,
        ['opaque-prepare', 'opaque-middle-action', 'opaque-observe'], changedPrefix),
      perception(1, 0, index % 4));
  }
  assert.equal(unrelatedPrefixLearner.relations().some(value => value.branchAtomIndex === 1), false,
    'an R2 prefix outside the physical comparison corridor was treated as comparable');
});

test('seven founding topologies plus three incidental variants form one stable physical pattern', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const common = [sha('attempt-013-prefix'), sha('attempt-013-no-crosshair'), sha('attempt-013-end')];
  const incidental = [common[0]!, sha('attempt-013-crosshair-visible'), common[2]!];
  let patternId = '';
  for (let index = 0; index < 7; index++) patternId = observe(learner, fixture,
    fixture.event(`attempt-013-common-${index}`, BRANCH_LEFT, undefined, common),
    perception(1, 0, index % 4)).patternId;
  for (let index = 0; index < 3; index++) assert.equal(observe(learner, fixture,
    fixture.event(`attempt-013-incidental-${index}`, BRANCH_LEFT, undefined, incidental),
    perception(1, 0, index % 4)).patternId, patternId);
  const pattern = learner.patterns()[0]!;
  assert.equal(learner.patterns().length, 1);
  assert.equal(pattern.supportCount, 10);
  assert.equal(pattern.grade, 'predictive-stable');
  assert.deepEqual(pattern.orderedTransitionTopologyVariantCounts, [1, 2, 1]);
  assert.equal(learner.relations().length, 0);
});

function mediumKernelCount(learner: R2AStablePatternLearnerV1): number {
  return learner.mediumSnapshot().pages.reduce((sum, page) => sum + page.kernels.length, 0);
}

function relationByTargetAndAxes(
  learner: R2AStablePatternLearnerV1,
  targetPatternId: string,
  expectedAxes: readonly number[],
): R2AStablePatternHyperedgeV1 {
  const axisByFactorId = new Map(learner.factors().map(factor => [factor.factorId, factor.tokenIndex]));
  const expected = [...expectedAxes].sort((left, right) => left - right);
  const relation = learner.relations().find(candidate => candidate.targetPatternId === targetPatternId
    && candidate.factorIds.map(id => axisByFactorId.get(id)!).sort((left, right) => left - right)
      .every((axis, index, axes) => axes.length === expected.length && axis === expected[index]));
  assert(relation, `production R2A relation for axes ${expected.join(',')} was not discovered`);
  return relation;
}

function factorIdAtAxis(
  learner: R2AStablePatternLearnerV1,
  relation: R2AStablePatternHyperedgeV1,
  axis: number,
): string {
  const factors = new Map(learner.factors().map(factor => [factor.factorId, factor]));
  const factorId = relation.factorIds.find(id => factors.get(id)?.tokenIndex === axis);
  assert(factorId, `relation is missing anonymous factor axis ${axis}`);
  return factorId;
}

function formationMatchedPairsFor(
  learner: R2AStablePatternLearnerV1,
  relation: R2AStablePatternHyperedgeV1,
) {
  const patterns = new Map(learner.patterns().map(value => [value.patternId, value]));
  const target = patterns.get(relation.targetPatternId)!;
  const contrast = patterns.get(relation.contrastPatternIds[0]!)!;
  assert(target && contrast && target.memberEventIds.length >= 8 && contrast.memberEventIds.length >= 8);
  return target.memberEventIds.slice(0, 8).map((targetEventId, index) => ({
    targetEventId, contrastEventId: contrast.memberEventIds[index]!,
  }));
}

function assertFutureEvidenceAbsent(
  learner: R2AStablePatternLearnerV1,
  relationId: string,
  futureEventId: string,
): void {
  const snapshot = learner.snapshot();
  const relation = snapshot.relations.find(value => value.relationId === relationId)!;
  assert.equal(snapshot.processedEventIds.includes(futureEventId), false,
    'heldout event was processed before its preregistered comparison');
  assert.equal(snapshot.evidence.some(value => value.eventId === futureEventId), false,
    'heldout event leaked into learner evidence before prediction');
  assert.equal(relation.validationEventIds.includes(futureEventId), false,
    'heldout event leaked into validation before prediction');
}

function trainTwoBranches(confounded: boolean, subresolutionCorrelateAxis?: number): {
  readonly learner: R2AStablePatternLearnerV1;
  readonly fixture: RealR2EvidenceFixture;
  readonly leftPatternId: string;
  readonly rightPatternId: string;
  readonly relation: R2AStablePatternHyperedgeV1;
} {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  let leftPatternId = '';
  let rightPatternId = '';
  for (let index = 0; index < 8; index += 1) {
    const event = fixture.event(`opaque-left-train-${index}`, BRANCH_LEFT);
    const publicPerception = perception(-1, confounded ? -1 : 0, index % 4);
    if (subresolutionCorrelateAxis !== undefined) publicPerception[subresolutionCorrelateAxis] = -.2;
    leftPatternId = observe(learner, fixture, event, publicPerception).patternId;
  }
  for (let index = 0; index < 8; index += 1) {
    const event = fixture.event(`opaque-right-train-${index}`, BRANCH_RIGHT);
    const publicPerception = perception(1, confounded ? 1 : 0, index % 4);
    if (subresolutionCorrelateAxis !== undefined) publicPerception[subresolutionCorrelateAxis] = .2;
    rightPatternId = observe(learner, fixture, event, publicPerception).patternId;
  }
  // Stable pattern formation is not prospective relation validation. Exercise
  // both outcomes in two fresh public contexts after the factor set freezes.
  for (let contextIndex = 0; contextIndex < 2; contextIndex += 1) {
    const targetPerception = perception(1, confounded ? 1 : 0, contextIndex);
    const contrastPerception = perception(-1, confounded ? -1 : 0, contextIndex);
    if (subresolutionCorrelateAxis !== undefined) {
      targetPerception[subresolutionCorrelateAxis] = .2;
      contrastPerception[subresolutionCorrelateAxis] = -.2;
    }
    observe(learner, fixture,
      fixture.event(`opaque-right-validation-${contextIndex}`, BRANCH_RIGHT), targetPerception);
    observe(learner, fixture,
      fixture.event(`opaque-left-validation-${contextIndex}`, BRANCH_LEFT), contrastPerception);
  }
  const expectedAxes = confounded ? [SCORER_Q_AXIS, SCORER_S_AXIS] : [SCORER_Q_AXIS];
  const relation = relationByTargetAndAxes(learner, rightPatternId, expectedAxes);
  assert.equal(learner.patterns().find(value => value.patternId === leftPatternId)?.grade, 'predictive-stable');
  assert.equal(learner.patterns().find(value => value.patternId === rightPatternId)?.grade, 'predictive-stable');
  assert.equal(relation.grade, 'predictive-stable');
  return { learner, fixture, leftPatternId, rightPatternId, relation };
}

test('production R2A keeps 1/2/7/8 evidence gates and derives four contexts from public perception', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  let pattern: R2StablePatternV1 | null = null;
  for (let index = 0; index < 8; index += 1) {
    pattern = observe(learner, fixture, fixture.event(`opaque-threshold-${index}`, BRANCH_LEFT),
      perception(1, 0, index % 4));
    if (index === 0) {
      assert.equal(pattern.grade, 'single-observation');
      assert.equal(pattern.physicalTraceIds.length, 0);
      assert.equal(mediumKernelCount(learner), 0,
        'one R2 event incorrectly produced a physical R2A visit');
    } else if (index === 1 || index === 6) {
      assert.equal(pattern.grade, 'repeated-correlation');
    }
  }
  assert(pattern);
  assert.equal(pattern.supportCount, 8);
  assert.equal(new Set(pattern.contextIds).size, 4,
    'caller context text, rather than four public-perception contexts, controlled the threshold');
  assert.equal(pattern.grade, 'predictive-stable');
  const identityMismatch = learner.assessContinuation(pattern.patternId,
    pattern.prototypeCoordinates.slice(0, 2), perception(1, 0, 0),
    ['opaque-substituted-action', pattern.orderedExperienceIdentities[1]!],
    pattern.orderedTransitionTopologyIds.slice(0, 2));
  assert.equal(identityMismatch.predictionEligible, false);
  assert.equal(identityMismatch.reason, 'real-prefix-experience-identity-mismatch');

  const oneContextLearner = new R2AStablePatternLearnerV1(frozenEncoder());
  const oneContextFixture = new RealR2EvidenceFixture();
  let oneContextPattern: R2StablePatternV1 | null = null;
  for (let index = 0; index < 8; index += 1) {
    oneContextPattern = observe(oneContextLearner, oneContextFixture,
      oneContextFixture.event(`opaque-one-context-${index}`, BRANCH_LEFT), perception(1, 0, 0));
  }
  assert(oneContextPattern);
  assert.equal(new Set(oneContextPattern.contextIds).size, 1);
  assert.equal(oneContextPattern.grade, 'repeated-correlation');
});

test('production relation validates heldout events strictly after formation and before admitting prediction', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  for (let index = 0; index < 8; index += 1) {
    observe(learner, fixture, fixture.event(`opaque-heldout-left-${index}`, BRANCH_LEFT),
      perception(-1, 0, index % 4));
  }

  let rightPatternId = '';
  for (let index = 0; index < 8; index += 1) rightPatternId = observe(learner, fixture,
    fixture.event(`opaque-heldout-formation-${index}`, BRANCH_RIGHT),
    perception(1, 0, index % 4)).patternId;
  let relation = relationByTargetAndAxes(learner, rightPatternId, [SCORER_Q_AXIS]);
  assert.equal(relation.grade, 'repeated-correlation');
  assert.equal(relation.validationEventIds.length, 0);

  const eventOrder = new Map<string, number>();
  let ordinal = 0;
  for (const eventId of learner.snapshot().processedEventIds) eventOrder.set(eventId, ordinal++);
  eventOrder.set(relation.formedAtEventId, eventOrder.get(relation.formedAtEventId) ?? -1);
  const prospective = [
    { label: 'right-0', path: BRANCH_RIGHT, value: 1 as const, context: 0 },
    { label: 'left-0', path: BRANCH_LEFT, value: -1 as const, context: 0 },
    { label: 'right-1', path: BRANCH_RIGHT, value: 1 as const, context: 1 },
    { label: 'left-1', path: BRANCH_LEFT, value: -1 as const, context: 1 },
  ];
  for (const item of prospective) {
    const publicPerception = perception(item.value, 0, item.context);
    const heldout = fixture.event(`opaque-heldout-future-${item.label}`, item.path);
    assertFutureEvidenceAbsent(learner, relation.relationId, heldout.eventId);
    const comparison = learner.compareCurrentFactors(relation.relationId, publicPerception);
    assert.equal(comparison.targetPatternId, rightPatternId);
    assert.equal(comparison.predictionEligible, false,
      'the heldout result made its own prediction eligible before observation');
    const observed = observe(learner, fixture, heldout, publicPerception);
    assert.equal(observed.patternId, item.path === BRANCH_RIGHT ? rightPatternId
      : learner.patterns().find(value => value.patternId !== rightPatternId)!.patternId);
    eventOrder.set(heldout.eventId, ordinal++);
    relation = learner.relations().find(value => value.relationId === relation.relationId)!;
    assert.equal(relation.validationEventIds.includes(heldout.eventId), true);
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(relation.grade, 'predictive-stable');
  assert(relation.validationEventIds.length >= 4);
  assert.equal(relation.validationCorrectCount, relation.validationEventIds.length);
  assert(new Set(relation.validationContextIds).size >= 2);
  const formedOrder = eventOrder.get(relation.formedAtEventId)!;
  assert(relation.validationEventIds.every(eventId => eventOrder.get(eventId)! > formedOrder),
    'formation/training evidence was reused as heldout validation');
});

test('differential relation direction does not depend on which repeated pattern was observed last', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  let leftPatternId = '';
  for (let index = 0; index < 8; index += 1) {
    leftPatternId = observe(learner, fixture,
      fixture.event(`order-independent-left-${index}`, BRANCH_LEFT),
      perception(-1, 0, index % 4)).patternId;
  }
  let rightPatternId = '';
  for (let index = 0; index < 8; index += 1) {
    rightPatternId = observe(learner, fixture,
      fixture.event(`order-independent-right-formation-${index}`, BRANCH_RIGHT),
      perception(1, 0, index % 4)).patternId;
    if (index === 6) assert.equal(learner.relations().some(value =>
      value.targetPatternId === leftPatternId && value.contrastPatternIds.includes(rightPatternId)), false,
    'a seven-event provisional contrast created a frozen factor relation');
  }
  let leftRelation = relationByTargetAndAxes(learner, leftPatternId, [SCORER_Q_AXIS]);
  const rightRelation = relationByTargetAndAxes(learner, rightPatternId, [SCORER_Q_AXIS]);
  assert.equal(leftRelation.formedAtEventId, rightRelation.formedAtEventId,
    'opposite factor directions were frozen at presentation-order-dependent boundaries');
  for (const relation of [leftRelation, rightRelation]) for (const factorId of relation.factorIds) {
    const factor = learner.factors().find(value => value.factorId === factorId)!;
    assert.equal(Number.isInteger(factor.expectedStandardizedValue * 2), true,
      'factor identity retained a first-sample raw mean instead of a stable half-band center');
  }
  assert.equal(leftRelation.supportEventIds.length, 8,
    'the already stable target branch was not reconsidered when its contrast appeared later');
  assert.equal(leftRelation.predictiveSinceEventId, null,
    'formation evidence was reused as prospective validation');

  for (let contextIndex = 0; contextIndex < 2; contextIndex += 1) {
    observe(learner, fixture, fixture.event(`order-independent-left-heldout-${contextIndex}`, BRANCH_LEFT),
      perception(-1, 0, contextIndex));
    observe(learner, fixture, fixture.event(`order-independent-right-heldout-${contextIndex}`, BRANCH_RIGHT),
      perception(1, 0, contextIndex));
  }
  leftRelation = learner.relations().find(value => value.relationId === leftRelation.relationId)!;
  assert.equal(leftRelation.grade, 'predictive-stable');
  assert(leftRelation.predictiveSinceEventId);
  assert(leftRelation.validationPatternIds.includes(leftPatternId));
  assert(leftRelation.validationPatternIds.includes(rightPatternId));
});

test('a later physical alternative forms an independent pairwise relation without revoking an existing one', () => {
  const trained = trainTwoBranches(false);
  const { learner, fixture } = trained;
  const relationId = trained.relation.relationId;
  const earlierThirdBranchEventIds: string[] = [];
  let thirdPatternId = '';
  for (let index = 0; index < 8; index += 1) {
    const event = fixture.event(`prospective-third-before-admission-${index}`, BRANCH_UP);
    if (index < 7) earlierThirdBranchEventIds.push(event.eventId);
    thirdPatternId = observe(learner, fixture, event, perception(-1, 0, index)).patternId;
  }
  const relation = learner.relations().find(value => value.relationId === relationId)!;
  assert.equal(relation.contrastPatternIds.length, 1);
  assert.equal(relation.contrastPatternIds.includes(thirdPatternId), false,
    'an unrelated physical branch enlarged an existing pairwise relation');
  assert.equal(relation.grade, 'predictive-stable',
    'an unrelated physical branch revoked an already validated pairwise relation');
  const thirdRelations = learner.relations().filter(value => value.derivedFromRelationId === null
    && value.targetPatternId === relation.targetPatternId
    && value.contrastPatternIds.length === 1
    && value.contrastPatternIds[0] === thirdPatternId);
  assert(thirdRelations.length > 0, 'the third physical branch did not receive an independent comparison');
  assert(thirdRelations.every(value => value.relationId !== relationId));
  assert(thirdRelations.every(value => value.validationEventIds.every(id =>
    !earlierThirdBranchEventIds.includes(id))),
  'events observed before pairwise relation formation were backfilled as heldout validation');
  assert.doesNotThrow(() => new R2AStablePatternLearnerV1(frozenEncoder(), learner.snapshot()),
    'checkpoint restore reinterpreted a final relation scope as if it had existed in the past');
  observe(learner, fixture, fixture.event('prospective-left-after-admission', BRANCH_LEFT),
    perception(-1, 0, 3));
  observe(learner, fixture, fixture.event('prospective-third-after-admission', BRANCH_UP),
    perception(-1, 0, 3));
  const covered = learner.relations().find(value => value.relationId === relationId)!;
  assert.deepEqual(covered.contrastPatternIds, relation.contrastPatternIds);
  assert.equal(covered.grade, 'predictive-stable');
  assert.doesNotThrow(() => new R2AStablePatternLearnerV1(frozenEncoder(), learner.snapshot()));
});

test('alternative repeated suffixes form separate patterns rather than retroactive near-miss contradictions', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const basePath: Path = Array.from({ length: 10 }, (_unused, index) => [index * 0.3, 0, 0] as const);
  let target: R2StablePatternV1 | null = null;
  for (let index = 0; index < 8; index += 1) {
    target = observe(learner, fixture, fixture.event(`opaque-consistent-${index}`, basePath),
      perception(1, 0, index % 4));
  }
  assert(target);
  const targetPatternId = target.patternId;
  assert.equal(target.grade, 'predictive-stable');

  const changed = new Set<number>([1, 2, 3]);
  const alternative: Path = basePath.map((point, index) => changed.has(index)
    ? [point[0], 2, 0] as const : point);
  const branch = observe(learner, fixture, fixture.event('opaque-alternative-suffix', alternative),
    perception(1, 0, 0));
  target = learner.patterns().find(value => value.patternId === targetPatternId)!;
  assert.notEqual(branch.patternId, target.patternId);
  assert.equal(target.contradictionCount, 0);
  assert.equal(target.contradictionEventIds.length, 0);
  assert.equal(target.grade, 'predictive-stable');
});

test('measurement jitter shares one physical road corridor while a genuine branch remains separate', () => {
  assert(0.05 < R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1
    && R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1 < 0.1
    && 0.1 < R2_CONFIG.kernelWidth * 0.75,
  'the test no longer spans the stable-topology/coarse-physical-corridor gap');
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const basePath: Path = Array.from({ length: 10 }, (_unused, index) => [index * 0.3, 0, 0] as const);
  const baseEvent = fixture.event('opaque-long-road-base', basePath);
  const base = observe(learner, fixture, baseEvent, perception(1, 0, 0));

  const equivalentJitter: Path = basePath.map(point => [point[0], 0.05, 0] as const);
  const equivalent = observe(learner, fixture, fixture.event('opaque-long-road-equivalent', equivalentJitter),
    perception(1, 0, 1));
  assert.equal(equivalent.patternId, base.patternId,
    'sub-resolution jitter was split into a different stable road');

  const oneDifferentAtom: Path = basePath.map((point, index) => index === 5
    ? [point[0], 0.1, 0] as const : point);
  const sameCorridor = observe(learner, fixture, fixture.event('opaque-long-road-same-corridor', oneDifferentAtom),
    perception(-1, 0, 2));
  assert.equal(sameCorridor.patternId, base.patternId,
    'the narrow measurement resolution was incorrectly used as a repeated-event road boundary');

  const genuineBranch: Path = basePath.map((point, index) => index === 5
    ? [point[0], 0.6, 0] as const : point);
  let branch = observe(learner, fixture, fixture.event('opaque-long-road-one-branch', genuineBranch),
    perception(-1, 0, 3));
  assert.equal(branch.patternId, base.patternId,
    'one physical deviation was prematurely promoted to an independent result mode');
  for (let index = 1; index < 8; index += 1) branch = observe(learner, fixture,
    fixture.event(`opaque-long-road-repeated-branch-${index}`, genuineBranch),
    perception(-1, 0, index));
  const finalBasePattern = learner.patterns().find(value => value.memberEventIds.includes(baseEvent.eventId))!;
  const finalBranchPattern = learner.patterns().find(value => value.patternId === branch.patternId)!;
  assert.notEqual(finalBranchPattern.patternId, finalBasePattern.patternId,
    'a repeatedly supported key branch outside the physical road corridor remained hidden');
  assert.equal(finalBasePattern.contradictionCount, 0,
    'the alternative branch was incorrectly counted as a contradiction');

  const tampered = structuredClone(learner.snapshot());
  Object.assign(tampered.topology, { atomEquivalenceMaximum: R2_CONFIG.kernelWidth * 0.75 });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tampered),
    /legacy-R2A-graph-is-audit-only/);

  const chainedMembers = structuredClone(learner.snapshot());
  const basePattern = chainedMembers.patterns.find(value => value.patternId === finalBasePattern.patternId)!;
  const secondEvidence = chainedMembers.evidence.find(value => value.eventId === basePattern.memberEventIds[1])!;
  const changedCoordinates = secondEvidence.orderedCoordinates.map((point, index) => point.map((value, axis) =>
    index === 5 && axis === 1 ? 0.6 : value));
  Object.assign(secondEvidence, { orderedCoordinates: changedCoordinates });
  const firstEvidence = chainedMembers.evidence.find(value => value.eventId === basePattern.memberEventIds[0])!;
  Object.assign(basePattern, {
    prototypeCoordinates: firstEvidence.orderedCoordinates.map((point, index) => point.map((value, axis) =>
      (value + changedCoordinates[index]![axis]!) / 2)),
    orderedCorridorConsistency: 0.95,
  });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), chainedMembers),
    /R2A-checkpoint-pattern-invariant-failed/,
  'a chain of individually prototype-near members bypassed complete-link restore validation');
});

test('repeated competing physical corridors become stable alternatives at their real branch atom', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const base: Path = [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]];
  const branch: Path = [[0, 0, 0], [0.5, 0.6, 0], [1, 0, 0]];
  const identities = ['opaque-prepare', 'opaque-middle-action', 'opaque-observe'] as const;
  let basePatternId = '', branchPatternId = '';
  for (let index = 0; index < 8; index += 1) {
    basePatternId = observeWithAtomEvidence(learner, fixture,
      fixture.event(`opaque-sub-kernel-base-${index}`, base, identities),
      [perception(0, 0, index), perception(-1, 0, index), perception(0, 0, index)]).patternId;
  }
  for (let index = 0; index < 8; index += 1) {
    branchPatternId = observeWithAtomEvidence(learner, fixture,
      fixture.event(`opaque-sub-kernel-branch-${index}`, branch, identities),
      [perception(0, 0, index), perception(1, 0, index), perception(0, 0, index)]).patternId;
  }
  assert.notEqual(basePatternId, branchPatternId);
  const patterns = learner.patterns().filter(value => [basePatternId, branchPatternId].includes(value.patternId));
  assert.deepEqual(patterns.map(value => ({ grade: value.grade, support: value.supportCount,
    contexts: value.contextIds.length, contradictions: value.contradictionCount })), [
    { grade: 'predictive-stable', support: 8, contexts: 4, contradictions: 0 },
    { grade: 'predictive-stable', support: 8, contexts: 4, contradictions: 0 },
  ]);
  assert(learner.relations().some(value => value.branchAtomIndex === 1
    && value.exactNextActionIdentity === 'opaque-middle-action'
    && [basePatternId, branchPatternId].includes(value.targetPatternId)),
  'the physically distinct middle atom did not become a differential branch relation');
});

test('production intervention grade requires four distinct observed event pairs and no caller outcome boolean', () => {
  const trained = trainTwoBranches(false);
  const { learner, fixture, rightPatternId } = trained;
  let relation = trained.relation;
  const qFactorId = factorIdAtAxis(learner, relation, SCORER_Q_AXIS);
  const usedPairs: Array<readonly [R2ContinuousEventV1, R2ContinuousEventV1]> = [];

  for (let pairIndex = 0; pairIndex < 4; pairIndex += 1) {
    const protocol = learner.registerInterventionProtocol({ protocolId: `opaque-real-protocol-${pairIndex}`,
      relationId: relation.relationId, changedFactorId: qFactorId,
      formationMatchedPairs: formationMatchedPairsFor(learner, relation) });
    const baseline = fixture.event(`opaque-do-baseline-${pairIndex}`, BRANCH_LEFT);
    const intervention = fixture.event(`opaque-do-intervention-${pairIndex}`, BRANCH_RIGHT);
    observe(learner, fixture, baseline, perception(-1, 0, pairIndex));
    observe(learner, fixture, intervention, perception(1, 0, pairIndex));
    usedPairs.push([baseline, intervention]);
    const evidence: R2AInterventionEvidenceV1 = {
      version: 'R2AInterventionEvidenceV1',
      pairId: `opaque-real-pair-${pairIndex}`,
      protocolId: protocol.protocolId,
      relationId: relation.relationId,
      baselineEventId: baseline.eventId,
      interventionEventId: intervention.eventId,
      changedFactorIds: [qFactorId],
      trustedActualObservation: true,
    };
    assert.equal('observedBranchChanged' in evidence, false);
    assert.equal('selectionDropWhenRemoved' in evidence, false);
    learner.recordIntervention(evidence);
    relation = learner.relations().find(value => value.relationId === relation.relationId)!;
    if (pairIndex < 3) assert.notEqual(relation.grade, 'intervention-supported');
    else assert.equal(relation.grade, 'intervention-supported');
  }

  const firstPair = usedPairs[0]!;
  assert.throws(() => learner.recordIntervention({
    version: 'R2AInterventionEvidenceV1',
    pairId: 'opaque-reuse-attempt',
    protocolId: 'opaque-real-protocol-0',
    relationId: relation.relationId,
    baselineEventId: firstPair[0].eventId,
    interventionEventId: firstPair[1].eventId,
    changedFactorIds: [qFactorId],
    trustedActualObservation: true,
  }), /intervention-event-reused-across-pairs|intervention-event-pair-reused/);
  const comparison = learner.compareCurrentFactors(relation.relationId, perception(1, 0, 0));
  assert.equal(comparison.targetPatternId, rightPatternId);
  assert.equal(comparison.highConfidenceActionEligible, true);
  const snapshot = learner.snapshot();
  assert.equal(snapshot.interventionRecords.length, 4);
  const legacyV6 = structuredClone(snapshot) as unknown as {
    version: string;
    relations: Array<Record<string, unknown>>;
  };
  legacyV6.version = 'R2AStablePatternGraphV6';
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), legacyV6 as never),
    /legacy-R2A-graph-is-audit-only/,
    'a graph built with the old topology semantics was silently migrated');
  const legacyGraph = structuredClone(snapshot) as { version: string };
  legacyGraph.version = 'R2AStablePatternGraphV1';
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), legacyGraph as never),
    /legacy-R2A-graph-is-audit-only/);
  assert.deepEqual(new R2AStablePatternLearnerV1(frozenEncoder(), snapshot).snapshot(), snapshot);
  const tamperedAggregate = structuredClone(snapshot);
  Object.assign(tamperedAggregate.relations[0]!, { removalSelectionDrops: [0,
    ...tamperedAggregate.relations[0]!.removalSelectionDrops.slice(1)] });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tamperedAggregate),
    /intervention-aggregate-not-reproducible|relation-invariant-failed/);
  const tamperedRecord = structuredClone(snapshot);
  Object.assign(tamperedRecord.interventionRecords[0]!, { baselineEventId: 'opaque-missing-real-event' });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tamperedRecord),
    /intervention-events-must-be-real-same-action-R2-evidence/);
  const tamperedBranch = structuredClone(snapshot);
  Object.assign(tamperedBranch.relations.find(value => value.relationId === relation.relationId)!,
    { branchAtomIndex: 0 });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tamperedBranch),
    /relation-invariant|branch-contract|measurement-boundary-pairs/);
});

test('matched interventions preserve preregistered invariants without treating every raw sensor channel as a factor', () => {
  const correlatedMeasurementAxis = 220;
  const variableContext = trainTwoBranches(false, correlatedMeasurementAxis);
  const qFactorId = factorIdAtAxis(variableContext.learner, variableContext.relation, SCORER_Q_AXIS);
  const protocol = variableContext.learner.registerInterventionProtocol({
    protocolId: 'opaque-variable-context-protocol',
    relationId: variableContext.relation.relationId,
    changedFactorId: qFactorId,
    formationMatchedPairs: formationMatchedPairsFor(variableContext.learner, variableContext.relation),
  });
  const baseline = variableContext.fixture.event('opaque-variable-context-baseline', BRANCH_LEFT);
  const intervention = variableContext.fixture.event('opaque-variable-context-intervention', BRANCH_RIGHT);
  // This channel changes consistently with the physical contrast, but its
  // standardized separation (.4) is below the learner's .5 factor resolution.
  // It therefore cannot simultaneously be "not a factor" and a fatal context
  // mismatch at a stricter resolution.
  const correlatedBefore = perception(-1, 0, 0), correlatedAfter = perception(1, 0, 0);
  correlatedBefore[correlatedMeasurementAxis] = -.2;
  correlatedAfter[correlatedMeasurementAxis] = .2;
  observe(variableContext.learner, variableContext.fixture, baseline, correlatedBefore);
  observe(variableContext.learner, variableContext.fixture, intervention, correlatedAfter);
  assert.doesNotThrow(() => variableContext.learner.recordIntervention({
    version: 'R2AInterventionEvidenceV1', pairId: 'opaque-variable-context-pair',
    protocolId: protocol.protocolId, relationId: variableContext.relation.relationId,
    baselineEventId: baseline.eventId, interventionEventId: intervention.eventId,
    changedFactorIds: [qFactorId], trustedActualObservation: true,
  }), 'a variable raw measurement was incorrectly promoted to an independent held-constant factor');

  const invariantContext = trainTwoBranches(false);
  const invariantQ = factorIdAtAxis(invariantContext.learner, invariantContext.relation, SCORER_Q_AXIS);
  const invariantProtocol = invariantContext.learner.registerInterventionProtocol({
    protocolId: 'opaque-invariant-context-protocol',
    relationId: invariantContext.relation.relationId,
    changedFactorId: invariantQ,
    formationMatchedPairs: formationMatchedPairsFor(invariantContext.learner, invariantContext.relation),
  });
  const invariantBaseline = invariantContext.fixture.event('opaque-invariant-context-baseline', BRANCH_LEFT);
  const invariantIntervention = invariantContext.fixture.event('opaque-invariant-context-intervention', BRANCH_RIGHT);
  const before = perception(-1, 0, 0), after = perception(1, 0, 0);
  after[221] = 1; // This public channel was constant throughout preregistration evidence.
  observe(invariantContext.learner, invariantContext.fixture, invariantBaseline, before);
  observe(invariantContext.learner, invariantContext.fixture, invariantIntervention, after);
  assert.throws(() => invariantContext.learner.recordIntervention({
    version: 'R2AInterventionEvidenceV1', pairId: 'opaque-invariant-context-pair',
    protocolId: invariantProtocol.protocolId, relationId: invariantContext.relation.relationId,
    baselineEventId: invariantBaseline.eventId, interventionEventId: invariantIntervention.eventId,
    changedFactorIds: [invariantQ], trustedActualObservation: true,
  }), /matched-intervention-public-context-not-held-constant/,
  'a genuinely preregistered public invariant was allowed to change');

  const changedScene = trainTwoBranches(false);
  const sceneQ = factorIdAtAxis(changedScene.learner, changedScene.relation, SCORER_Q_AXIS);
  const sceneProtocol = changedScene.learner.registerInterventionProtocol({
    protocolId: 'opaque-changed-scene-protocol',
    relationId: changedScene.relation.relationId,
    changedFactorId: sceneQ,
    formationMatchedPairs: formationMatchedPairsFor(changedScene.learner, changedScene.relation),
  });
  const sceneBaseline = changedScene.fixture.event('opaque-changed-scene-baseline', BRANCH_LEFT);
  const sceneIntervention = changedScene.fixture.event('opaque-changed-scene-intervention', BRANCH_RIGHT);
  observe(changedScene.learner, changedScene.fixture, sceneBaseline, perception(-1, 0, 0));
  observe(changedScene.learner, changedScene.fixture, sceneIntervention, perception(1, 0, 1));
  assert.throws(() => changedScene.learner.recordIntervention({
    version: 'R2AInterventionEvidenceV1', pairId: 'opaque-changed-scene-pair',
    protocolId: sceneProtocol.protocolId, relationId: changedScene.relation.relationId,
    baselineEventId: sceneBaseline.eventId, interventionEventId: sceneIntervention.eventId,
    changedFactorIds: [sceneQ], trustedActualObservation: true,
  }), /matched-intervention-public-context-not-held-constant/,
  'a factor-resolution scene-context change was laundered into the intervention');
});

test('a preregistered two-token categorical set is canonical, auditable, and supported only as a joint unit', () => {
  const trained = trainTwoBranches(true);
  const { learner, fixture } = trained;
  let relation = trained.relation;
  const qFactorId = factorIdAtAxis(learner, relation, SCORER_Q_AXIS);
  const sFactorId = factorIdAtAxis(learner, relation, SCORER_S_AXIS);
  const canonicalSet = [qFactorId, sFactorId].sort((left, right) => left.localeCompare(right, 'en'));

  for (let pairIndex = 0; pairIndex < 4; pairIndex += 1) {
    const protocol = learner.registerInterventionProtocol({
      protocolId: `opaque-joint-protocol-${pairIndex}`,
      relationId: relation.relationId,
      changedFactorIds: [sFactorId, qFactorId, sFactorId],
      formationMatchedPairs: formationMatchedPairsFor(learner, relation),
    });
    assert.deepEqual(protocol.changedFactorIds, canonicalSet);
    const baseline = fixture.event(`opaque-joint-baseline-${pairIndex}`, BRANCH_LEFT);
    const intervention = fixture.event(`opaque-joint-intervention-${pairIndex}`, BRANCH_RIGHT);
    observe(learner, fixture, baseline, perception(-1, -1, pairIndex));
    observe(learner, fixture, intervention, perception(1, 1, pairIndex));
    learner.recordIntervention({ version: 'R2AInterventionEvidenceV1',
      pairId: `opaque-joint-pair-${pairIndex}`, protocolId: protocol.protocolId,
      relationId: relation.relationId, baselineEventId: baseline.eventId,
      interventionEventId: intervention.eventId,
      // Evidence order is normalized before it becomes durable state.
      changedFactorIds: [sFactorId, qFactorId], trustedActualObservation: true });
  }

  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(relation.grade, 'intervention-supported');
  assert.equal(relation.factorSetInterventions.length, 1);
  assert.deepEqual(relation.factorSetInterventions[0]!.factorIds, canonicalSet);
  assert.equal(relation.factorSetInterventions[0]!.pairIds.length, 4);
  assert.equal(relation.factorSetInterventions[0]!.branchChangeCount, 4);
  assert(relation.factorSetInterventions[0]!.removalSelectionDrops.every(value => value >= .25));
  assert.equal(relation.factorSetInterventions.some(value => value.factorIds.length === 1), false,
    'joint evidence was laundered into independent single-factor evidence');
  assert.equal(learner.relations().some(value => value.derivedFromRelationId === relation.relationId
    && value.factorIds.length === 1), false,
  'joint evidence incorrectly derived a causal singleton relation');

  const snapshot = learner.snapshot();
  assert.equal(snapshot.version, 'R2AStablePatternGraphV11');
  assert.deepEqual(new R2AStablePatternLearnerV1(frozenEncoder(), snapshot).snapshot(), snapshot);
  const tamperedProtocol = structuredClone(snapshot);
  Object.assign(tamperedProtocol.interventionProtocols[0]!, {
    changedFactorIds: [...tamperedProtocol.interventionProtocols[0]!.changedFactorIds].reverse(),
  });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tamperedProtocol),
    /checkpoint-intervention-protocol-invalid/);
  const tamperedBoundary = structuredClone(snapshot);
  Object.assign(tamperedBoundary.interventionProtocols[0]!.measurementBoundary,
    { identitySha256: '0'.repeat(64) });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tamperedBoundary),
    /checkpoint-intervention-protocol-invalid/,
  'a modified preregistered measurement boundary survived checkpoint restore');
  const tamperedSet = structuredClone(snapshot);
  Object.assign(tamperedSet.relations.find(value => value.relationId === relation.relationId)!
    .factorSetInterventions[0]!, { factorSetId: 'opaque-forged-factor-set' });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), tamperedSet),
    /checkpoint-relation-invariant-failed/);
});

test('a declared joint set fails closed when one member does not change or an outside public token changes', () => {
  const trained = trainTwoBranches(true);
  const { learner, fixture } = trained;
  const relation = trained.relation;
  const qFactorId = factorIdAtAxis(learner, relation, SCORER_Q_AXIS);
  const sFactorId = factorIdAtAxis(learner, relation, SCORER_S_AXIS);
  const protocol = learner.registerInterventionProtocol({ protocolId: 'opaque-joint-negative-protocol',
    relationId: relation.relationId, changedFactorIds: [qFactorId, sFactorId],
    formationMatchedPairs: formationMatchedPairsFor(learner, relation) });
  const baseline = fixture.event('opaque-joint-negative-baseline', BRANCH_LEFT);
  const intervention = fixture.event('opaque-joint-negative-intervention', BRANCH_RIGHT);
  observe(learner, fixture, baseline, perception(-1, -1, 0));
  observe(learner, fixture, intervention, perception(1, -1, 0));
  assert.throws(() => learner.recordIntervention({ version: 'R2AInterventionEvidenceV1',
    pairId: 'opaque-joint-negative-pair', protocolId: protocol.protocolId,
    relationId: relation.relationId, baselineEventId: baseline.eventId,
    interventionEventId: intervention.eventId, changedFactorIds: [qFactorId, sFactorId],
    trustedActualObservation: true }), /factor-set-member-did-not-change/);
  assert.equal(learner.interventionRecords().length, 0);
  assert.equal(learner.relations().find(value => value.relationId === relation.relationId)!
    .factorSetInterventions.length, 0);
});

test('an intervention pair id and either real event cannot be reused across two relations', () => {
  const trained = trainTwoBranches(false);
  const { learner, fixture, leftPatternId } = trained;
  const rightRelation = trained.relation;
  for (let index = 0; index < 6; index += 1) {
    const right = index % 2 === 0;
    observe(learner, fixture, fixture.event(`opaque-reverse-validation-${index}`,
      right ? BRANCH_RIGHT : BRANCH_LEFT), perception(right ? 1 : -1, 0, index));
  }
  const leftRelation = relationByTargetAndAxes(learner, leftPatternId, [SCORER_Q_AXIS]);
  assert.equal(leftRelation.grade, 'predictive-stable');
  const rightFactorId = factorIdAtAxis(learner, rightRelation, SCORER_Q_AXIS);
  const leftFactorId = factorIdAtAxis(learner, leftRelation, SCORER_Q_AXIS);
  const rightProtocol = learner.registerInterventionProtocol({ protocolId: 'opaque-global-pair-right-protocol',
    relationId: rightRelation.relationId, changedFactorId: rightFactorId,
    formationMatchedPairs: formationMatchedPairsFor(learner, rightRelation) });
  const leftProtocol = learner.registerInterventionProtocol({ protocolId: 'opaque-global-pair-left-protocol',
    relationId: leftRelation.relationId, changedFactorId: leftFactorId,
    formationMatchedPairs: formationMatchedPairsFor(learner, leftRelation) });
  const baseline = fixture.event('opaque-global-pair-baseline', BRANCH_LEFT);
  const intervention = fixture.event('opaque-global-pair-intervention', BRANCH_RIGHT);
  observe(learner, fixture, baseline, perception(-1, 0, 0));
  observe(learner, fixture, intervention, perception(1, 0, 0));
  learner.recordIntervention({ version: 'R2AInterventionEvidenceV1', pairId: 'opaque-global-pair',
    protocolId: rightProtocol.protocolId, relationId: rightRelation.relationId,
    baselineEventId: baseline.eventId, interventionEventId: intervention.eventId,
    changedFactorIds: [rightFactorId], trustedActualObservation: true });
  assert.throws(() => learner.recordIntervention({ version: 'R2AInterventionEvidenceV1', pairId: 'opaque-global-pair',
    protocolId: leftProtocol.protocolId, relationId: leftRelation.relationId,
    baselineEventId: baseline.eventId, interventionEventId: intervention.eventId,
    changedFactorIds: [leftFactorId], trustedActualObservation: true }),
  /intervention-pair-id-reused-across-graph|intervention-event-reused-across-pairs/);
  assert.throws(() => learner.recordIntervention({ version: 'R2AInterventionEvidenceV1',
    pairId: 'opaque-global-event-reuse-new-pair', protocolId: leftProtocol.protocolId,
    relationId: leftRelation.relationId, baselineEventId: baseline.eventId,
    interventionEventId: intervention.eventId, changedFactorIds: [leftFactorId], trustedActualObservation: true }),
  /intervention-event-reused-across-pairs/);
});

test('production causal hypothesis requires five post-formation natural matches in two nuisance contexts', () => {
  const trained = trainTwoBranches(false);
  const { learner, fixture } = trained;
  let relation = trained.relation;
  const qFactorId = factorIdAtAxis(learner, relation, SCORER_Q_AXIS);
  assert.equal(relation.grade, 'predictive-stable');

  for (let pairIndex = 0; pairIndex < 5; pairIndex += 1) {
    const contextIndex = pairIndex % 4;
    observe(learner, fixture, fixture.event(`opaque-natural-left-${pairIndex}`, BRANCH_LEFT),
      perception(-1, 0, contextIndex));
    observe(learner, fixture, fixture.event(`opaque-natural-right-${pairIndex}`, BRANCH_RIGHT),
      perception(1, 0, contextIndex));
    relation = learner.relations().find(value => value.relationId === relation.relationId)!;
    if (pairIndex < 4) assert.equal(relation.grade, 'predictive-stable',
      'pre-threshold natural matches were incorrectly promoted or accumulated before predictive validation');
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  const contrasts = relation.naturalMatchedContrasts.filter(value => value.factorId === qFactorId);
  assert(contrasts.length >= 5);
  assert(new Set(contrasts.map(value => value.matchedContextId)).size >= 2);
  assert(contrasts.every(value => value.directionallyConsistent));
  assert.equal(relation.grade, 'causal-hypothesis');
  assert.equal(learner.compareCurrentFactors(relation.relationId, perception(1, 0, 0))
    .highConfidenceActionEligible, false,
  'an observational causal hypothesis incorrectly gained intervention-only action authority');
  const restored = new R2AStablePatternLearnerV1(frozenEncoder(), learner.snapshot());
  assert.deepEqual(restored.snapshot(), learner.snapshot());
});

test('natural confirmation starts only after the relation becomes predictive', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  for (let index = 0; index < 8; index += 1) observe(learner, fixture,
    fixture.event(`opaque-boundary-left-train-${index}`, BRANCH_LEFT), perception(-1, 0, index % 4));
  let targetPatternId = '';
  for (let index = 0; index < 8; index += 1) targetPatternId = observe(learner, fixture,
    fixture.event(`opaque-boundary-right-form-${index}`, BRANCH_RIGHT), perception(1, 0, index % 4)).patternId;
  let relation = relationByTargetAndAxes(learner, targetPatternId, [SCORER_Q_AXIS]);
  assert.equal(relation.predictiveSinceEventId, null);

  // These matched-looking observations perform prospective validation. They are
  // forbidden confirmation material because they precede the frozen
  // predictive boundary.
  for (let pairIndex = 0; pairIndex < 2; pairIndex += 1) {
    observe(learner, fixture, fixture.event(`opaque-pre-predictive-left-${pairIndex}`, BRANCH_LEFT),
      perception(-1, 0, pairIndex));
    observe(learner, fixture, fixture.event(`opaque-pre-predictive-right-${pairIndex}`, BRANCH_RIGHT),
      perception(1, 0, pairIndex));
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(relation.grade, 'predictive-stable');
  assert(relation.predictiveSinceEventId);
  assert.equal(relation.naturalMatchedContrasts.length, 0,
    'pre-predictive observations were recycled as causal confirmation');

  for (let pairIndex = 0; pairIndex < 5; pairIndex += 1) {
    observe(learner, fixture, fixture.event(`opaque-post-predictive-left-${pairIndex}`, BRANCH_LEFT),
      perception(-1, 0, pairIndex));
    observe(learner, fixture, fixture.event(`opaque-post-predictive-right-${pairIndex}`, BRANCH_RIGHT),
      perception(1, 0, pairIndex));
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(relation.grade, 'causal-hypothesis');
  assert(relation.naturalMatchedContrasts.every(value => {
    const evidence = learner.snapshot().evidence;
    return evidence.findIndex(item => item.eventId === value.earlierEventId)
      > evidence.findIndex(item => item.eventId === relation.predictiveSinceEventId);
  }));
});

test('natural matching rejects unrelated R2 prefixes and unregistered branches', () => {
  const trained = trainTwoBranches(false);
  const { learner, fixture } = trained;
  let relation = trained.relation;
  for (let pairIndex = 0; pairIndex < 5; pairIndex += 1) {
    observe(learner, fixture, fixture.event(`opaque-unrelated-left-${pairIndex}`, BRANCH_UNRELATED_PREFIX),
      perception(-1, 0, pairIndex));
    observe(learner, fixture, fixture.event(`opaque-unrelated-right-${pairIndex}`, BRANCH_RIGHT),
      perception(1, 0, pairIndex));
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(relation.naturalMatchedContrasts.length, 0);
  assert.equal(relation.grade, 'predictive-stable');
});

test('natural matching rejects a small public delta that crosses another factor activation band', () => {
  const trained = trainTwoBranches(true);
  const { learner, fixture } = trained;
  let relation = trained.relation;
  assert.equal(relation.grade, 'predictive-stable');

  for (let pairIndex = 0; pairIndex < 5; pairIndex += 1) {
    const left = perception(-1, 0, pairIndex); left[SCORER_S_AXIS] = .49;
    const right = perception(1, 0, pairIndex); right[SCORER_S_AXIS] = .51;
    observe(learner, fixture, fixture.event(`opaque-natural-band-left-${pairIndex}`, BRANCH_LEFT), left);
    observe(learner, fixture, fixture.event(`opaque-natural-band-right-${pairIndex}`, BRANCH_RIGHT), right);
  }

  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(relation.naturalMatchedContrasts.length, 0,
    'a numerically small change crossed a second factor band and was misclassified as a one-factor contrast');
  assert.equal(relation.grade, 'predictive-stable');
});

test('a small public delta that crosses another factor band invalidates a matched intervention', () => {
  const trained = trainTwoBranches(true);
  const { learner, fixture } = trained;
  const relation = trained.relation;
  const qFactorId = factorIdAtAxis(learner, relation, SCORER_Q_AXIS);
  const protocol = learner.registerInterventionProtocol({ protocolId: 'opaque-band-crossing-protocol',
    relationId: relation.relationId, changedFactorId: qFactorId,
    formationMatchedPairs: formationMatchedPairsFor(learner, relation) });
  const baselinePerception = perception(-1, 0, 0); baselinePerception[SCORER_S_AXIS] = .49;
  const interventionPerception = perception(1, 0, 0); interventionPerception[SCORER_S_AXIS] = .51;
  const baseline = fixture.event('opaque-band-crossing-baseline', BRANCH_LEFT);
  const intervention = fixture.event('opaque-band-crossing-intervention', BRANCH_RIGHT);
  observe(learner, fixture, baseline, baselinePerception);
  observe(learner, fixture, intervention, interventionPerception);
  assert.throws(() => learner.recordIntervention({ version: 'R2AInterventionEvidenceV1',
    pairId: 'opaque-band-crossing-pair', protocolId: protocol.protocolId, relationId: relation.relationId,
    baselineEventId: baseline.eventId, interventionEventId: intervention.eventId,
    changedFactorIds: [qFactorId], trustedActualObservation: true }),
  /intervention-changed-outside-preregistered-factor-set/);
});

test('production q-by-s evidence supports q but keeps a repeated correlate out of production', () => {
  const trained = trainTwoBranches(true);
  const { learner, fixture } = trained;
  let relation = trained.relation;
  const qFactorId = factorIdAtAxis(learner, relation, SCORER_Q_AXIS);
  const sFactorId = factorIdAtAxis(learner, relation, SCORER_S_AXIS);

  for (let pairIndex = 0; pairIndex < 4; pairIndex += 1) {
    const protocol = learner.registerInterventionProtocol({ protocolId: `opaque-q-protocol-${pairIndex}`,
      relationId: relation.relationId, changedFactorId: qFactorId,
      formationMatchedPairs: formationMatchedPairsFor(learner, relation) });
    const baseline = fixture.event(`opaque-q-baseline-${pairIndex}`, BRANCH_LEFT);
    const intervention = fixture.event(`opaque-q-intervention-${pairIndex}`, BRANCH_RIGHT);
    observe(learner, fixture, baseline, perception(-1, 1, pairIndex));
    observe(learner, fixture, intervention, perception(1, 1, pairIndex));
    learner.recordIntervention({
      version: 'R2AInterventionEvidenceV1',
      pairId: `opaque-q-pair-${pairIndex}`,
      protocolId: protocol.protocolId,
      relationId: relation.relationId,
      baselineEventId: baseline.eventId,
      interventionEventId: intervention.eventId,
      changedFactorIds: [qFactorId],
      trustedActualObservation: true,
    });
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.notEqual(relation.grade, 'intervention-supported',
    'q evidence incorrectly laundered the still-confounded s factor into production');

  for (let pairIndex = 0; pairIndex < 4; pairIndex += 1) {
    const protocol = learner.registerInterventionProtocol({ protocolId: `opaque-s-protocol-${pairIndex}`,
      relationId: relation.relationId, changedFactorId: sFactorId,
      formationMatchedPairs: formationMatchedPairsFor(learner, relation) });
    const baseline = fixture.event(`opaque-s-baseline-${pairIndex}`, BRANCH_RIGHT);
    const intervention = fixture.event(`opaque-s-intervention-${pairIndex}`, BRANCH_RIGHT);
    observe(learner, fixture, baseline, perception(1, -1, pairIndex));
    observe(learner, fixture, intervention, perception(1, 1, pairIndex));
    learner.recordIntervention({
      version: 'R2AInterventionEvidenceV1',
      pairId: `opaque-s-pair-${pairIndex}`,
      protocolId: protocol.protocolId,
      relationId: relation.relationId,
      baselineEventId: baseline.eventId,
      interventionEventId: intervention.eventId,
      changedFactorIds: [sFactorId],
      trustedActualObservation: true,
    });
  }
  relation = learner.relations().find(value => value.relationId === relation.relationId)!;
  const qEvidence = relation.factorSetInterventions.find(value => value.factorIds.length === 1
    && value.factorIds[0] === qFactorId)!;
  const sEvidence = relation.factorSetInterventions.find(value => value.factorIds.length === 1
    && value.factorIds[0] === sFactorId)!;
  assert.equal(qEvidence.pairIds.length, 4);
  assert.equal(qEvidence.branchChangeCount, 4);
  assert(qEvidence.removalSelectionDrops.every(value => value >= 0.25));
  assert.equal(sEvidence.pairIds.length, 4);
  assert.equal(sEvidence.branchChangeCount, 0);
  assert(sEvidence.removalSelectionDrops.every(value => value === 0));
  assert.notEqual(relation.grade, 'intervention-supported');
  assert.notEqual(relation.grade, 'causal-hypothesis');
  assert.equal(learner.compareCurrentFactors(relation.relationId, perception(1, 1, 0))
    .highConfidenceActionEligible, false,
  'the observationally repeated but intervention-null s factor reached production');

  let reduced = learner.relations().find(value => {
    const candidate = value as R2AStablePatternHyperedgeV1 & { readonly derivedFromRelationId?: string | null };
    return candidate.derivedFromRelationId === relation.relationId
      && candidate.factorIds.length === 1 && candidate.factorIds[0] === qFactorId;
  });
  assert(reduced, 'matched q-success and s-null interventions did not identify a minimal q-only hyperedge');
  assert.equal(reduced.validationEventIds.length, 0,
    'the reduced relation copied parent validation instead of starting a prospective validation boundary');
  assert.equal(reduced.grade, 'repeated-correlation');

  for (let index = 0; index < 4; index += 1) {
    const target = index % 2 === 0;
    observe(learner, fixture, fixture.event(`opaque-reduced-validation-${index}`,
      target ? BRANCH_RIGHT : BRANCH_LEFT), perception(target ? 1 : -1, index % 2 === 0 ? 1 : -1, index));
  }
  reduced = learner.relations().find(value => value.relationId === reduced!.relationId)!;
  assert.equal(reduced.grade, 'predictive-stable');

  for (let pairIndex = 0; pairIndex < 4; pairIndex += 1) {
    const protocol = learner.registerInterventionProtocol({ protocolId: `opaque-reduced-q-protocol-${pairIndex}`,
      relationId: reduced.relationId, changedFactorId: qFactorId,
      formationMatchedPairs: formationMatchedPairsFor(learner, reduced) });
    const baseline = fixture.event(`opaque-reduced-q-baseline-${pairIndex}`, BRANCH_LEFT);
    const intervention = fixture.event(`opaque-reduced-q-intervention-${pairIndex}`, BRANCH_RIGHT);
    observe(learner, fixture, baseline, perception(-1, 0, pairIndex));
    observe(learner, fixture, intervention, perception(1, 0, pairIndex));
    learner.recordIntervention({ version: 'R2AInterventionEvidenceV1',
      pairId: `opaque-reduced-q-pair-${pairIndex}`, protocolId: protocol.protocolId,
      relationId: reduced.relationId, baselineEventId: baseline.eventId,
      interventionEventId: intervention.eventId, changedFactorIds: [qFactorId],
      trustedActualObservation: true });
  }
  reduced = learner.relations().find(value => value.relationId === reduced!.relationId)!;
  assert.equal(reduced.grade, 'intervention-supported');
  assert.equal(learner.compareCurrentFactors(reduced.relationId, perception(1, 0, 0))
    .highConfidenceActionEligible, true);
  assert.equal(learner.relations().some(value => value.factorIds.length === 1 && value.factorIds[0] === sFactorId
    && value.grade === 'intervention-supported'), false,
  'the intervention-null s correlate was promoted as a minimal production factor');
  const finalSnapshot = learner.snapshot();
  assert.deepEqual(new R2AStablePatternLearnerV1(frozenEncoder(), finalSnapshot).snapshot(), finalSnapshot);
  const forgedParent = structuredClone(finalSnapshot);
  Object.assign(forgedParent.relations.find(value => value.relationId === reduced!.relationId)!,
    { derivedFromRelationId: null });
  assert.throws(() => new R2AStablePatternLearnerV1(frozenEncoder(), forgedParent),
    /relation-invariant|derived-relation/);
});

test('R2A physical recovery removes current factor applicability without deleting audit relations', () => {
  const trained = trainTwoBranches(false);
  const relation = trained.relation;
  const before = trained.learner.compareCurrentFactors(relation.relationId, perception(1, 0, 0));
  assert.equal(before.predictionEligible, true);
  assert(before.applicability > 0);

  trained.learner.advanceTo(trained.learner.logicalTime + 1e9);
  const after = trained.learner.compareCurrentFactors(relation.relationId, perception(1, 0, 0));
  assert.equal(after.applicability, 0);
  assert.equal(after.predictionEligible, false);
  assert.equal(after.highConfidenceActionEligible, false);
  assert.equal(trained.learner.relations().some(value => value.relationId === relation.relationId), true,
    'physical recovery should invalidate support, not erase the audit relation');
});

test('R2A rejects reversed real-event time without leaving a partial pattern or physical write', () => {
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const fixture = new RealR2EvidenceFixture();
  const first = fixture.event('opaque-time-ordered-first', BRANCH_LEFT);
  observe(learner, fixture, first, perception(1, 0, 0));
  const before = learner.snapshot();
  const reversed = structuredClone(fixture.event('opaque-time-reversed-second', BRANCH_LEFT));
  Object.assign(reversed, { startedAt: first.startedAt - 2, endedAt: first.endedAt - 1 });
  assert.throws(() => learner.observe({ version: 'R2PatternEvidenceInputV1', event: reversed,
    contextId: 'caller-label-is-not-evidence',
    atomPrePerceptions: reversed.atomIds.map(() => perception(1, 0, 1)),
    trustedActualObservation: true }, () => true), /R2A-evidence-real-time-order-reversed/);
  assert.deepEqual(learner.snapshot(), before,
    'a rejected time-reversed event changed R2A audit or physical state');
});
