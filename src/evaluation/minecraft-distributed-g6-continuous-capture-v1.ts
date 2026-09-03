import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Action, Observation, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import type { ActionObservationScopeV1 } from '../control/contracts.js';
import { DistributedHierarchicalPhysicalMemoryV1,
  DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  type DistributedMemoryObservationReceiptV1,
  type KairosV5DistributedPhysicalMemoryV3 } from '../distributed-hierarchical-memory.js';
import { realEventHierarchyContinuityV1, relativePublicFeatures, validateEvent }
  from '../events.js';
import { assertNewExperienceOutput, createDistributedG6ProvenanceV1,
  DISTRIBUTED_G6_CONTINUOUS_CAPTURE_PRODUCER_IDENTITY_V1,
  restoreExperience, saveExperienceBundleV1 } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import { prepareGuidedNoteFixtureLiveV1, type GuidedMinecraftLayoutV1 }
  from './minecraft-note-fixture-v1.js';

export const MINECRAFT_DISTRIBUTED_G6_CONTINUOUS_CAPTURE_V1 =
  'MinecraftDistributedG6ContinuousCaptureV1' as const;

export type DistributedG6CaptureArmV1 = 'look-plus-effect' | 'look-plus-no-effect'
  | 'look-minus-effect' | 'look-minus-no-effect';

export interface DistributedG6CaptureEpisodePlanV1 {
  readonly episodeOrdinal: number;
  readonly layoutOrdinal: number;
  readonly layout: GuidedMinecraftLayoutV1;
  readonly arm: DistributedG6CaptureArmV1;
  readonly turnDegrees: -15 | 15;
  readonly initialYawOffsetDegrees: -15 | 15;
  /** Publicly observable factor. It is fixture setup, never a result label. */
  readonly publicGameMode: 'survival' | 'spectator';
  readonly actions: readonly [Action, Action, Action, Action];
  readonly resetBeforeEpisode: true;
  readonly explicitContinuityInsideEpisode: true;
}

export interface DistributedG6ContinuousCapturePlanV1 {
  readonly version: 'DistributedG6ContinuousCapturePlanV1';
  readonly seed: number;
  readonly layouts: readonly GuidedMinecraftLayoutV1[];
  readonly episodes: readonly DistributedG6CaptureEpisodePlanV1[];
  readonly requiredBaselineR1Atoms: 256;
  readonly appendedR1Atoms: 128;
  readonly appendedR2Events: 32;
  readonly expectedFinalR1Atoms: 384;
  readonly expectedFinalR2Events: 32;
  readonly eventsPerEpisode: 4;
  readonly scoringLabelsWrittenToMedium: 0;
}

export interface DistributedG6CapturePlanAuditV1 {
  readonly version: 'DistributedG6CapturePlanAuditV1';
  readonly passed: boolean;
  readonly layoutCount: number;
  readonly episodeCount: number;
  readonly atomCount: number;
  readonly armsPerLayout: Readonly<Record<string, number>>;
  readonly malformedEpisodeCount: number;
  readonly heldoutLayoutOverlapCount: number;
  readonly blockers: readonly string[];
}

export interface DistributedG6PublicPairAuditV1 {
  readonly version: 'DistributedG6PublicPairAuditV1';
  readonly pairId: string;
  readonly layoutOrdinal: number;
  readonly turnDegrees: -15 | 15;
  readonly baselineEventId: string;
  readonly interventionEventId: string;
  readonly changedPublicChannels: readonly string[];
  readonly permittedManipulatedChannels: readonly string[];
  /** Every corresponding public observation up to, but not including, the first outcome. */
  readonly preResultPoints: readonly DistributedG6PublicPairPointAuditV1[];
  readonly structuralMismatchReasons: readonly string[];
  readonly excludedPostResultFrameCount: number;
  readonly otherPublicChannelsMatched: boolean;
}

export interface DistributedG6PublicPairPointAuditV1 {
  readonly pointId: string;
  readonly baselineSequence: number;
  readonly interventionSequence: number;
  readonly changedPublicChannels: readonly string[];
  readonly permittedManipulatedChannels: readonly string[];
  readonly otherPublicChannelsMatched: boolean;
}

export interface DistributedG6CapturedEpisodeV1 {
  readonly episodeOrdinal: number;
  readonly layoutOrdinal: number;
  readonly arm: DistributedG6CaptureArmV1;
  readonly eventIds: readonly [string, string, string, string];
  readonly r2EventId: string;
  readonly finalPublicNote: string;
  readonly noteTransitions: readonly string[];
}

