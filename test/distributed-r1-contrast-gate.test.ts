import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActionCue, Observation, PublicValue, RealEvent } from '../src/contracts.js';
import { SelfOrganizingAfferentProjectionV1 }
  from '../src/core/learning/self-organizing-afferent.js';
import { DistributedR1ExperienceStoreV1 }
  from '../src/core/learning/distributed-r1.js';
import type { R1DistributedEpisodeV1, R1SparseFieldPulseV1 }
  from '../src/core/learning/distributed-r1-contracts.js';
import { DistributedPhysicalMedium3DV1, distributedMediumConfig }
  from '../src/core/physics/distributed-physical-medium.js';
import { sha } from '../src/util.js';
import { readAttempt018RealEvents } from './support/attempt018-replay.js';

interface FrameState {
  readonly a?: PublicValue;
  readonly b?: PublicValue;
  readonly target?: 'a' | 'b' | null;
}

function neutralEvent(id: string, states: readonly FrameState[], options: {
  readonly cue?: ActionCue; readonly complete?: boolean; readonly translation?: number;
  readonly contextId?: string; readonly startSequence?: number; readonly startSeconds?: number;
} = {}): RealEvent {
  const cue = options.cue ?? { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };
  const start = options.startSequence ?? 0, time = options.startSeconds ?? 0;
  const translation = options.translation ?? 0;
  const frames: Observation[] = states.map((state, index) => {
    const objects = [
      ...(state.a === undefined ? [] : [{ id: 'public-a', type: 'opaque-a' as const,
        relativePosition: [1, 0, 0] as const, properties: { state: state.a } }]),
      ...(state.b === undefined ? [] : [{ id: 'public-b', type: 'opaque-b' as const,
        relativePosition: [2, 0, 0] as const, properties: { state: state.b } }]),
    ];
    return { sequence: start + index, activeSeconds: time + index * .05,
      objects, self: { position: [translation, 0, 0], yaw: 0, pitch: 0,
        properties: { onGround: true } }, targetId: state.target === 'a' ? 'public-a'
        : state.target === 'b' ? 'public-b' : null,
      contextId: options.contextId ?? 'opaque-layout' };
  });
  const action = { kind: cue.kind === 'passive' ? 'observe' as const : cue.kind,
    parameters: { ...cue.parameters }, ...(cue.targetRole === 'opaque-a' ? { targetId: 'public-a' } : {}) };
  return { version: 'RealEventV5', id, cue, frames, trackedIds: ['self', 'public-a', 'public-b'],
    provenance: 'executed-real-body', complete: options.complete ?? true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: frames[0]!.sequence,
      endSequence: frames.at(-1)!.sequence, terminationReason: 'stable' } };
}

function freshProjection(): { medium: DistributedPhysicalMedium3DV1;
  projection: SelfOrganizingAfferentProjectionV1 } {
  return { medium: new DistributedPhysicalMedium3DV1(distributedMediumConfig('R1', 'c001d00d')),
    projection: new SelfOrganizingAfferentProjectionV1(0xc001d00dn) };
}

function weighted(pulse: R1SparseFieldPulseV1): Map<number, number> {
  return new Map(pulse.drives.map(value => [value.siteId, value.intensity]));
}

function jaccard(left: Map<number, number>, right: Map<number, number>): number {
  const ids = new Set([...left.keys(), ...right.keys()]);
  let intersection = 0, union = 0;
  for (const id of ids) {
    intersection += Math.min(left.get(id) ?? 0, right.get(id) ?? 0);
    union += Math.max(left.get(id) ?? 0, right.get(id) ?? 0);
  }
  return union === 0 ? 1 : intersection / union;
}

function orderedOverlap(left: R1DistributedEpisodeV1, right: R1DistributedEpisodeV1): number {
  const count = Math.max(left.pulses.length, right.pulses.length);
  let weightedSum = 0, weight = 0;
  for (let index = 0; index < count; index += 1) {
    const l = left.pulses[index], r = right.pulses[index];
    if (!l || !r) { weight += 1; continue; }
    const dwell = Math.max(l.dwellSeconds, r.dwellSeconds, .001);
    weightedSum += jaccard(weighted(l), weighted(r)) * dwell; weight += dwell;
  }
  return weight === 0 ? 1 : weightedSum / weight;
}

function terminalOverlap(left: R1DistributedEpisodeV1, right: R1DistributedEpisodeV1): number {
  return jaccard(weighted(left.pulses.at(-1)!), weighted(right.pulses.at(-1)!));
}

function projectPair(left: RealEvent, right: RealEvent) {
  const { medium, projection } = freshProjection();
  return [projection.projectEvent(left, medium).episode,
    projection.projectEvent(right, medium).episode] as const;
}

