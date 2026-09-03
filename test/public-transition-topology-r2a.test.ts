import test from 'node:test';
import assert from 'node:assert/strict';
import * as eventFunctions from '../src/events.js';
import type { Observation, PublicValue, RealEvent } from '../src/contracts.js';
import {
  R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
  R2ContinuousEventStore,
} from '../src/core/learning/r2-continuous-event.js';
import type {
  R1ClosedEventAtomV1,
  R2ContinuousEventV1,
} from '../src/core/learning/r2-continuous-event.js';
import {
  R2AStablePatternLearnerV1,
} from '../src/core/learning/r2a-stable-pattern.js';
import type {
  R2StablePatternV1,
} from '../src/core/learning/r2a-stable-pattern.js';
import {
  DeterministicTokenFieldEncoder,
  TOKEN_FIELD_WIDTH,
} from '../src/core/learning/token-field.js';
import { vec3 } from '../src/core/vector.js';

type PublicTransitionTopologyIdentityFunctionV1 = (event: RealEvent) => string;
type R1AtomWithPublicTransitionTopologyV1 = R1ClosedEventAtomV1 & {
  readonly publicTransitionTopologyId: string;
};
type R2EventWithPublicTransitionTopologyV1 = R2ContinuousEventV1 & {
  readonly orderedTransitionTopologyIds: readonly string[];
};
type R2PatternWithPublicTransitionTopologyV1 = R2StablePatternV1 & {
  readonly orderedTransitionTopologyIds: readonly string[];
};

const ROAD = [vec3(0, 0, 0), vec3(.5, 0, 0), vec3(1, 0, 0)] as const;
const ACTION_IDENTITIES = ['opaque-step-0', 'opaque-step-1', 'opaque-step-2'] as const;

function topologyIdentityFunction(): PublicTransitionTopologyIdentityFunctionV1 {
  const candidate = (eventFunctions as unknown as Record<string, unknown>).publicTransitionTopologyIdV1;
  assert.equal(typeof candidate, 'function',
    'events.ts must export publicTransitionTopologyIdV1(event), not make callers supply a result label');
  return candidate as PublicTransitionTopologyIdentityFunctionV1;
}

function frame(sequence: number, activeSeconds: number, subjectId: string,
  property: string, value: PublicValue): Observation {
  return {
    sequence,
    activeSeconds,
    objects: [{ id: subjectId, type: 'opaque-public-type', relativePosition: [0, 0, 1],
      properties: { [property]: value } }],
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    targetId: null,
    contextId: `opaque-context-${sequence}`,
  };
}

function publicTransitionEvent(input: {
  readonly label: string;
  readonly subjectId: string;
  readonly property: string;
  readonly samples: readonly PublicValue[];
  readonly sequenceBase: number;
  readonly activeSecondsBase: number;
}): RealEvent {
  assert(input.samples.length >= 2);
  return {
    version: 'RealEventV5',
    id: `opaque-real-event-${input.label}`,
    cue: { kind: 'passive', parameters: {}, targetRole: null },
    frames: input.samples.map((value, index) => frame(input.sequenceBase + index,
      input.activeSecondsBase + index * .05, input.subjectId, input.property, value)),
    trackedIds: ['self', input.subjectId],
    bodyResult: null,
    provenance: 'observed-passive',
    complete: true,
  };
}

function transitionEvent(label: string, before: PublicValue, after: PublicValue,
  subjectId = `opaque-subject-${label}`, sequenceBase = 0, activeSecondsBase = 0): RealEvent {
  return publicTransitionEvent({ label, subjectId, property: 'opaque-discrete-state',
    samples: [before, after], sequenceBase, activeSecondsBase });
}

function topologyId(event: RealEvent): string {
  const value = topologyIdentityFunction()(event);
  assert.match(value, /^[a-z0-9-]*[a-f0-9]{16,}$/i,
    'public transition topology must be a stable opaque identity');
  return value;
}