export interface DistributedG6ContinuousCaptureAuditV1 {
  readonly version: 'DistributedG6ContinuousCaptureAuditV1';
  readonly passed: boolean;
  readonly baselineR1Atoms: number;
  readonly baselineR2Events: number;
  readonly appendedR1Atoms: number;
  readonly appendedR2Events: number;
  readonly finalR1Atoms: number;
  readonly finalR2Events: number;
  readonly fourAtomCompleteR2Events: number;
  readonly layoutCount: number;
  readonly armCounts: Readonly<Record<DistributedG6CaptureArmV1, number>>;
  readonly explicitResetFirstAtoms: number;
  readonly explicitContinuousLaterAtoms: number;
  readonly publiclyResolvedClosures: number;
  readonly pairAudits: readonly DistributedG6PublicPairAuditV1[];
  readonly otherPublicPairMismatchCount: number;
  readonly interventionAssessmentCount: number;
  readonly scoringLabelsWrittenToMedium: 0;
  readonly sourceBaselineUnchanged: boolean;
  readonly blockers: readonly string[];
}

export interface MinecraftDistributedG6ContinuousCaptureResultV1 {
  readonly version: typeof MINECRAFT_DISTRIBUTED_G6_CONTINUOUS_CAPTURE_V1;
  readonly passed: boolean;
  readonly planIdentitySha256: string;
  readonly sourcePointerSha256: string;
  readonly sourceSnapshotSha256: string;
  readonly outputPointerPath: string | null;
  readonly outputSnapshotSha256: string | null;
  readonly eventsPath: string;
  readonly eventsSha256: string;
  readonly capturedEpisodes: readonly DistributedG6CapturedEpisodeV1[];
  readonly audit: DistributedG6ContinuousCaptureAuditV1;
}

const SEED = 0x47364331;
const SIDES = ['south', 'east', 'north', 'west'] as const;
const ARMS = ['look-plus-effect', 'look-plus-no-effect',
  'look-minus-effect', 'look-minus-no-effect'] as const;

function captureLayoutsV1(): readonly GuidedMinecraftLayoutV1[] {
  return Object.freeze(Array.from({ length: 8 }, (_unused, index): GuidedMinecraftLayoutV1 => ({
    id: `distributed-g6-capture-layout-${String(index + 1).padStart(2, '0')}`,
    originX: 560 + (index % 4) * 24,
    originZ: 560 + Math.floor(index / 4) * 24,
    side: SIDES[index % SIDES.length]!, markerVariant: (index % 4) as 0 | 1 | 2 | 3,
  })));
}

function episodeActions(turnDegrees: -15 | 15): readonly [Action, Action, Action, Action] {
  return Object.freeze([
    Object.freeze({ kind: 'look', parameters: Object.freeze({ yawDegrees: turnDegrees, pitchDegrees: 0 }) }),
    Object.freeze({ kind: 'interact', parameters: Object.freeze({}) }),
    Object.freeze({ kind: 'interact', parameters: Object.freeze({}) }),
    Object.freeze({ kind: 'observe', parameters: Object.freeze({ ticks: 5 }) }),
  ]) as readonly [Action, Action, Action, Action];
}

/** Preregistered guided collection only. No heldout action sequence consumes this plan. */
export function minecraftDistributedG6ContinuousCapturePlanV1():
DistributedG6ContinuousCapturePlanV1 {
  const layouts = captureLayoutsV1();
  const episodes: DistributedG6CaptureEpisodePlanV1[] = [];
  for (let layoutOrdinal = 0; layoutOrdinal < layouts.length; layoutOrdinal++) {
    // Deterministic Latin rotation prevents arm kind from being identical to global time order.
    for (let offset = 0; offset < ARMS.length; offset++) {
      const arm = ARMS[(offset + layoutOrdinal) % ARMS.length]!;
      const turnDegrees: -15 | 15 = arm.startsWith('look-plus') ? 15 : -15;
      episodes.push(Object.freeze({ episodeOrdinal: episodes.length, layoutOrdinal,
        layout: layouts[layoutOrdinal]!, arm, turnDegrees,
        initialYawOffsetDegrees: (turnDegrees === 15 ? -15 : 15),
        publicGameMode: arm.endsWith('effect') && !arm.endsWith('no-effect')
          ? 'survival' : 'spectator',
        actions: episodeActions(turnDegrees), resetBeforeEpisode: true,
        explicitContinuityInsideEpisode: true }));
    }
  }
  return Object.freeze({ version: 'DistributedG6ContinuousCapturePlanV1', seed: SEED,
    layouts, episodes: Object.freeze(episodes), requiredBaselineR1Atoms: 256,
    appendedR1Atoms: 128, appendedR2Events: 32, expectedFinalR1Atoms: 384,
    expectedFinalR2Events: 32, eventsPerEpisode: 4, scoringLabelsWrittenToMedium: 0 });
}