test('G2 equivalent retiming, resampling, context, and absolute translation reuse one distributed pattern', () => {
  const values = [{ a: false, target: 'a' as const }, { a: false, target: 'a' as const },
    { a: true, target: 'a' as const }];
  const first = neutralEvent('equivalent-1', values);
  const second = neutralEvent('equivalent-2', values, { translation: 10_000,
    startSequence: 500, startSeconds: 90, contextId: 'other-layout' });
  const [left, right] = projectPair(first, second);
  assert.equal(orderedOverlap(left, right), 1);
  assert.equal(terminalOverlap(left, right), 1);
  assert.equal(left.patternSha256, right.patternSha256);
});

test('G2 seven anonymous contrasts share action prefixes but never collapse their terminal state', () => {
  const cue: ActionCue = { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };
  const contrasts: readonly [string, RealEvent, RealEvent][] = [
    ['false/true', neutralEvent('ft', [{ a: false }, { a: true }], { cue }),
      neutralEvent('tf', [{ a: true }, { a: false }], { cue })],
    ['unbound/bound', neutralEvent('ub', [{ a: false, target: null }, { a: false, target: 'a' }], { cue }),
      neutralEvent('bu', [{ a: false, target: 'a' }, { a: false, target: null }], { cue })],
    ['increase/decrease', neutralEvent('inc', [{ a: 0 }, { a: 1 }], { cue }),
      neutralEvent('dec', [{ a: 1 }, { a: 0 }], { cue })],
    ['effect/no-effect', neutralEvent('effect', [{ a: false }, { a: true }], { cue }),
      neutralEvent('none', [{ a: false }, { a: false }], { cue })],
    ['subject-a/subject-b', neutralEvent('sa', [{ a: false, b: false }, { a: true, b: false }], { cue }),
      neutralEvent('sb', [{ a: false, b: false }, { a: false, b: true }], { cue })],
    ['visible/disappeared', neutralEvent('vis', [{ a: false }, { a: true }], { cue }),
      neutralEvent('gone', [{ a: false }, {}], { cue })],
    ['different-terminal', neutralEvent('v1', [{ a: 0 }, { a: 2 }], { cue }),
      neutralEvent('v2', [{ a: 0 }, { a: -2 }], { cue })],
  ];
  for (const [name, a, b] of contrasts) {
    const [left, right] = projectPair(a, b);
    assert.equal(jaccard(weighted(left.pulses[1]!), weighted(right.pulses[1]!)), 1,
      `${name}: identical cue lost its shared physical prefix`);
    assert(terminalOverlap(left, right) <= .20,
      `${name}: opposite terminal states collapsed (${terminalOverlap(left, right)})`);
    assert.notEqual(left.patternSha256, right.patternSha256, `${name}: pattern hash collapsed`);
  }
});

test('G2 temporal order remains physical even when both episodes end in the same public state', () => {
  const cue: ActionCue = { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };
  const abEvent = neutralEvent('ab', [
    { a: false, b: false }, { a: true, b: false }, { a: true, b: true }], { cue });
  const baEvent = neutralEvent('ba', [
    { a: false, b: false }, { a: false, b: true }, { a: true, b: true }], { cue });
  assert.deepEqual(abEvent.frames.at(-1)!.objects, baEvent.frames.at(-1)!.objects,
    'fixture no longer ends in the same public state');
  const { medium, projection } = freshProjection();
  const first = projection.projectEvent(abEvent, medium);
  const second = projection.projectEvent(baEvent, medium);
  const ab = first.episode, ba = second.episode;
  const abFootprint = medium.applyEpisode(ab, 1);
  const baFootprint = medium.applyEpisode(ba, 1);
  assert.equal(second.newlyAllocatedSignalCount, 0,
    'reverse order allocated a forbidden whole-sequence afferent token');
  assert.equal(terminalOverlap(ab, ba), 1,
    'identical final public state should use the same terminal population');
  assert.deepEqual([...new Set(ab.pulses.flatMap(pulse => pulse.drives.map(drive => drive.siteId)))].sort((a, b) => a - b),
    [...new Set(ba.pulses.flatMap(pulse => pulse.drives.map(drive => drive.siteId)))].sort((a, b) => a - b),
    'reverse order changed the afferent populations instead of only their temporal propagation');
  assert(orderedOverlap(ab, ba) < .90, 'A→B and B→A were reduced to a bag of active sites');
  assert.notDeepEqual(abFootprint.directedBondIds, baFootprint.directedBondIds,
    'reverse order was not expressed by different physical directed channels');
});