function perception(contextIndex: number): Float64Array {
  const value = new Float64Array(TOKEN_FIELD_WIDTH);
  value[101] = contextIndex % 2 === 0 ? -1 : 1;
  value[173] = Math.floor(contextIndex / 2) % 2 === 0 ? -1 : 1;
  return value;
}

function frozenEncoder(): DeterministicTokenFieldEncoder {
  const encoder = new DeterministicTokenFieldEncoder();
  const calibration = Array.from({ length: 16 }, (_, index) => perception(index));
  encoder.fit(calibration);
  encoder.freeze();
  return encoder;
}

class PublicTopologyR2Fixture {
  readonly store = new R2ContinuousEventStore();
  #eventSequence = 0;

  readonly traceActive = (pageId: string, traceId: string): boolean =>
    this.store.isTraceActive(pageId, traceId);

  event(label: string, publicEvents: readonly RealEvent[],
    coordinates = ROAD, exactExperienceIdentities = ACTION_IDENTITIES): R2EventWithPublicTransitionTopologyV1 {
    assert.equal(publicEvents.length, coordinates.length);
    assert.equal(publicEvents.length, exactExperienceIdentities.length);
    const eventSequence = this.#eventSequence++;
    const atoms = publicEvents.map((publicEvent, atomIndex) => this.#atom(label, eventSequence, atomIndex,
      coordinates[atomIndex]!, exactExperienceIdentities[atomIndex]!, topologyId(publicEvent)));
    this.store.begin(atoms[0]!);
    for (const atom of atoms.slice(1)) this.store.append(atom);
    const receipt = this.store.close({ version: 'R2EventBoundaryV1', completion: 'complete',
      reason: 'public-process-resolved' });
    assert.equal(receipt.status, 'committed');
    if (receipt.status !== 'committed') return assert.fail('topology fixture R2 event did not commit');
    const event = receipt.event as R2EventWithPublicTransitionTopologyV1;
    assert.deepEqual(event.orderedTransitionTopologyIds, atoms.map(atom => atom.publicTransitionTopologyId),
      'R2 did not carry the one-to-one public transition topology sequence from its real R1 atoms');
    return event;
  }

  #atom(label: string, eventSequence: number, atomIndex: number, coordinate: Float64Array,
    exactExperienceIdentity: string, publicTransitionTopologyId: string): R1AtomWithPublicTransitionTopologyV1 {
    const identity = `${eventSequence}-${label}-${atomIndex}`;
    const sourceEventId = `opaque-source-${identity}`;
    const startFrameSequence = eventSequence * 1_000 + atomIndex * 2;
    const startedAt = eventSequence + atomIndex * .05;
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
      sessionId: 'opaque-public-topology-session',
      continuityEpochId: 'opaque-public-topology-epoch',
      startedAt,
      endedAt: startedAt + .04,
      startFrameSequence,
      endFrameSequence: startFrameSequence + 1,
      publicContinuityDependencies: [{
        version: 'PublicContinuityDependencyV1',
        dependencyId: `opaque-process-${eventSequence}`,
        basis: 'public-state-carried-forward',
        evidence: {
          version: 'PublicContinuityEvidenceReferenceV1',
          sourceEventId,
          subject: 'opaque-public-role',
          property: 'opaque-public-state',
          beforeObservationSequence: startFrameSequence,
          afterObservationSequence: startFrameSequence + 1,
          beforeValueSha256: '0'.repeat(64),
          afterValueSha256: '0'.repeat(64),
          factCategory: 'public-state-persistence',
        },
      }],
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
      r2Coordinate: new Float64Array(coordinate),
    };
  }
}

function chain(label: string, transitions: readonly (readonly [PublicValue, PublicValue])[],
  subjectPrefix: string, sequenceBase: number): readonly RealEvent[] {
  return transitions.map(([before, after], index) => transitionEvent(`${label}-${index}`, before, after,
    `${subjectPrefix}-${index}`, sequenceBase + index * 10, sequenceBase / 20 + index));
}