export function auditMinecraftDistributedG6ContinuousCapturePlanV1(
  plan = minecraftDistributedG6ContinuousCapturePlanV1(),
): DistributedG6CapturePlanAuditV1 {
  const blockers: string[] = [];
  const layouts = new Set(plan.layouts.map(value => value.id));
  const heldoutCoordinates = new Set([
    '420,420', '444,420', '420,444', '444,444',
  ]);
  const heldoutLayoutOverlapCount = plan.layouts.filter(value =>
    heldoutCoordinates.has(`${value.originX},${value.originZ}`)).length;
  const armsPerLayout: Record<string, number> = {};
  let malformedEpisodeCount = 0;
  for (const episode of plan.episodes) {
    const armSet = new Set(plan.episodes.filter(value => value.layoutOrdinal === episode.layoutOrdinal)
      .map(value => value.arm));
    armsPerLayout[String(episode.layoutOrdinal)] = armSet.size;
    const actions = episode.actions;
    if (!layouts.has(episode.layout.id) || actions.length !== 4
      || actions[0]?.kind !== 'look' || actions[1]?.kind !== 'interact'
      || actions[2]?.kind !== 'interact' || actions[3]?.kind !== 'observe'
      || actions[0]?.parameters.yawDegrees !== episode.turnDegrees
      || episode.initialYawOffsetDegrees !== -episode.turnDegrees
      || !episode.resetBeforeEpisode || !episode.explicitContinuityInsideEpisode)
      malformedEpisodeCount++;
  }
  if (plan.layouts.length !== 8 || layouts.size !== 8) blockers.push('capture-plan-needs-eight-unique-layouts');
  if (plan.episodes.length !== 32) blockers.push('capture-plan-needs-thirty-two-episodes');
  if (malformedEpisodeCount > 0) blockers.push('one-or-more-capture-episodes-malformed');
  if (Object.values(armsPerLayout).some(value => value !== 4))
    blockers.push('each-layout-must-cover-all-four-arms');
  if (heldoutLayoutOverlapCount > 0) blockers.push('capture-layout-overlaps-frozen-heldout');
  return Object.freeze({ version: 'DistributedG6CapturePlanAuditV1', passed: blockers.length === 0,
    layoutCount: layouts.size, episodeCount: plan.episodes.length,
    atomCount: plan.episodes.reduce((sum, value) => sum + value.actions.length, 0),
    armsPerLayout: Object.freeze(armsPerLayout), malformedEpisodeCount,
    heldoutLayoutOverlapCount, blockers: Object.freeze(blockers) });
}

export function retagDistributedG6ContinuousEpisodeV1(events: readonly RealEvent[], sessionId: string):
readonly [RealEvent, RealEvent, RealEvent, RealEvent] {
  assert(events.length === 4, 'distributed-g6-capture-episode-must-have-four-real-events');
  const tagged = events.map((event, index) => {
    validateEvent(event);
    const { hierarchyContinuity: _old, ...publicEvent } = event;
    return Object.freeze({ ...publicEvent, hierarchyContinuity: realEventHierarchyContinuityV1(
      publicEvent, sessionId, index === 0 ? 'reset' : 'continuous') });
  });
  assert(tagged[0]!.hierarchyContinuity?.boundaryBefore === 'reset'
    && tagged.slice(1).every(value => value.hierarchyContinuity?.boundaryBefore === 'continuous'),
  'distributed-g6-capture-continuity-boundaries-invalid');
  assert(tagged[3]!.hierarchyContinuity?.processStatusAfter === 'publicly-resolved',
    'distributed-g6-capture-observe-did-not-publicly-resolve');
  return tagged as unknown as readonly [RealEvent, RealEvent, RealEvent, RealEvent];
}

function resolutionForFeature(key: string): number {
  if (key.includes('velocity.')) return .05;
  if (key.includes('relativeDistance') || key.includes('/egocentric/')) return .25;
  if (key === 'self/pitch') return Math.PI / 12;
  return 1e-6;
}

function comparablePublicFeatures(observation: Observation): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(relativePublicFeatures(observation))) {
    if (key === 'self/gameMode' || key.startsWith('self/gameMode=')) continue;
    const step = resolutionForFeature(key);
    result[key] = Math.round(value / step);
  }
  return result;
}

function changedChannels(left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter(key => !Object.is(left[key], right[key])).sort((a, b) => a.localeCompare(b, 'en'));
}