test('R1 stable qualification requires repeated physical return, not record similarity alone', () => {
  const medium = new DistributedPhysicalMedium3DV1(distributedMediumConfig('R1', 'a771ac70'));
  const store = new DistributedR1ExperienceStoreV1(medium, 0xa771ac70n);
  for (let index = 0; index < 8; index += 1) store.observe(neutralEvent(`attractor-${index}`,
    [{ a: false }, { a: true }], { contextId: `independent-${index % 4}` }));
  const before = sha(medium.snapshot());
  const qualification = store.attractorQualification('attractor-0');
  assert.equal(qualification.status, 'stable-attractor', JSON.stringify(qualification));
  assert.equal(qualification.supportingEventIds.length, 8);
  assert.equal(qualification.independentContextCount, 4);
  assert(qualification.targetReturnCount >= 8);
  assert.equal(sha(medium.snapshot()), before, 'attractor qualification wrote into R1');

  const emptySnapshot = structuredClone(medium.snapshot());
  for (const site of emptySnapshot.sites as unknown as Array<{
    potentialDepth: number; supportMass: number; activation: number }>) {
    site.potentialDepth = 0; site.supportMass = 0; site.activation = 0;
  }
  (emptySnapshot as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const emptyMedium = DistributedPhysicalMedium3DV1.fromSnapshot(emptySnapshot);
  const state = structuredClone(store.snapshot());
  (state as unknown as { mediumSnapshotSha256: string }).mediumSnapshotSha256 = sha(emptySnapshot);
  const restored = DistributedR1ExperienceStoreV1.restore(emptyMedium, state);
  assert.equal(restored.attractorQualification('attractor-0').status, 'weak-footprint',
    'metadata-only repeated records recreated a stable attractor');
});

test('G2 censored events cannot alter afferent bindings or the physical medium', () => {
  const { medium, projection } = freshProjection();
  const event = neutralEvent('censored', [{ a: false }, { a: true }], { complete: false });
  const bindingBefore = sha(projection.snapshot()), mediumBefore = sha(medium.snapshot());
  assert.throws(() => projection.projectEvent(event, medium), /complete|censored|closed/);
  assert.equal(sha(projection.snapshot()), bindingBefore);
  assert.equal(sha(medium.snapshot()), mediumBefore);
});

const attempt018 = readAttempt018RealEvents();
const ATTEMPT_PAIRS = [
  ['look-plus-15-acquire', 'look-plus-15-away'],
  ['look-minus-15-acquire', 'look-minus-15-away'],
  ['forward-reduce-distance', 'forward-blocked'],
  ['left-clear', 'left-blocked'],
  ['right-clear', 'right-blocked'],
  ['jump-forward-clear-one-block', 'jump-forward-blocked-low-roof-high-obstacle'],
  ['interact-wired-button-opens-iron-door', 'interact-visible-disconnected-button-no-door-change'],
] as const;

async function projectAttemptPrefix(prefix: 32 | 64 | 128) {
  const source = await attempt018;
  const { medium, projection } = freshProjection();
  const samples = [] as Array<{ arm: string; episode: R1DistributedEpisodeV1 }>;
  for (let index = 0; index < prefix; index += 1) {
    const episode = projection.projectEvent(source.events[index]!, medium).episode;
    if (index % 2 === 0) samples.push({ arm: source.scorerArms[index]!, episode });
  }
  return samples;
}

function binaryLeaveOneOutAccuracy(samples: readonly { arm: string; episode: R1DistributedEpisodeV1 }[],
  positive: string, negative: string): number {
  const relevant = samples.filter(value => value.arm === positive || value.arm === negative);
  let correct = 0;
  for (const sample of relevant) {
    const averages = [positive, negative].map(arm => {
      const others = relevant.filter(value => value !== sample && value.arm === arm);
      return [arm, others.length === 0 ? -1 : others.reduce((sum, value) =>
        sum + orderedOverlap(sample.episode, value.episode), 0) / others.length] as const;
    });
    const winner = averages[0]![1] >= averages[1]![1] ? averages[0]![0] : averages[1]![0];
    if (winner === sample.arm) correct++;
  }
  return correct / relevant.length;
}

test('G2 sealed attempt-018 first 32 R1 events physically separate all seven target/contrast arms', async () => {
  const samples = await projectAttemptPrefix(32);
  for (const [target, contrast] of ATTEMPT_PAIRS) {
    const a = samples.find(value => value.arm === target)?.episode;
    const b = samples.find(value => value.arm === contrast)?.episode;
    assert(a && b, `missing attempt-018 scorer pair:${target}:${contrast}`);
    assert.notEqual(a.patternSha256, b.patternSha256, `attempt-018 collapsed:${target}:${contrast}`);
    assert(terminalOverlap(a, b) < 1,
      `attempt-018 terminal populations fully collapsed:${target}:${contrast}`);
  }
});

test('G2 sealed attempt-018 64/128 prefixes classify target versus contrast across public layouts', async () => {
  for (const prefix of [64, 128] as const) {
    const samples = await projectAttemptPrefix(prefix);
    const outcomes = ATTEMPT_PAIRS.flatMap(([target, contrast]) =>
      samples.filter(value => value.arm === target || value.arm === contrast).map(value => ({
        passed: binaryLeaveOneOutAccuracy(samples, target, contrast) >= .95,
      })));
    assert.equal(outcomes.filter(value => value.passed).length / outcomes.length, 1,
      `attempt-018 cross-layout discrimination failed at ${prefix}`);
  }
});