function observe(learner: R2AStablePatternLearnerV1, fixture: PublicTopologyR2Fixture,
  event: R2EventWithPublicTransitionTopologyV1, contextIndex: number): R2PatternWithPublicTransitionTopologyV1 {
  return learner.observe({ version: 'R2PatternEvidenceInputV1', event,
    contextId: 'caller-context-is-not-pattern-evidence',
    atomPrePerceptions: event.atomIds.map(() => perception(contextIndex)),
    trustedActualObservation: true }, fixture.traceActive) as R2PatternWithPublicTransitionTopologyV1;
}

test('public transition topology ignores concrete object identity and temporal resampling', () => {
  const first = publicTransitionEvent({ label: 'identity-a', subjectId: 'opaque-concrete-id-a',
    property: 'opaque-discrete-state', samples: [0, 1], sequenceBase: 10, activeSecondsBase: 1 });
  const renamedAndResampled = publicTransitionEvent({ label: 'identity-b', subjectId: 'opaque-concrete-id-b',
    property: 'opaque-discrete-state', samples: [0, 0, 0, 1], sequenceBase: 900,
    activeSecondsBase: 500 });
  assert.equal(topologyId(first), topologyId(renamedAndResampled));
});

test('continuous numerical jitter is equivalent while discrete successor transitions remain distinct', () => {
  const continuousA = publicTransitionEvent({ label: 'continuous-a', subjectId: 'opaque-continuous-a',
    property: 'opaque-continuous-measurement', samples: [.5000001, .6250001, .7500001],
    sequenceBase: 20, activeSecondsBase: 2 });
  const continuousB = publicTransitionEvent({ label: 'continuous-b', subjectId: 'opaque-continuous-b',
    property: 'opaque-continuous-measurement', samples: [.5000002, .55, .7, .7499999],
    sequenceBase: 2_000, activeSecondsBase: 200 });
  assert.equal(topologyId(continuousA), topologyId(continuousB),
    'sub-resolution floating jitter or extra samples split one public transition topology');

  const successors = [[0, 1], [1, 2], [2, 3]] as const;
  const identities = successors.map(([before, after], index) => topologyId(
    transitionEvent(`successor-${index}`, before, after, `opaque-discrete-${index}`, index * 20, index)));
  assert.equal(new Set(identities).size, 3,
    'three different public successor transitions collapsed into one topology identity');
});

test('R2 carries exactly one ordered topology identity for each real R1 atom', () => {
  const fixture = new PublicTopologyR2Fixture();
  const transitions = chain('one-to-one', [[-1, -1], [0, 1], [1, 1]], 'opaque-object', 100);
  const event = fixture.event('one-to-one', transitions);
  assert.equal(event.orderedTransitionTopologyIds.length, event.atomIds.length);
  assert.deepEqual(event.orderedTransitionTopologyIds, transitions.map(topologyId));
});

test('public transition variants remain audit evidence and cannot split one physical R2 road', () => {
  const fixture = new PublicTopologyR2Fixture();
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const patternIds = new Map<number, Set<string>>([[0, new Set()], [1, new Set()], [2, new Set()]]);
  for (let repeat = 0; repeat < 8; repeat += 1) for (const before of [0, 1, 2]) {
    const transitions = chain(`successor-${before}-${repeat}`,
      [[-1, -1], [before, before + 1], [-1, -1]], `opaque-renamed-${before}-${repeat}`,
      10_000 + repeat * 1_000 + before * 100);
    const event = fixture.event(`successor-${before}-${repeat}`, transitions);
    const pattern = observe(learner, fixture, event, repeat % 4);
    patternIds.get(before)!.add(pattern.patternId);
  }
  assert.deepEqual([...patternIds.values()].map(ids => ids.size), [1, 1, 1],
    'renamed/resampled repeats of one transition did not remain in one stable pattern');
  assert.equal(new Set([...patternIds.values()].map(ids => [...ids][0]!)).size, 1,
    'a public topology hash overrode the physical R2 road membership');
  const pattern = learner.patterns()[0]!;
  assert.equal(pattern.supportCount, 24);
  assert.equal(pattern.grade, 'predictive-stable');
  assert.deepEqual(pattern.orderedTransitionTopologyVariantCounts, [1, 3, 1]);
  assert.equal(learner.relations().length, 0,
    'topology metadata alone manufactured a physical branch relation');
  const evidenceVariants = new Set(learner.snapshot().evidence.map(value =>
    value.orderedTransitionTopologyIds[1]));
  assert.equal(evidenceVariants.size, 3, 'the three actual public outcomes were deleted from audit evidence');
  assert.deepEqual(new R2AStablePatternLearnerV1(frozenEncoder(), learner.snapshot()).snapshot(),
    learner.snapshot(), 'a mixed-topology physical pattern did not round-trip exactly');
});