export function auditDistributedG6PublicPairV1(layoutOrdinal: number, turnDegrees: -15 | 15,
  baseline: readonly [RealEvent, RealEvent, RealEvent, RealEvent],
  intervention: readonly [RealEvent, RealEvent, RealEvent, RealEvent]): DistributedG6PublicPairAuditV1 {
  const structuralMismatchReasons: string[] = [];
  const baselineKinds = baseline.map(value => value.bodyResult?.action.kind ?? value.cue.kind);
  const interventionKinds = intervention.map(value => value.bodyResult?.action.kind ?? value.cue.kind);
  const firstOutcomeActionIndex = baselineKinds.indexOf('interact');
  if (firstOutcomeActionIndex < 1 || interventionKinds[firstOutcomeActionIndex] !== 'interact')
    structuralMismatchReasons.push('first-outcome-action-boundary-not-aligned');
  if (canonical(baselineKinds) !== canonical(interventionKinds))
    structuralMismatchReasons.push('paired-action-kinds-not-aligned');
  const actionSignature = (event: RealEvent): unknown => ({
    kind: event.bodyResult?.action.kind ?? event.cue.kind,
    parameters: event.bodyResult?.action.parameters ?? event.cue.parameters,
  });
  for (let eventIndex = 0; eventIndex <= firstOutcomeActionIndex; eventIndex++) {
    if (canonical(actionSignature(baseline[eventIndex]!))
      !== canonical(actionSignature(intervention[eventIndex]!)))
      structuralMismatchReasons.push(`pre-result-actions-not-aligned:event-${eventIndex}`);
  }
  if (baseline[0].bodyResult?.action.parameters.yawDegrees !== turnDegrees
    || intervention[0].bodyResult?.action.parameters.yawDegrees !== turnDegrees)
    structuralMismatchReasons.push('paired-look-does-not-match-preregistered-turn');
  for (let eventIndex = 0; eventIndex < Math.max(0, firstOutcomeActionIndex); eventIndex++) {
    if (baseline[eventIndex]!.frames.length !== intervention[eventIndex]!.frames.length)
      structuralMismatchReasons.push(`pre-result-frame-count-not-aligned:event-${eventIndex}`);
  }
  const pointPairs: { readonly pointId: string; readonly baseline: Observation;
    readonly intervention: Observation }[] = [];
  if (firstOutcomeActionIndex >= 1) {
    for (let eventIndex = 0; eventIndex < firstOutcomeActionIndex; eventIndex++) {
      const sharedFrames = Math.min(baseline[eventIndex]!.frames.length,
        intervention[eventIndex]!.frames.length);
      for (let frameIndex = 0; frameIndex < sharedFrames; frameIndex++) pointPairs.push({
        pointId: `event-${eventIndex}/frame-${frameIndex}`,
        baseline: baseline[eventIndex]!.frames[frameIndex]!,
        intervention: intervention[eventIndex]!.frames[frameIndex]!,
      });
    }
    // The first frame belongs to the action's public precondition. Its later
    // frames may already contain the manipulated result and are intentionally
    // outside this fixture-matching audit.
    pointPairs.push({ pointId: `event-${firstOutcomeActionIndex}/pre-action-frame`,
      baseline: baseline[firstOutcomeActionIndex]!.frames[0]!,
      intervention: intervention[firstOutcomeActionIndex]!.frames[0]! });
  }
  const preResultPoints: DistributedG6PublicPairPointAuditV1[] = pointPairs.map(point => {
    const otherChanges = changedChannels(comparablePublicFeatures(point.baseline),
      comparablePublicFeatures(point.intervention));
    const allChanges = changedChannels(relativePublicFeatures(point.baseline),
      relativePublicFeatures(point.intervention));
    const manipulated = allChanges.filter(key => key === 'self/gameMode'
      || key.startsWith('self/gameMode='));
    return Object.freeze({ pointId: point.pointId,
      baselineSequence: point.baseline.sequence,
      interventionSequence: point.intervention.sequence,
      changedPublicChannels: Object.freeze(allChanges),
      permittedManipulatedChannels: Object.freeze(manipulated),
      otherPublicChannelsMatched: otherChanges.length === 0 && manipulated.length > 0 });
  });
  const allChanges = [...new Set(preResultPoints.flatMap(value => value.changedPublicChannels))]
    .sort((left, right) => left.localeCompare(right, 'en'));
  const manipulated = [...new Set(preResultPoints.flatMap(value => value.permittedManipulatedChannels))]
    .sort((left, right) => left.localeCompare(right, 'en'));
  const excludedPostResultFrameCount = firstOutcomeActionIndex < 0 ? 0
    : baseline.slice(firstOutcomeActionIndex).reduce((sum, event, relativeIndex) => sum
      + event.frames.length - (relativeIndex === 0 ? 1 : 0), 0)
    + intervention.slice(firstOutcomeActionIndex).reduce((sum, event, relativeIndex) => sum
      + event.frames.length - (relativeIndex === 0 ? 1 : 0), 0);
  return Object.freeze({ version: 'DistributedG6PublicPairAuditV1',
    pairId: sha({ version: 'DistributedG6PublicPairV2', baseline: baseline.map(value => value.id),
      intervention: intervention.map(value => value.id) }), layoutOrdinal, turnDegrees,
    baselineEventId: baseline[0].id, interventionEventId: intervention[0].id,
    changedPublicChannels: Object.freeze(allChanges),
    permittedManipulatedChannels: Object.freeze(manipulated),
    preResultPoints: Object.freeze(preResultPoints),
    structuralMismatchReasons: Object.freeze(structuralMismatchReasons),
    excludedPostResultFrameCount,
    otherPublicChannelsMatched: structuralMismatchReasons.length === 0
      && preResultPoints.length > 0
      && preResultPoints.every(value => value.otherPublicChannelsMatched) });
}

function noteAt(event: RealEvent, position: 'first' | 'last'): string | null {
  const frame = position === 'first' ? event.frames[0]! : event.frames.at(-1)!;
  const target = event.trackedIds.flatMap(id => frame.objects.filter(value => value.id === id
    && value.type === 'note_block'))[0]
    ?? frame.objects.find(value => value.type === 'note_block');
  const value = target?.properties.note;
  return value === undefined || value === null ? null : String(value);
}

function observedNoteTransition(event: RealEvent): string | null {
  const before = noteAt(event, 'first'), after = noteAt(event, 'last');
  return before !== null && after !== null && before !== after ? `${before}->${after}` : null;
}

function expectedEpisodeOutcome(plan: DistributedG6CaptureEpisodePlanV1,
  events: readonly RealEvent[]): { readonly finalPublicNote: string; readonly transitions: readonly string[] } {
  const transitions = events.map(observedNoteTransition).filter((value): value is string => value !== null);
  const finalPublicNote = noteAt(events.at(-1)!, 'last');
  assert(finalPublicNote !== null, 'distributed-g6-capture-final-note-not-public');
  if (plan.publicGameMode === 'survival') {
    assert(canonical(transitions) === canonical(['0->1', '1->2']) && finalPublicNote === '2',
      `distributed-g6-capture-effect-arm-result-mismatch:${plan.episodeOrdinal}`);
  } else assert(transitions.length === 0 && finalPublicNote === '0',
    `distributed-g6-capture-no-effect-arm-result-mismatch:${plan.episodeOrdinal}`);
  return { finalPublicNote, transitions };
}

function countArms(episodes: readonly DistributedG6CapturedEpisodeV1[]):
Record<DistributedG6CaptureArmV1, number> {
  const result: Record<DistributedG6CaptureArmV1, number> = {
    'look-plus-effect': 0, 'look-plus-no-effect': 0,
    'look-minus-effect': 0, 'look-minus-no-effect': 0,
  };
  for (const episode of episodes) result[episode.arm]++;
  return result;
}

export function auditMinecraftDistributedG6ContinuousCaptureV1(
  plan: DistributedG6ContinuousCapturePlanV1,
  baseline: KairosV5DistributedPhysicalMemoryV3,
  finalSnapshot: KairosV5DistributedPhysicalMemoryV3,
  captured: readonly DistributedG6CapturedEpisodeV1[],
  rawEpisodes: readonly { readonly plan: DistributedG6CaptureEpisodePlanV1;
    readonly events: readonly [RealEvent, RealEvent, RealEvent, RealEvent] }[],
  pairAudits: readonly DistributedG6PublicPairAuditV1[], interventionAssessmentCount: number,
  sourceBaselineUnchanged: boolean,
): DistributedG6ContinuousCaptureAuditV1 {
  const blockers: string[] = [];
  const capturedIds = new Set(captured.flatMap(value => value.eventIds));
  const appendedR2 = finalSnapshot.r2.events.filter(event =>
    event.sourceEventIds.some(id => capturedIds.has(id)));
  const completeFour = appendedR2.filter(event => event.completion === 'complete'
    && event.learningEligible && event.physicalFootprint !== null && event.atomIds.length === 4);
  const explicitResetFirstAtoms = rawEpisodes.filter(value =>
    value.events[0].hierarchyContinuity?.boundaryBefore === 'reset').length;
  const explicitContinuousLaterAtoms = rawEpisodes.reduce((sum, value) => sum
    + value.events.slice(1).filter(event => event.hierarchyContinuity?.boundaryBefore === 'continuous').length, 0);
  const publiclyResolvedClosures = rawEpisodes.filter(value =>
    value.events[3].hierarchyContinuity?.processStatusAfter === 'publicly-resolved').length;
  const layoutCount = new Set(captured.map(value => value.layoutOrdinal)).size;
  const armCounts = countArms(captured);
  const labels = [...new Set(plan.episodes.map(value => value.arm))];
  const snapshotText = canonical(finalSnapshot);
  const scoringLabelsWrittenToMedium = labels.filter(label => snapshotText.includes(label)).length;
  const finalR1Atoms = finalSnapshot.seenEventIds.length;
  const finalR2Events = finalSnapshot.r2.events.length;
  if (baseline.seenEventIds.length !== 256 || baseline.r2.events.length !== 0)
    blockers.push('capture-source-must-be-exact-256-R1-zero-R2-baseline');
  if (captured.length !== 32 || capturedIds.size !== 128)
    blockers.push('capture-must-contain-exactly-32-episodes-and-128-new-R1-events');
  if (finalR1Atoms !== 384 || finalR1Atoms - baseline.seenEventIds.length !== 128)
    blockers.push('capture-final-R1-cardinality-is-not-exactly-384');
  if (finalR2Events !== 32 || appendedR2.length !== 32 || completeFour.length !== 32)
    blockers.push('capture-final-R2-cardinality-is-not-exactly-32-complete-four-atom-events');
  if (layoutCount !== 8 || Object.values(armCounts).some(value => value !== 8))
    blockers.push('capture-layout-or-arm-coverage-invalid');
  if (explicitResetFirstAtoms !== 32 || explicitContinuousLaterAtoms !== 96
    || publiclyResolvedClosures !== 32)
    blockers.push('capture-explicit-continuity-contract-invalid');
  for (const episode of captured) {
    const event = appendedR2.filter(value => value.eventId === episode.r2EventId);
    if (event.length !== 1 || canonical(event[0]!.sourceEventIds) !== canonical(episode.eventIds))
      blockers.push(`capture-exact-R2-event-mismatch:${episode.episodeOrdinal}`);
  }
  if (pairAudits.length !== 16 || pairAudits.some(value => !value.otherPublicChannelsMatched
    || value.preResultPoints.length === 0 || value.structuralMismatchReasons.length > 0))
    blockers.push('capture-public-matched-pair-audit-failed');
  if (interventionAssessmentCount !== 16)
    blockers.push('capture-matched-intervention-assessment-count-invalid');
  if (scoringLabelsWrittenToMedium !== 0)
    blockers.push('capture-scoring-label-entered-physical-memory');
  if (!sourceBaselineUnchanged) blockers.push('capture-source-baseline-was-modified');
  return Object.freeze({ version: 'DistributedG6ContinuousCaptureAuditV1', passed: blockers.length === 0,
    baselineR1Atoms: baseline.seenEventIds.length, baselineR2Events: baseline.r2.events.length,
    appendedR1Atoms: finalR1Atoms - baseline.seenEventIds.length,
    appendedR2Events: finalR2Events - baseline.r2.events.length, finalR1Atoms, finalR2Events,
    fourAtomCompleteR2Events: completeFour.length, layoutCount,
    armCounts: Object.freeze(armCounts), explicitResetFirstAtoms,
    explicitContinuousLaterAtoms, publiclyResolvedClosures,
    pairAudits: Object.freeze(pairAudits.map(value => structuredClone(value))),
    otherPublicPairMismatchCount: pairAudits.filter(value => !value.otherPublicChannelsMatched).length,
    interventionAssessmentCount, scoringLabelsWrittenToMedium: 0,
    sourceBaselineUnchanged, blockers: Object.freeze(blockers) });
}