test('reordered topology alone cannot override an identical physical road and action sequence', () => {
  const fixture = new PublicTopologyR2Fixture();
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  const base = observe(learner, fixture, fixture.event('ordered-base',
    chain('ordered-base', [[0, 1], [1, 2], [2, 3]], 'opaque-base', 30_000)), 0);
  const reordered = observe(learner, fixture, fixture.event('ordered-reordered',
    chain('ordered-reordered', [[1, 2], [0, 1], [2, 3]], 'opaque-reordered', 31_000)), 1);
  const missing = observe(learner, fixture, fixture.event('ordered-missing',
    chain('ordered-missing', [[0, 1], [1, 1], [2, 3]], 'opaque-missing', 32_000)), 2);
  assert.equal(new Set([base.patternId, reordered.patternId, missing.patternId]).size, 1,
    'a discrete topology hash acted as a hidden second pattern classifier');
  const pattern = learner.patterns()[0]!;
  assert.equal(pattern.supportCount, 3);
  assert.deepEqual(pattern.orderedTransitionTopologyVariantCounts, [2, 3, 1]);
  assert.equal(new Set(learner.snapshot().evidence.map(value =>
    value.orderedTransitionTopologyIds.join('|'))).size, 3,
  'the physical merge erased the actual ordered public-transition audit records');
});

test('topology metadata cannot create or preserve physical support after R2 or R2A recovery', () => {
  const r2ErasedFixture = new PublicTopologyR2Fixture();
  const event = r2ErasedFixture.event('r2-erased',
    chain('r2-erased', [[-1, -1], [0, 1], [-1, -1]], 'opaque-r2-erased', 40_000));
  r2ErasedFixture.store.recover(1e9);
  const withoutR2 = new R2AStablePatternLearnerV1(frozenEncoder());
  assert.throws(() => observe(withoutR2, r2ErasedFixture, event, 0), /R2A-requires-active-R2-road/);
  assert.equal(withoutR2.patterns().length, 0,
    'topology metadata created a pattern without an active physical R2 road');

  const fixture = new PublicTopologyR2Fixture();
  const learner = new R2AStablePatternLearnerV1(frozenEncoder());
  let stable: R2PatternWithPublicTransitionTopologyV1 | null = null;
  for (let repeat = 0; repeat < 8; repeat += 1) stable = observe(learner, fixture,
    fixture.event(`r2a-recovery-${repeat}`, chain(`r2a-recovery-${repeat}`,
      [[-1, -1], [0, 1], [-1, -1]], `opaque-r2a-recovery-${repeat}`, 50_000 + repeat * 100)),
    repeat % 4);
  assert(stable);
  const before = learner.assessContinuation(stable.patternId, stable.prototypeCoordinates.slice(0, 2),
    perception(0), stable.orderedExperienceIdentities.slice(0, 2),
    stable.orderedTransitionTopologyIds.slice(0, 2));
  assert.equal(before.predictionEligible, true);
  learner.advanceTo(learner.logicalTime + 1e9);
  const after = learner.assessContinuation(stable.patternId, stable.prototypeCoordinates.slice(0, 2),
    perception(0), stable.orderedExperienceIdentities.slice(0, 2),
    stable.orderedTransitionTopologyIds.slice(0, 2));
  assert.equal(after.predictionEligible, false);
  assert.equal(after.reason, 'stable-pattern-physical-support-recovered');
});