async function waitForUniquePublicNote(body: MinecraftBody, expected: string):
Promise<{ readonly controlId: string; readonly observation: Observation }> {
  for (let ticks = 0; ticks < 80; ticks++) {
    const observation = body.latest();
    const notes = observation.objects.filter(value => value.type === 'note_block'
      && String(value.properties.note) === expected);
    if (notes.length === 1) return { controlId: notes[0]!.id, observation };
    await body.waitTicks(1);
  }
  throw new Error('distributed-g6-capture-unique-public-note-timeout');
}

/**
 * Executes the preregistered guided capture. Fixture commands are complete
 * before each four-atom process; no command or expected result enters memory.
 */
export async function runMinecraftDistributedG6ContinuousCaptureV1(config: Configuration,
  evidenceDirectory: string, sourceExperiencePointerPath: string):
Promise<MinecraftDistributedG6ContinuousCaptureResultV1> {
  const evidence = resolve(evidenceDirectory);
  await mkdir(dirname(evidence), { recursive: true });
  await mkdir(evidence, { recursive: false });
  const eventsPath = resolve(evidence, 'trusted-continuous-events.jsonl');
  const framesPath = resolve(evidence, 'frames.jsonl');
  const eventStream = createWriteStream(eventsPath, { flags: 'wx' });
  const frameStream = createWriteStream(framesPath, { flags: 'wx' });
  let streamsEnded = false;
  const endStreams = async (): Promise<void> => {
    if (streamsEnded) return;
    streamsEnded = true;
    await Promise.all([new Promise<void>(done => eventStream.end(done)),
      new Promise<void>(done => frameStream.end(done))]);
  };
  const record = (kind: string, value: unknown): void => {
    (kind === 'frame' ? frameStream : eventStream).write(canonical({ kind, value }) + '\n');
  };
  const plan = minecraftDistributedG6ContinuousCapturePlanV1();
  const planAudit = auditMinecraftDistributedG6ContinuousCapturePlanV1(plan);
  assert(planAudit.passed, `distributed-g6-capture-plan-invalid:${planAudit.blockers.join(',')}`);
  await saveJson(resolve(evidence, 'CAPTURE_PLAN.json'), plan);
  await saveJson(resolve(evidence, 'CAPTURE_PLAN_AUDIT.json'), planAudit);
  const sourcePointerSha256 = await fileSha(sourceExperiencePointerPath);
  assertNewExperienceOutput(sourceExperiencePointerPath, evidence);
  const sourcePointer = JSON.parse(await readFile(sourceExperiencePointerPath, 'utf8')) as {
    readonly filename: string; readonly sha256: string };
  const sourceSnapshotPath = resolve(dirname(sourceExperiencePointerPath), sourcePointer.filename);
  const sourceSnapshotFileSha256 = await fileSha(sourceSnapshotPath);
  const compute = new Compute();
  const restored = await restoreExperience(compute, sourceExperiencePointerPath);
  assert(restored?.snapshot.version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
    'distributed-g6-capture-requires-compatible-distributed-baseline');
  const baseline = structuredClone(restored.snapshot);
  assert(baseline.seenEventIds.length === 256 && baseline.r2.events.length === 0,
    'distributed-g6-capture-requires-exact-256-R1-zero-R2-baseline');
  const services = new Services(config, resolve(config.runtimeRoot,
    `distributed-g6-continuous-capture-${Date.now()}`), evidence);
  const captured: DistributedG6CapturedEpisodeV1[] = [];
  const rawEpisodes: { plan: DistributedG6CaptureEpisodePlanV1;
    events: [RealEvent, RealEvent, RealEvent, RealEvent] }[] = [];
  const pairAudits: DistributedG6PublicPairAuditV1[] = [];
  const interventionAssessments: unknown[] = [];
  let body: MinecraftBody | null = null;
  let outputPointerPath: string | null = null;
  let finalSnapshot: KairosV5DistributedPhysicalMemoryV3 | null = null;
  try {
    await services.start('empty');
    services.command('gamerule spawnRadius 0'); services.command('gamerule doDaylightCycle false');
    services.command('gamerule doWeatherCycle false'); services.command('gamerule doMobSpawning false');
    services.command('time set noon'); services.command('forceload add 540 540 656 616');
    body = new MinecraftBody({ ...config.minecraft,
      worldId: `distributed-g6-capture-${sha(plan).slice(0, 16)}`,
      sessionId: sha({ version: 'DistributedG6CapturePhysicalSessionV1', plan: sha(plan),
        startedAt: Date.now() }), activeSecondsOffset: baseline.activeSeconds }, record);
    await body.ready();
    for (const episode of plan.episodes) {
      services.command(`gamemode ${episode.publicGameMode} ${body.bot.username}`);
      await body.waitTicks(3);
      const prepared = await prepareGuidedNoteFixtureLiveV1(services, body, episode.layout, 0,
        episode.initialYawOffsetDegrees, { clearRadius: 10 });
      const ready = await waitForUniquePublicNote(body, '0');
      assert(ready.controlId === prepared.controlId,
        'distributed-g6-capture-fixture-public-control-identity-changed');
      const scope: ActionObservationScopeV1 = { version: 'ActionObservationScopeV1',
        referencedPublicObjectIds: [ready.controlId] };
      const actions: readonly Action[] = episode.actions.map(action => action.kind === 'interact'
        ? { ...action, targetId: ready.controlId } : action);
      const closed: RealEvent[] = [];
      for (const action of actions) {
        const execution = await body.execute(action, scope);
        assert(execution.result.executed && execution.event?.complete
          && execution.event.provenance === 'executed-real-body',
        `distributed-g6-capture-real-action-failed:${episode.episodeOrdinal}:${action.kind}`);
        closed.push(execution.event);
      }
      const tagged = retagDistributedG6ContinuousEpisodeV1(closed, body.session.id);
      const outcome = expectedEpisodeOutcome(episode, tagged);
      for (const event of tagged) {
        record('real-event', event);
        const receipt = await compute.call<DistributedMemoryObservationReceiptV1>('observe', event);
        assert(receipt.representationRejection === null,
          `distributed-g6-capture-event-unrepresented:${event.id}`);
      }
      const after = await compute.call<KairosV5DistributedPhysicalMemoryV3>('snapshot');
      const eventIds = tagged.map(value => value.id) as [string, string, string, string];
      const r2 = after.r2.events.filter(value => canonical(value.sourceEventIds) === canonical(eventIds));
      assert(r2.length === 1 && r2[0]!.atomIds.length === 4 && r2[0]!.learningEligible,
        `distributed-g6-capture-exact-R2-event-missing:${episode.episodeOrdinal}`);
      captured.push(Object.freeze({ episodeOrdinal: episode.episodeOrdinal,
        layoutOrdinal: episode.layoutOrdinal, arm: episode.arm,
        eventIds: Object.freeze(eventIds), r2EventId: r2[0]!.eventId,
        finalPublicNote: outcome.finalPublicNote,
        noteTransitions: Object.freeze([...outcome.transitions]) }));
      rawEpisodes.push({ plan: episode, events: tagged as [RealEvent, RealEvent, RealEvent, RealEvent] });
      const layoutEpisodes = rawEpisodes.filter(value => value.plan.layoutOrdinal === episode.layoutOrdinal);
      if (layoutEpisodes.length === 4) for (const turnDegrees of [15, -15] as const) {
        const effect = layoutEpisodes.find(value => value.plan.turnDegrees === turnDegrees
          && value.plan.publicGameMode === 'survival');
        const noEffect = layoutEpisodes.find(value => value.plan.turnDegrees === turnDegrees
          && value.plan.publicGameMode === 'spectator');
        assert(effect && noEffect, 'distributed-g6-capture-matched-pair-missing');
        const pair = auditDistributedG6PublicPairV1(episode.layoutOrdinal, turnDegrees,
          noEffect.events, effect.events);
        pairAudits.push(pair);
        // Stop at the first fixture mismatch instead of spending the remaining
        // real actions on a confounded intervention batch.
        assert(pair.otherPublicChannelsMatched,
          `distributed-g6-capture-public-pair-not-matched:${episode.layoutOrdinal}:${turnDegrees}`);
      }
    }
    for (let layoutOrdinal = 0; layoutOrdinal < 8; layoutOrdinal++) for (const turnDegrees of [15, -15] as const) {
      const effect = rawEpisodes.find(value => value.plan.layoutOrdinal === layoutOrdinal
        && value.plan.turnDegrees === turnDegrees && value.plan.publicGameMode === 'survival');
      const noEffect = rawEpisodes.find(value => value.plan.layoutOrdinal === layoutOrdinal
        && value.plan.turnDegrees === turnDegrees && value.plan.publicGameMode === 'spectator');
      assert(effect && noEffect, 'distributed-g6-capture-matched-pair-missing');
      const baselineR2 = captured.find(value => value.episodeOrdinal === noEffect.plan.episodeOrdinal)!.r2EventId;
      const interventionR2 = captured.find(value => value.episodeOrdinal === effect.plan.episodeOrdinal)!.r2EventId;
      interventionAssessments.push(await compute.call('recordDistributedMatchedIntervention', {
        version: 'DistributedR2AInterventionPairV2', baselineR2EventId: baselineR2,
        interventionR2EventId: interventionR2 }));
    }
    finalSnapshot = await compute.call<KairosV5DistributedPhysicalMemoryV3>('snapshot');
    const sourceBaselineUnchanged = await fileSha(sourceExperiencePointerPath) === sourcePointerSha256
      && await fileSha(sourceSnapshotPath) === sourceSnapshotFileSha256;
    const audit = auditMinecraftDistributedG6ContinuousCaptureV1(plan, baseline, finalSnapshot,
      captured, rawEpisodes, pairAudits, interventionAssessments.length, sourceBaselineUnchanged);
    await saveJson(resolve(evidence, 'CAPTURE_AUDIT.json'), audit);
    await saveJson(resolve(evidence, 'MATCHED_INTERVENTION_ASSESSMENTS.json'), interventionAssessments);
    assert(audit.passed, `distributed-g6-continuous-capture-audit-failed:${audit.blockers.join(',')}`);
    // Close the raw stream before binding its byte hash into the output pointer.
    // The pointer therefore cannot claim provenance for an incomplete event file.
    await endStreams();
    const eventsSha256 = await fileSha(eventsPath);
    const output = resolve(evidence, 'experience'); await mkdir(output, { recursive: false });
    const distributedG6Provenance = createDistributedG6ProvenanceV1({
      version: 'DistributedG6ExperienceProvenanceV1', producer: 'continuous-capture-v1',
      producerIdentitySha256: DISTRIBUTED_G6_CONTINUOUS_CAPTURE_PRODUCER_IDENTITY_V1,
      sourceId: sha({ planIdentitySha256: sha(plan), sourcePointerSha256,
        sourceSnapshotSha256: sourcePointer.sha256 }), sourceEventsSha256: eventsSha256,
    });
    const pointer = await saveExperienceBundleV1(output, finalSnapshot,
      { actions: restored.pointer.actions + 128, eventCount: 384, writes: finalSnapshot.writes,
        distributedG6Provenance },
      new ControlHabitWeightsV1());
    outputPointerPath = resolve(output, 'EXPERIENCE_LATEST.json');
    const result: MinecraftDistributedG6ContinuousCaptureResultV1 = {
      version: MINECRAFT_DISTRIBUTED_G6_CONTINUOUS_CAPTURE_V1, passed: true,
      planIdentitySha256: sha(plan), sourcePointerSha256,
      sourceSnapshotSha256: sourcePointer.sha256, outputPointerPath,
      outputSnapshotSha256: pointer.sha256, eventsPath, eventsSha256,
      capturedEpisodes: Object.freeze(captured), audit };
    await saveJson(resolve(evidence, 'RESULT.json'), result);
    return result;
  } finally {
    await endStreams();
    await body?.close(); await compute.close(); await services.stop();
  }
}

/** Deterministic replay helper for offline tests and later independent audit. */
export function replayDistributedG6ContinuousCaptureV1(baseline: KairosV5DistributedPhysicalMemoryV3,
  episodes: readonly (readonly [RealEvent, RealEvent, RealEvent, RealEvent])[]):
KairosV5DistributedPhysicalMemoryV3 {
  const memory = DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(baseline));
  for (const episode of episodes) for (const event of episode) memory.observe(event);
  return memory.snapshot();
}
