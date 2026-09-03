import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { Action, Observation, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import type { ActionObservationScopeV1, GroundedGoalV1 } from '../control/contracts.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { cueIdentity, eventRows, realEventHierarchyContinuityV1 } from '../events.js';
import type { HierarchicalMemoryObservationReceiptV1,
  HierarchicalMemorySnapshotV1 } from '../hierarchical-memory.js';
import { HIERARCHICAL_MEMORY_VERSION_V1 } from '../hierarchical-memory.js';
import { restoreExperience, saveExperienceBundleV1, V5Runtime } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import { startDashboard } from '../dashboard.js';
import { startLoopbackMineflayerViewerV1 } from '../viewer.mjs';
import { DeterministicTokenFieldEncoder } from '../core/learning/token-field.js';
import type { R2AInterventionEvidenceV1,
  R2AInterventionProtocolV1 } from '../core/learning/r2a-stable-pattern.js';
import type { R2ContinuousEventV1 } from '../core/learning/r2-continuous-event.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import { guidedFixtureGeometryV1, prepareGuidedNoteFixtureLiveV1,
  type GuidedMinecraftLayoutV1 } from './minecraft-guided-affordance.js';

export const MINECRAFT_HIERARCHICAL_SHORT_CHAIN_LIVE_V1 =
  'MinecraftHierarchicalShortChainLiveV1' as const;

type FoundationArmV1 = 'P0-note-0-increment' | 'P1-note-1-increment'
  | 'P2-spectator-no-increment';
type InterventionComparisonV1 = 'increment-vs-no-increment';
type LookArmV1 = 'L0-acquire' | 'L1-miss';
type SingletonModeV1 = 'look-plus-acquire' | 'look-plus-miss' | 'look-minus-acquire' | 'look-minus-miss'
  | 'interact-zero-to-one' | 'observe-two-stable';

export interface HierarchicalSingletonEpisodeLiveV1 {
  readonly episode: number;
  readonly layout: GuidedMinecraftLayoutV1;
  readonly mode: SingletonModeV1;
}

export interface HierarchicalChainEpisodeLiveV1 {
  readonly episode: number;
  readonly phase: 'foundation' | 'intervention';
  readonly arm: FoundationArmV1;
  readonly pairIndex: number;
  readonly comparison: InterventionComparisonV1 | null;
  readonly layout: GuidedMinecraftLayoutV1;
}

export interface HierarchicalLookChainEpisodeLiveV1 {
  readonly episode: number;
  readonly phase: 'foundation' | 'intervention';
  readonly arm: LookArmV1;
  readonly pairIndex: number;
  readonly layout: GuidedMinecraftLayoutV1;
}

export interface HierarchicalShortChainPlanLiveV1 {
  readonly version: 'HierarchicalShortChainPlanLiveV1';
  readonly singletonEpisodes: readonly HierarchicalSingletonEpisodeLiveV1[];
  readonly foundationEpisodes: readonly HierarchicalChainEpisodeLiveV1[];
  readonly lookFoundationEpisodes: readonly HierarchicalLookChainEpisodeLiveV1[];
  readonly interventionEpisodes: readonly HierarchicalChainEpisodeLiveV1[];
  readonly lookInterventionEpisodes: readonly HierarchicalLookChainEpisodeLiveV1[];
  readonly initialR1AtomCount: 128;
  readonly postCalibrationLookR1AtomCount: 60;
  readonly postProtocolR1AtomCount: 48;
  readonly frozenR1AtomCount: 236;
}

const singletonModes: readonly SingletonModeV1[] = Object.freeze([
  'look-plus-acquire', 'look-plus-miss', 'look-minus-acquire', 'look-minus-miss',
  'interact-zero-to-one', 'observe-two-stable',
]);

function layout(id: string, index: number, phaseOffset: number): GuidedMinecraftLayoutV1 {
  const side = (['south', 'east', 'north', 'west'] as const)[index % 4]!;
  return Object.freeze({ id, originX: 180 + phaseOffset + (index % 4) * 12,
    originZ: 180 + Math.floor(index / 4) * 12, side, markerVariant: (index % 4) as 0 | 1 | 2 | 3 });
}

/** The plan is frozen before any observed outcome exists. */
export function minecraftHierarchicalShortChainPlanLiveV1(): HierarchicalShortChainPlanLiveV1 {
  const singletonEpisodes = Array.from({ length: 20 }, (_, episode) => {
    // Foundation chains already cover acquire, interaction and stable
    // observation.  The fourth minus-look miss is deliberately placed in the
    // one public marker context absent from the three cyclic examples, so the
    // frozen map has seen every pre-action public type used by the miss chain.
    const fillMissingMissContext = episode === 18;
    const layoutIndex = fillMissingMissContext ? 1 : Math.floor(episode / 4);
    return { episode,
      layout: layout(`hierarchy-singleton-layout-${fillMissingMissContext ? 'minus-miss-marker-1' : Math.floor(episode / 4)}`,
        layoutIndex, 0),
      mode: fillMissingMissContext ? 'look-minus-miss' : singletonModes[episode % singletonModes.length]!,
    } satisfies HierarchicalSingletonEpisodeLiveV1;
  });
  const foundationArms = ['P0-note-0-increment', 'P1-note-1-increment',
    'P2-spectator-no-increment'] as const;
  const foundationEpisodes = Array.from({ length: 36 }, (_, episode) => ({ episode,
    phase: 'foundation' as const, arm: foundationArms[episode % 3]!,
    pairIndex: Math.floor(episode / 3), comparison: null,
    layout: layout(`hierarchy-foundation-layout-${Math.floor(episode / 3)}`,
      Math.floor(episode / 3), 120),
  } satisfies HierarchicalChainEpisodeLiveV1));
  const interventionEpisodes = Array.from({ length: 8 }, (_, localEpisode) => ({
      episode: localEpisode, phase: 'intervention' as const,
      arm: localEpisode % 2 === 0 ? 'P0-note-0-increment' as const
        : 'P2-spectator-no-increment' as const,
      pairIndex: Math.floor(localEpisode / 2), comparison: 'increment-vs-no-increment' as const,
      layout: layout(`hierarchy-intervention-increment-vs-no-increment-layout-${Math.floor(localEpisode / 2)}`,
        Math.floor(localEpisode / 2), 264),
    } satisfies HierarchicalChainEpisodeLiveV1));
  // The original plan taught only the note-state branch.  These post-map
  // chains expose the same +15 degree look cue in acquire and miss contexts so
  // the public crosshair requirement can earn its own physical R2A relation.
  // No action sequence is injected into heldout evaluation.
  const lookFoundationEpisodes: HierarchicalLookChainEpisodeLiveV1[] = [
    ...Array.from({ length: 12 }, (_, episode) => ({ episode,
      phase: 'foundation' as const, arm: 'L1-miss' as const, pairIndex: episode,
      layout: layout(`hierarchy-look-miss-foundation-${episode}`, episode, 312),
    })),
    ...Array.from({ length: 8 }, (_, localEpisode) => ({ episode: 12 + localEpisode,
      phase: 'foundation' as const,
      arm: localEpisode % 2 === 0 ? 'L0-acquire' as const : 'L1-miss' as const,
      pairIndex: Math.floor(localEpisode / 2),
      layout: layout(`hierarchy-look-foundation-pair-${Math.floor(localEpisode / 2)}`,
        Math.floor(localEpisode / 2), 336),
    })),
  ];
  const lookInterventionEpisodes = Array.from({ length: 8 }, (_, localEpisode) => ({
    episode: localEpisode, phase: 'intervention' as const,
    arm: localEpisode % 2 === 0 ? 'L0-acquire' as const : 'L1-miss' as const,
    pairIndex: Math.floor(localEpisode / 2),
    layout: layout(`hierarchy-look-intervention-pair-${Math.floor(localEpisode / 2)}`,
      Math.floor(localEpisode / 2), 348),
  } satisfies HierarchicalLookChainEpisodeLiveV1));
  return Object.freeze({ version: 'HierarchicalShortChainPlanLiveV1',
    singletonEpisodes: Object.freeze(singletonEpisodes),
    foundationEpisodes: Object.freeze(foundationEpisodes),
    lookFoundationEpisodes: Object.freeze(lookFoundationEpisodes),
    interventionEpisodes: Object.freeze(interventionEpisodes),
    lookInterventionEpisodes: Object.freeze(lookInterventionEpisodes),
    initialR1AtomCount: 128 as const, postCalibrationLookR1AtomCount: 60 as const,
    postProtocolR1AtomCount: 48 as const, frozenR1AtomCount: 236 as const });
}

export const MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1 = Object.freeze(
  Array.from({ length: 4 }, (_, index) => Object.freeze({
    caseId: `hierarchical-note-two-heldout-${index + 1}`,
    layout: layout(`hierarchy-heldout-layout-${index + 1}`, index, 360),
    // Every heldout uses the exact acquire-look direction learned in the
    // three-atom hierarchy; opposite-direction generalization is a later test.
    yawOffsetDegrees: -15,
    actionBudget: 16,
  })),
);

export interface OpaqueInterventionSelectionV1 {
  readonly version: 'OpaqueInterventionSelectionV1';
  readonly targetPatternId: string;
  readonly contrastPatternId: string;
  readonly relationId: string;
  readonly changedFactorIds: readonly string[];
  readonly branchAtomIndex: number;
  readonly targetMemberEventIds: readonly string[];
  readonly contrastMemberEventIds: readonly string[];
  readonly targetArmCoverage: number;
  readonly contrastArmCoverage: number;
  readonly selectionInputs: 'precommitted-arm-membership-and-pre-action-perception-only';
}

/**
 * Select the prospective experiment using only its precommitted arm membership,
 * opaque physical IDs and the public perception before the branch action.
 * R1 outcome changes, terminal note values and world positions are not read.
 */
export function selectOpaqueJointInterventionAtBranchV1(snapshot: HierarchicalMemorySnapshotV1,
  armAEventIds: readonly string[], armBEventIds: readonly string[], branchAtomIndex: number,
  exactNextActionIdentity: string): OpaqueInterventionSelectionV1 {
  assert(snapshot.r2a && snapshot.tokenEncoder, 'hierarchical-intervention-selection-requires-R2A');
  const r2a = snapshot.r2a, a = new Set(armAEventIds), b = new Set(armBEventIds);
  assert(a.size === armAEventIds.length && b.size === armBEventIds.length
    && [...a].every(id => !b.has(id)), 'precommitted-foundation-arm-membership-invalid');
  const patternFor = (members: ReadonlySet<string>) => {
    const candidates = r2a.patterns.filter(pattern => pattern.memberEventIds.length === members.size
      && pattern.memberEventIds.every(id => members.has(id)));
    assert(candidates.length === 1,
      `precommitted-arm-requires-one-complete-stable-R2-pattern:${candidates.length}`);
    return candidates[0]!;
  };
  const target = patternFor(a), contrast = patternFor(b);
  assert(target.patternId !== contrast.patternId, 'foundation-arms-did-not-form-distinct-patterns');
  const relations = r2a.relations.filter(relation => relation.targetPatternId === target.patternId
    && relation.contrastPatternIds.includes(contrast.patternId)
    && relation.branchAtomIndex === branchAtomIndex
    && relation.exactNextActionIdentity === exactNextActionIdentity
    && relation.predictiveSinceEventId !== null
    && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(relation.grade));
  assert(relations.length === 1, `foundation-target-relation-not-unique:${relations.length}`);
  const relation = relations[0]!, encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
  const evidenceById = new Map(r2a.evidence.map(value => [value.eventId, value]));
  const standardized = (ids: readonly string[], tokenIndex: number): readonly number[] => ids.map(eventId => {
    const evidence = evidenceById.get(eventId);
    assert(evidence && evidence.atomPrePerceptions[branchAtomIndex],
      `foundation-branch-perception-missing:${eventId}`);
    return encoder.encode(`${eventId}:atom:${branchAtomIndex}`,
      new Float64Array(evidence.atomPrePerceptions[branchAtomIndex]!)).tokens[tokenIndex]!.standardizedValue;
  });
  const changedFactorIds = relation.factorIds.filter(factorId => {
    const factor = r2a.factors.find(value => value.factorId === factorId);
    assert(factor, `relation-factor-node-missing:${factorId}`);
    const left = standardized(target.memberEventIds, factor.tokenIndex);
    const right = standardized(contrast.memberEventIds, factor.tokenIndex);
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
    return spread(left) <= factor.tolerance && spread(right) <= factor.tolerance
      && Math.abs(mean(left) - mean(right)) > factor.tolerance;
  }).sort((left, right) => left.localeCompare(right, 'en'));
  assert(changedFactorIds.length >= 1, `categorical-joint-factor-set-not-recovered:${changedFactorIds.length}`);
  return Object.freeze({ version: 'OpaqueInterventionSelectionV1', targetPatternId: target.patternId,
    contrastPatternId: contrast.patternId, relationId: relation.relationId,
    changedFactorIds: Object.freeze(changedFactorIds), branchAtomIndex,
    targetMemberEventIds: Object.freeze([...target.memberEventIds]),
    contrastMemberEventIds: Object.freeze([...contrast.memberEventIds]),
    targetArmCoverage: target.memberEventIds.length / armAEventIds.length,
    contrastArmCoverage: contrast.memberEventIds.length / armBEventIds.length,
    selectionInputs: 'precommitted-arm-membership-and-pre-action-perception-only' as const });
}

export function selectOpaqueJointInterventionV1(snapshot: HierarchicalMemorySnapshotV1,
  armAEventIds: readonly string[], armBEventIds: readonly string[]): OpaqueInterventionSelectionV1 {
  return selectOpaqueJointInterventionAtBranchV1(snapshot, armAEventIds, armBEventIds, 1,
    cueIdentity({ kind: 'interact', parameters: {}, targetRole: 'note_block' }));
}

function scopeFor(controlId: string): ActionObservationScopeV1 {
  return { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [controlId] };
}

function retagRealContinuity(event: RealEvent, sessionId: string,
  boundaryBefore: 'continuous' | 'reset'): RealEvent {
  const publicEvent: RealEvent = { ...event, hierarchyContinuity: undefined };
  return { ...publicEvent,
    hierarchyContinuity: realEventHierarchyContinuityV1(publicEvent, sessionId, boundaryBefore) };
}

async function executeAndLearnAtom(compute: Compute, body: MinecraftBody, action: Action,
  scope: ActionObservationScopeV1, boundaryBefore: 'continuous' | 'reset') {
  const execution = await body.execute(action, scope);
  assert(execution.result.executed && execution.event,
    `hierarchical-guided-real-action-failed:${action.kind}:${execution.result.status}`);
  const event = retagRealContinuity(execution.event, body.session.id, boundaryBefore);
  const receipt = await compute.call<HierarchicalMemoryObservationReceiptV1>('observe', event);
  assert(receipt.representationRejection === null,
    `hierarchical-real-event-unrepresented:${event.id}:${canonical(receipt.representationRejection)}`);
  return { event, receipt };
}

function noteValue(observation: Observation, controlId: string): string | null {
  const value = observation.objects.find(object => object.id === controlId)?.properties.note;
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
}

async function executeSingleton(compute: Compute, services: Services, body: MinecraftBody,
  episode: HierarchicalSingletonEpisodeLiveV1) {
  const note = episode.mode === 'observe-two-stable' ? 2 : 0;
  const yaw = episode.mode === 'look-plus-acquire' ? -15
    : episode.mode === 'look-plus-miss' || episode.mode === 'look-minus-acquire' ? 15
      : episode.mode === 'look-minus-miss' ? 30 : 0;
  const fixture = await prepareGuidedNoteFixtureLiveV1(services, body, episode.layout, note, yaw,
    { clearRadius: 12 });
  const action: Action = episode.mode === 'look-plus-acquire' || episode.mode === 'look-plus-miss'
    ? { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } }
    : episode.mode === 'look-minus-acquire' || episode.mode === 'look-minus-miss'
      ? { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } }
      : episode.mode === 'interact-zero-to-one'
        ? { kind: 'interact', parameters: {}, targetId: fixture.controlId }
        : { kind: 'observe', parameters: { ticks: 5 } };
  const learned = await executeAndLearnAtom(compute, body, action, scopeFor(fixture.controlId), 'reset');
  if (episode.mode === 'look-plus-acquire' || episode.mode === 'look-minus-acquire')
    assert(body.latest().targetId === fixture.controlId,
      `singleton-look-did-not-acquire-control:${episode.mode}`);
  if (episode.mode === 'look-plus-miss' || episode.mode === 'look-minus-miss')
    assert(body.latest().targetId !== fixture.controlId, 'singleton-look-miss-acquired-control');
  if (episode.mode === 'interact-zero-to-one')
    assert(noteValue(body.latest(), fixture.controlId) === '1', 'singleton-real-zero-to-one-not-observed');
  return { ...learned, fixture, action };
}

export interface ExpectedFoundationChainLiveV1 {
  readonly episode: number;
  readonly arm: FoundationArmV1;
  readonly sourceEventIds: readonly [string, string, string];
  readonly orderedExperienceIdentities: readonly [string, string, string];
}

function exactCompleteThreeAtomR2LiveV1(snapshot: HierarchicalMemorySnapshotV1,
  expected: Pick<ExpectedFoundationChainLiveV1, 'episode' | 'sourceEventIds'
    | 'orderedExperienceIdentities'>): R2ContinuousEventV1 {
  const matches = snapshot.r2Store.events.filter(value => value.sourceEventIds.length === 3
    && value.sourceEventIds.every((id, index) => id === expected.sourceEventIds[index]));
  assert(matches.length === 1, `hierarchical-chain-R2-exact-source-match-count:${expected.episode}:${matches.length}`);
  const event = matches[0]!;
  assert(event.completion === 'complete' && event.learningEligible
    && event.boundaryReason === 'public-process-resolved',
  `hierarchical-chain-R2-completion-invalid:${expected.episode}:${event.completion}:${event.boundaryReason}`);
  assert(event.orderedExperienceIdentities.length === 3
    && event.orderedExperienceIdentities.every((identity, index) =>
      identity === expected.orderedExperienceIdentities[index]),
  `hierarchical-chain-R2-action-order-invalid:${expected.episode}`);
  return event;
}

/** Validate the 36 real chains only after atom 128 has calibrated and replayed the hierarchy. */
export function verifyInitializedFoundationR2LiveV1(snapshot: HierarchicalMemorySnapshotV1,
  expected: readonly ExpectedFoundationChainLiveV1[], singletonEventIds: ReadonlySet<string>):
  readonly { readonly expected: ExpectedFoundationChainLiveV1; readonly event: R2ContinuousEventV1 }[] {
  assert(snapshot.annotations.length === 128 && snapshot.writes === 128,
    'foundation-R2-verification-requires-complete-128-atom-initialization');
  assert(expected.length === 36, `foundation-R2-verification-requires-36-chains:${expected.length}`);
  const eligible = snapshot.r2Store.events.filter(value => value.learningEligible);
  assert(eligible.length === 36, `foundation-R2-unexpected-learning-event-count:${eligible.length}`);
  const resolved = expected.map(value => ({ expected: value,
    event: exactCompleteThreeAtomR2LiveV1(snapshot, value) }));
  assert(new Set(resolved.map(value => value.event.eventId)).size === 36,
    'foundation-R2-event-reused-across-chains');
  assert(resolved.every(value => value.event.sourceEventIds.every(id => !singletonEventIds.has(id))),
    'reset-singleton-was-mixed-into-foundation-R2');
  assert(eligible.every(event => resolved.some(value => value.event.eventId === event.eventId)),
    'foundation-R2-has-unexpected-extra-learning-event');
  return Object.freeze(resolved);
}

async function executeChain(compute: Compute, services: Services, body: MinecraftBody,
  episode: HierarchicalChainEpisodeLiveV1, verifyR2Immediately: boolean) {
  const isNoIncrementContrast = episode.arm === 'P2-spectator-no-increment';
  const initialNote = episode.arm === 'P1-note-1-increment' ? 1 : 0;
  // Fixture setup must always start from an ordinary public body state.  A
  // prior contrast episode legitimately leaves the bot in spectator mode.
  services.command(`gamemode survival ${body.bot.username}`); await body.waitTicks(3);
  const fixture = await prepareGuidedNoteFixtureLiveV1(services, body, episode.layout, initialNote, -15,
    { clearRadius: 12 });
  services.command(`gamemode ${isNoIncrementContrast ? 'spectator' : 'survival'} ${body.bot.username}`);
  await body.waitTicks(3);
  const atomResults = [];
  atomResults.push(await executeAndLearnAtom(compute, body,
    { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
    scopeFor(fixture.controlId), 'reset'));
  const current = body.latest();
  assert(current.targetId === fixture.controlId, 'hierarchical-chain-look-did-not-acquire-control');
  // A spectator interaction is a real packet which the Minecraft server
  // ignores.  It gives a same-action, no-effect branch whose distinguishing
  // condition is public game mode, instead of changing the target type or
  // fabricating a result in the fixture script.
  assert(body.latest().self.properties.gameMode
    === (isNoIncrementContrast ? 'spectator' : 'survival'),
  'hierarchical-no-increment-public-condition-not-established');
  atomResults.push(await executeAndLearnAtom(compute, body,
    { kind: 'interact', parameters: {}, targetId: fixture.controlId },
    scopeFor(fixture.controlId), 'continuous'));
  atomResults.push(await executeAndLearnAtom(compute, body,
    { kind: 'observe', parameters: { ticks: 5 } }, scopeFor(fixture.controlId), 'continuous'));
  const expected = isNoIncrementContrast ? String(initialNote) : String(initialNote + 1);
  assert(noteValue(body.latest(), fixture.controlId) === expected,
    `hierarchical-chain-real-terminal-state-mismatch:${episode.arm}`);
  const sourceEventIds = atomResults.map(value => value.event.id) as [string, string, string];
  const orderedExperienceIdentities = atomResults.map(value => cueIdentity(value.event.cue)) as [string, string, string];
  const expectation: ExpectedFoundationChainLiveV1 = { episode: episode.episode, arm: episode.arm,
    sourceEventIds, orderedExperienceIdentities };
  const r2Event = verifyR2Immediately
    ? exactCompleteThreeAtomR2LiveV1(await compute.call<HierarchicalMemorySnapshotV1>('snapshot'), expectation)
    : null;
  return { fixture, atomResults, sourceEventIds, orderedExperienceIdentities, r2Event,
    terminalPublicNote: expected };
}

async function executeLookChain(compute: Compute, services: Services, body: MinecraftBody,
  episode: HierarchicalLookChainEpisodeLiveV1) {
  const initialYaw = episode.arm === 'L0-acquire' ? -15 : 15;
  services.command(`gamemode survival ${body.bot.username}`); await body.waitTicks(3);
  // Matched intervention pairs must differ only in the precommitted
  // acquire/miss manipulation. Neutral markers vary the foundation contexts,
  // but rotating the observer also rotates their egocentric coordinates. They
  // are therefore absent from the intervention pair rather than being
  // misreported as held-constant nuisance context.
  const fixture = await prepareGuidedNoteFixtureLiveV1(services, body, episode.layout, 0, initialYaw,
    { neutralMarkers: episode.phase === 'intervention' ? 'absent' : 'visible', clearRadius: 12 });
  const atomResults = [];
  atomResults.push(await executeAndLearnAtom(compute, body,
    { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
    scopeFor(fixture.controlId), 'reset'));
  const acquired = body.latest().targetId === fixture.controlId;
  assert(acquired === (episode.arm === 'L0-acquire'),
    `hierarchical-look-chain-public-target-state-invalid:${episode.arm}:${acquired}`);
  if (episode.arm === 'L0-acquire') {
    atomResults.push(await executeAndLearnAtom(compute, body,
      { kind: 'interact', parameters: {}, targetId: fixture.controlId },
      scopeFor(fixture.controlId), 'continuous'));
    atomResults.push(await executeAndLearnAtom(compute, body,
      { kind: 'observe', parameters: { ticks: 5 } }, scopeFor(fixture.controlId), 'continuous'));
    assert(noteValue(body.latest(), fixture.controlId) === '1',
      'hierarchical-look-acquire-chain-did-not-produce-public-note-change');
  } else {
    atomResults.push(await executeAndLearnAtom(compute, body,
      { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } },
      scopeFor(fixture.controlId), 'continuous'));
    assert(body.latest().targetId !== fixture.controlId,
      'hierarchical-look-miss-correction-unexpectedly-acquired-control');
    atomResults.push(await executeAndLearnAtom(compute, body,
      { kind: 'observe', parameters: { ticks: 5 } }, scopeFor(fixture.controlId), 'continuous'));
    assert(noteValue(body.latest(), fixture.controlId) === '0',
      'hierarchical-look-miss-chain-changed-public-note');
  }
  const sourceEventIds = atomResults.map(value => value.event.id) as [string, string, string];
  const orderedExperienceIdentities = atomResults.map(value => cueIdentity(value.event.cue)) as
    [string, string, string];
  const r2Event = exactCompleteThreeAtomR2LiveV1(
    await compute.call<HierarchicalMemorySnapshotV1>('snapshot'),
    { episode: episode.episode, sourceEventIds, orderedExperienceIdentities });
  return { fixture, atomResults, sourceEventIds, orderedExperienceIdentities, r2Event,
    acquired, terminalPublicNote: noteValue(body.latest(), fixture.controlId) };
}

function noteTwoGoal(caseId: string, controlId: string): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id: `hierarchical-note-two:${caseId}`, expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'public-note-is-two',
      subject: { kind: 'public-object', id: controlId, expectedType: 'note_block' },
      observable: 'properties.note', comparator: 'equals', target: '2' } } };
}

async function waitForUniqueNote(body: MinecraftBody, expected: string, ticks: number) {
  let first: number | null = null, id: string | null = null;
  for (let count = 0; count < 200; count++) {
    const observation = body.latest(), notes = observation.objects.filter(value => value.type === 'note_block');
    if (notes.length === 1 && String(notes[0]!.properties.note) === expected
      && (id === null || id === notes[0]!.id)) {
      first ??= observation.sequence; id ??= notes[0]!.id;
      if (observation.sequence - first >= ticks) return { controlId: id, firstSequence: first,
        confirmationSequence: observation.sequence };
    } else { first = null; id = null; }
    await body.waitTicks(1);
  }
  throw new Error('hierarchical-heldout-unique-note-readiness-timeout');
}

export interface MinecraftHierarchicalShortChainLiveResultV1 {
  readonly version: typeof MINECRAFT_HIERARCHICAL_SHORT_CHAIN_LIVE_V1;
  readonly passed: boolean;
  readonly planSha256: string;
  readonly initialization: { readonly r1Atoms: number; readonly r2Events: number;
    readonly p0Events: number; readonly p1Events: number; readonly p2Events: number;
    readonly lookFoundationR2Events: number; readonly frozenR1Atoms: number };
  readonly intervention: { readonly selections: Readonly<Record<InterventionComparisonV1,
    OpaqueInterventionSelectionV1>>; readonly protocols: Readonly<Record<InterventionComparisonV1,
    R2AInterventionProtocolV1>>; readonly pairs: number;
    readonly lookSelection: OpaqueInterventionSelectionV1;
    readonly lookProtocol: R2AInterventionProtocolV1; readonly lookPairs: number;
    readonly frozenSnapshotSha256: string };
  readonly heldout: readonly { readonly caseId: string; readonly status: string;
    readonly actions: number; readonly verified: boolean; readonly baselineHashUnchanged: boolean;
    readonly frozenPhysicalEvidenceActions: number; readonly frozenPhysicalEvidencePassed: boolean }[];
}

export interface FrozenPhysicalActionEvidenceAuditLiveV1 {
  readonly version: 'FrozenPhysicalActionEvidenceAuditLiveV1';
  readonly passed: boolean;
  readonly actions: readonly { readonly actionKind: string; readonly nodeId: string;
    readonly candidateIds: readonly string[]; readonly fullyFrozenCandidateCount: number;
    readonly reasons: readonly string[] }[];
}

/**
 * Post-hoc only: prove that every successful non-observation body action was
 * selected from R1+R2+production-R2A evidence already present in the frozen
 * baseline.  It neither selects nor vetoes actions during the run.
 */
export function auditFrozenPhysicalActionEvidenceLiveV1(
  records: readonly { readonly kind: string; readonly value: unknown }[],
  frozen: HierarchicalMemorySnapshotV1,
): FrozenPhysicalActionEvidenceAuditLiveV1 {
  let latestDecision: Record<string, unknown> | null = null;
  const actions: FrozenPhysicalActionEvidenceAuditLiveV1['actions'][number][] = [];
  const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
    ? value as Record<string, unknown> : null;
  const annotations = new Map(frozen.annotations.map(value => [value.eventId, value]));
  const relations = new Map((frozen.r2a?.relations ?? []).map(value => [value.relationId, value]));
  for (const record of records) {
    if (record.kind === 'joint-control-decision') { latestDecision = object(record.value); continue; }
    if (record.kind !== 'control-action-result') continue;
    const value = object(record.value), offer = object(value?.offer), action = object(offer?.action);
    const result = object(value?.result), actionKind = String(action?.kind ?? 'unknown');
    if (result?.executed !== true || actionKind === 'observe' || actionKind === 'wait') continue;
    const decision = object(latestDecision?.lastDecision), workspace = object(latestDecision?.workspace);
    const nodeId = typeof decision?.nodeId === 'string' ? decision.nodeId : '';
    const nodes = Array.isArray(workspace?.nodes) ? workspace.nodes : [];
    const wrapper = nodes.map(object).find(item => object(item?.node)?.nodeId === nodeId);
    const node = object(wrapper?.node), reasons: string[] = [];
    if (decision?.operation !== 'execute') reasons.push('preceding-joint-site-was-not-execute');
    if (!node) reasons.push('selected-workspace-node-missing');
    if (node?.kind === 'exploration') reasons.push('non-observation-action-came-from-exploration');
    const workspaceEpoch = Number(workspace?.epoch), workspaceSequence = Number(workspace?.observationSequence);
    const offerSequence = Number(offer?.observationSequence);
    const conditionEnvelope = object(wrapper?.condition), predictionEnvelope = object(wrapper?.prediction);
    const conditionValue = object(conditionEnvelope?.value), predictionValue = object(predictionEnvelope?.value);
    const freshCondition = conditionEnvelope?.fresh === true && conditionEnvelope.epoch === workspaceEpoch
      && conditionEnvelope.observationSequence === workspaceSequence;
    const freshPrediction = predictionEnvelope?.fresh === true && predictionEnvelope.epoch === workspaceEpoch
      && predictionEnvelope.observationSequence === workspaceSequence;
    if (!Number.isSafeInteger(workspaceSequence) || offerSequence !== workspaceSequence)
      reasons.push('execute-offer-not-bound-to-decision-observation');
    if (!freshCondition) reasons.push('missing-fresh-R3-condition-at-execution');
    if (!freshPrediction) reasons.push('missing-fresh-PredictionClone-at-execution');
    const members = node?.kind === 'experienced'
      ? (Array.isArray(node.candidateMembers) ? node.candidateMembers : [node.candidate])
      : node?.kind === 'factor-transition'
        ? (Array.isArray(node.transitionMembers) ? node.transitionMembers : [node.transition]) : [];
    const offerCue = object(offer?.cue);
    const matching = members.map(object).filter((member): member is Record<string, unknown> => {
      const actionCue = object(member?.actionCue);
      return Boolean(actionCue && offerCue
        && cueIdentity(actionCue as never) === cueIdentity(offerCue as never));
    });
    if (matching.length === 0) reasons.push('selected-node-has-no-exact-offer-cue-member');
    let fullyFrozenCandidateCount = 0;
    const candidateIds: string[] = [];
    for (const member of matching) {
      const candidateId = String(member.candidateId ?? member.transitionId ?? 'unknown');
      candidateIds.push(candidateId);
      const memberCondition = Array.isArray(conditionValue?.memberResults)
        ? object(conditionValue.memberResults.map(object).find(value => value?.candidateId === candidateId)?.value)
        : matching.length === 1 ? conditionValue : null;
      const memberPrediction = Array.isArray(predictionValue?.memberResults)
        ? object(predictionValue.memberResults.map(object).find(value => value?.candidateId === candidateId)?.value)
        : matching.length === 1 ? predictionValue : null;
      const evidence = object(memberPrediction?.currentEvidence) ?? object(member.evidence);
      const r1 = object(evidence?.r1), r2 = object(evidence?.r2),
        r2a = object(evidence?.r2a);
      const annotation = typeof evidence?.eventId === 'string' ? annotations.get(evidence.eventId) : undefined;
      const r1Frozen = annotation !== undefined && r1?.active === true && r1.pageId === annotation.pageId
        && r1.traceId === annotation.traceId;
      const r2Frozen = annotation !== undefined && r2?.active === true
        && frozen.r2Store.events.some(event => event.atomIds.includes(annotation.atomId)
          && event.pageId !== null && event.traceId !== null);
      const relationIds = Array.isArray(r2a?.relationIds)
        ? r2a.relationIds.filter((id): id is string => typeof id === 'string') : [];
      const r2aFrozen = r2a?.productionEligible === true && relationIds.some(id => {
        const relation = relations.get(id); return relation?.grade === 'intervention-supported';
      });
      const conditionReady = memberCondition?.productionEligible === true
        && Number(memberCondition.applicability) > 0
        && Array.isArray(memberCondition.unknownFactorIds) && memberCondition.unknownFactorIds.length === 0
        && Array.isArray(memberCondition.contradictedFactorIds) && memberCondition.contradictedFactorIds.length === 0;
      const dependencies = Array.isArray(workspace?.dependencies) ? workspace.dependencies.map(object)
        .filter(edge => edge?.requiredNodeId === nodeId) : [];
      const desiredFactors = [...new Set(dependencies.flatMap(edge => Array.isArray(edge?.factorIds)
        ? edge.factorIds.filter((id): id is string => typeof id === 'string') : []))];
      const nextStates = Array.isArray(memberPrediction?.nextStates) ? memberPrediction.nextStates.map(object) : [];
      const progress = desiredFactors.length === 0 ? Number(memberPrediction?.progressFraction ?? 0)
        : nextStates.length === 0 ? 0 : nextStates.filter(state => {
          const active = Array.isArray(state?.knownActiveFactorIds)
            ? state.knownActiveFactorIds.filter((id): id is string => typeof id === 'string') : [];
          return desiredFactors.some(id => active.includes(id));
        }).length / nextStates.length;
      const predictionReady = Number(memberPrediction?.validSampleCount ?? 0) > 0 && progress > 0;
      if (freshCondition && freshPrediction && conditionReady && predictionReady
        && r1Frozen && r2Frozen && r2aFrozen) fullyFrozenCandidateCount++;
    }
    if (fullyFrozenCandidateCount === 0) reasons.push('no-member-has-frozen-R1-R2-intervention-R2A');
    actions.push({ actionKind, nodeId, candidateIds: Object.freeze(candidateIds),
      fullyFrozenCandidateCount, reasons: Object.freeze(reasons) });
  }
  return Object.freeze({ version: 'FrozenPhysicalActionEvidenceAuditLiveV1',
    passed: actions.length > 0 && actions.every(value => value.reasons.length === 0),
    actions: Object.freeze(actions) });
}

export async function runMinecraftHierarchicalShortChainLiveV1(config: Configuration,
  evidence: string): Promise<MinecraftHierarchicalShortChainLiveResultV1> {
  await mkdir(evidence);
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown): void => {
    (kind === 'frame' ? frames : events).write(canonical({ kind, value }) + '\n');
  };
  const plan = minecraftHierarchicalShortChainPlanLiveV1();
  await saveJson(resolve(evidence, 'RUN_PROTOCOL.json'), plan);
  const services = new Services(config, resolve(config.runtimeRoot,
    `hierarchical-short-chain-live-${Date.now()}`), evidence);
  let trainingBody: MinecraftBody | null = null, trainingCompute: Compute | null = null;
  let trainingViewer: Awaited<ReturnType<typeof startLoopbackMineflayerViewerV1>> | null = null;
  const viewerEndpoints: { phase: string; firstPerson: string | null; dashboard: string | null;
    readOnly: true }[] = [];
  try {
    await services.start('empty');
    services.command('setworldspawn 1000 64 1000'); services.command('gamerule spawnRadius 0');
    services.command('gamerule doDaylightCycle false'); services.command('gamerule doWeatherCycle false');
    services.command('gamerule doMobSpawning false'); services.command('time set noon');
    services.command('forceload add 160 160 600 240');
    trainingBody = new MinecraftBody({ ...config.minecraft,
      worldId: 'hierarchical-short-chain-training-v1', sessionId: 'hierarchical-short-chain-training-v1' }, record);
    await trainingBody.ready(); trainingCompute = new Compute(); await trainingBody.waitTicks(20);
    const emptyHierarchy = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    assert(emptyHierarchy.version === HIERARCHICAL_MEMORY_VERSION_V1
      && emptyHierarchy.writes === 0 && emptyHierarchy.annotations.length === 0
      && emptyHierarchy.r1Store.atoms.length === 0 && emptyHierarchy.r2Store.events.length === 0
      && emptyHierarchy.r2a === null && emptyHierarchy.pendingInitialization.length === 0
      && emptyHierarchy.hierarchyReplayLedger.length === 0
      && emptyHierarchy.hierarchyInterventionLedger.length === 0,
    'hierarchical-short-chain-did-not-start-from-empty-current-memory');
    await saveJson(resolve(evidence, 'EMPTY_HIERARCHY_PREFLIGHT.json'), emptyHierarchy);
    if (config.viewer.enabled) {
      trainingViewer = await startLoopbackMineflayerViewerV1(trainingBody.bot, {
        host: config.viewer.host, port: config.viewer.port, firstPerson: true, viewDistance: 3,
      });
      viewerEndpoints.push({ phase: 'training', firstPerson: trainingViewer.url,
        dashboard: null, readOnly: true });
      record('viewer-endpoint', viewerEndpoints.at(-1));
    }
    const singletonTimeline = [];
    for (const episode of plan.singletonEpisodes) singletonTimeline.push({ episode,
      result: await executeSingleton(trainingCompute, services, trainingBody, episode) });
    const singletonEventIds = new Set(singletonTimeline.map(value => value.result.event.id));
    const foundationEventIds: Record<FoundationArmV1, string[]> = {
      'P0-note-0-increment': [], 'P1-note-1-increment': [],
      'P2-spectator-no-increment': [],
    };
    const foundationTimeline = [];
    for (const episode of plan.foundationEpisodes) {
      // Before atom 128 the hierarchy is intentionally uncalibrated.  Keep
      // only the exact real source IDs; do not demand an early R2 artifact.
      const result = await executeChain(trainingCompute, services, trainingBody, episode, false);
      foundationTimeline.push({ episode, result });
    }
    const initialized = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    await saveJson(resolve(evidence, 'INITIALIZED_HIERARCHY_SNAPSHOT.json'), initialized);
    const resolvedFoundation = verifyInitializedFoundationR2LiveV1(initialized,
      foundationTimeline.map(({ episode, result }) => ({ episode: episode.episode, arm: episode.arm,
        sourceEventIds: result.sourceEventIds, orderedExperienceIdentities: result.orderedExperienceIdentities })),
      singletonEventIds);
    for (const resolved of resolvedFoundation) foundationEventIds[resolved.expected.arm].push(resolved.event.eventId);
    // P0 and P1 are deliberately one physical result mode: both are the
    // same ordered interaction process and both increase the public note by
    // one.  They must not be split by their fixture starting value.  The
    // contrast uses the same exact interact(note_block) action under a real,
    // publicly observable bodily condition that yields another outcome.
    const successFoundationEventIds = [
      ...foundationEventIds['P0-note-0-increment'],
      ...foundationEventIds['P1-note-1-increment'],
    ];
    const selections: Record<InterventionComparisonV1, OpaqueInterventionSelectionV1> = {
      'increment-vs-no-increment': selectOpaqueJointInterventionV1(initialized,
        successFoundationEventIds, foundationEventIds['P2-spectator-no-increment']),
    };
    const protocols: Record<InterventionComparisonV1, R2AInterventionProtocolV1> = {
      'increment-vs-no-increment': await trainingCompute.call<R2AInterventionProtocolV1>(
        'registerMatchedInterventionProtocol', {
          protocolId: 'hierarchical-note-increment-condition-protocol-v1',
          relationId: selections['increment-vs-no-increment'].relationId,
          changedFactorIds: selections['increment-vs-no-increment'].changedFactorIds,
          formationMatchedPairs: foundationEventIds['P0-note-0-increment'].map(
            (targetEventId, index) => ({ targetEventId,
              contrastEventId: foundationEventIds['P2-spectator-no-increment'][index]! })),
        }),
    };
    const lookTargetEventIds = [...successFoundationEventIds];
    const lookContrastEventIds: string[] = [];
    const lookFormationPairs = new Map<number, { target?: string; contrast?: string }>();
    const lookFoundationTimeline = [];
    for (const episode of plan.lookFoundationEpisodes) {
      const result = await executeLookChain(trainingCompute, services, trainingBody, episode);
      if (episode.arm === 'L0-acquire') lookTargetEventIds.push(result.r2Event.eventId);
      else lookContrastEventIds.push(result.r2Event.eventId);
      if (episode.episode >= 12) {
        const pair = lookFormationPairs.get(episode.pairIndex) ?? {};
        if (episode.arm === 'L0-acquire') pair.target = result.r2Event.eventId;
        else pair.contrast = result.r2Event.eventId;
        lookFormationPairs.set(episode.pairIndex, pair);
      }
      lookFoundationTimeline.push({ episode, result });
    }
    assert(lookTargetEventIds.length === 28 && lookContrastEventIds.length === 16,
      `hierarchical-look-foundation-arm-count-invalid:${lookTargetEventIds.length}:${lookContrastEventIds.length}`);
    assert(lookFormationPairs.size === 4
      && [...lookFormationPairs.values()].every(value => value.target && value.contrast),
    'hierarchical-look-formation-pairs-incomplete');
    const afterLookFoundation = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    await saveJson(resolve(evidence, 'POST_LOOK_FOUNDATION_HIERARCHY_SNAPSHOT.json'), afterLookFoundation);
    const lookSelection = selectOpaqueJointInterventionAtBranchV1(afterLookFoundation,
      lookTargetEventIds, lookContrastEventIds, 0,
      cueIdentity({ kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null }));
    const lookProtocol = await trainingCompute.call<R2AInterventionProtocolV1>(
      'registerMatchedInterventionProtocol', {
        protocolId: 'hierarchical-look-acquire-joint-factor-protocol-v1',
        relationId: lookSelection.relationId,
        changedFactorIds: lookSelection.changedFactorIds,
        formationMatchedPairs: [...lookFormationPairs.values()].map(value => ({
          targetEventId: value.target!, contrastEventId: value.contrast!,
        })),
      });
    const pairEvents = new Map<string, { target?: string; contrast?: string }>();
    const interventionTimeline = [];
    for (const episode of plan.interventionEpisodes) {
      assert(episode.comparison !== null, 'intervention-episode-comparison-missing');
      const result = await executeChain(trainingCompute, services, trainingBody, episode, true);
      assert(result.r2Event !== null, 'post-protocol-chain-missing-immediate-R2');
      const pairKey = `${episode.comparison}:${episode.pairIndex}`;
      const pair = pairEvents.get(pairKey) ?? {};
      const targetArm: FoundationArmV1 = 'P0-note-0-increment';
      if (episode.arm === targetArm) pair.target = result.r2Event.eventId;
      else pair.contrast = result.r2Event.eventId;
      pairEvents.set(pairKey, pair); interventionTimeline.push({ episode, result });
      if (pair.target && pair.contrast) {
        const selection = selections[episode.comparison], protocol = protocols[episode.comparison];
        const evidenceValue: R2AInterventionEvidenceV1 = { version: 'R2AInterventionEvidenceV1',
          pairId: `hierarchical-note-${episode.comparison}-joint-pair-${episode.pairIndex}`,
          protocolId: protocol.protocolId, relationId: selection.relationId,
          baselineEventId: pair.target, interventionEventId: pair.contrast,
          changedFactorIds: selection.changedFactorIds, trustedActualObservation: true };
        await trainingCompute.call('recordMatchedIntervention', evidenceValue);
      }
    }
    assert([...pairEvents.values()].every(value => value.target && value.contrast) && pairEvents.size === 4,
      'hierarchical-intervention-pairs-incomplete');
    const lookPairEvents = new Map<number, { target?: string; contrast?: string }>();
    const lookInterventionTimeline = [];
    for (const episode of plan.lookInterventionEpisodes) {
      const result = await executeLookChain(trainingCompute, services, trainingBody, episode);
      const pair = lookPairEvents.get(episode.pairIndex) ?? {};
      if (episode.arm === 'L0-acquire') pair.target = result.r2Event.eventId;
      else pair.contrast = result.r2Event.eventId;
      lookPairEvents.set(episode.pairIndex, pair); lookInterventionTimeline.push({ episode, result });
      if (pair.target && pair.contrast) {
        const evidenceValue: R2AInterventionEvidenceV1 = { version: 'R2AInterventionEvidenceV1',
          pairId: `hierarchical-look-acquire-joint-pair-${episode.pairIndex}`,
          protocolId: lookProtocol.protocolId, relationId: lookSelection.relationId,
          baselineEventId: pair.target, interventionEventId: pair.contrast,
          changedFactorIds: lookSelection.changedFactorIds, trustedActualObservation: true };
        await trainingCompute.call('recordMatchedIntervention', evidenceValue);
      }
    }
    assert([...lookPairEvents.values()].every(value => value.target && value.contrast)
      && lookPairEvents.size === 4, 'hierarchical-look-intervention-pairs-incomplete');
    const frozen = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    assert(frozen.version === HIERARCHICAL_MEMORY_VERSION_V1
      && frozen.r2a?.version === 'R2AStablePatternGraphV11',
    'hierarchical-live-frozen-representation-identity-invalid');
    assert(frozen.annotations.length === plan.frozenR1AtomCount && frozen.writes === plan.frozenR1AtomCount,
      'hierarchical-live-frozen-cardinality-invalid');
    for (const comparison of ['increment-vs-no-increment'] as const) {
      const selection = selections[comparison];
      const relation = frozen.r2a?.relations.find(value => value.relationId === selection.relationId);
      const setEvidence = relation?.factorSetInterventions.find(value => canonical(value.factorIds)
        === canonical(selection.changedFactorIds));
      assert(relation?.grade === 'intervention-supported' && setEvidence?.pairIds.length === 4
        && setEvidence.branchChangeCount / setEvidence.pairIds.length >= .75
        && setEvidence.removalSelectionDrops.length === 4
        && Math.min(...setEvidence.removalSelectionDrops) >= .25,
      `hierarchical-joint-intervention-did-not-reach-production-grade:${comparison}`);
    }
    const lookRelation = frozen.r2a?.relations.find(value => value.relationId === lookSelection.relationId);
    const lookSetEvidence = lookRelation?.factorSetInterventions.find(value => canonical(value.factorIds)
      === canonical(lookSelection.changedFactorIds));
    assert(lookRelation?.grade === 'intervention-supported' && lookRelation.branchAtomIndex === 0
      && lookSetEvidence?.pairIds.length === 4
      && lookSetEvidence.branchChangeCount / lookSetEvidence.pairIds.length >= .75
      && lookSetEvidence.removalSelectionDrops.length === 4
      && Math.min(...lookSetEvidence.removalSelectionDrops) >= .25,
    'hierarchical-look-intervention-did-not-reach-production-grade');
    await saveJson(resolve(evidence, 'SINGLETON_TIMELINE.json'), singletonTimeline);
    await saveJson(resolve(evidence, 'FOUNDATION_TIMELINE.json'), foundationTimeline);
    await saveJson(resolve(evidence, 'FOUNDATION_R2_RESOLUTION.json'), resolvedFoundation);
    await saveJson(resolve(evidence, 'LOOK_FOUNDATION_TIMELINE.json'), lookFoundationTimeline);
    await saveJson(resolve(evidence, 'LOOK_INTERVENTION_SELECTION.json'), lookSelection);
    await saveJson(resolve(evidence, 'LOOK_INTERVENTION_PROTOCOL.json'), lookProtocol);
    await saveJson(resolve(evidence, 'LOOK_INTERVENTION_TIMELINE.json'), lookInterventionTimeline);
    await saveJson(resolve(evidence, 'INTERVENTION_TIMELINE.json'), interventionTimeline);
    await saveJson(resolve(evidence, 'FROZEN_HIERARCHICAL_EXPERIENCE.json'), frozen);
    const baselineDirectory = resolve(evidence, 'frozen-baseline'); await mkdir(baselineDirectory);
    const pointer = await saveExperienceBundleV1(baselineDirectory, frozen,
      { actions: 0, eventCount: plan.frozenR1AtomCount, writes: frozen.writes }, new ControlHabitWeightsV1());
    const pointerPath = resolve(baselineDirectory, 'EXPERIENCE_LATEST.json');
    const baselineSnapshotPath = resolve(baselineDirectory, pointer.filename);
    const baselineHabitPath = resolve(baselineDirectory, pointer.habitFilename!);
    const baselineBefore = { pointer: await fileSha(pointerPath), snapshot: await fileSha(baselineSnapshotPath),
      habit: await fileSha(baselineHabitPath) }, heldout = [];
    await trainingViewer?.close(); trainingViewer = null;
    await trainingBody.close(); trainingBody = null; await trainingCompute.close(); trainingCompute = null;

    for (const heldoutCase of MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1) {
      const caseEvidence = resolve(evidence, heldoutCase.caseId); await mkdir(caseEvidence);
      const compute = new Compute(); const restored = await restoreExperience(compute, pointerPath);
      assert(restored, 'hierarchical-heldout-baseline-restore-failed');
      assert(String(restored.snapshot.version) === HIERARCHICAL_MEMORY_VERSION_V1
        && restored.pointerPath === pointerPath && restored.snapshotPath === baselineSnapshotPath
        && restored.habitPath === baselineHabitPath && restored.pointer.sha256 === sha(frozen)
        && sha(restored.snapshot) === sha(frozen)
        && await compute.call<string>('hash') === sha(frozen),
      'hierarchical-heldout-did-not-restore-this-run-frozen-baseline');
      assert(canonical(restored.habit.exportCheckpoint())
        === canonical(new ControlHabitWeightsV1().exportCheckpoint()),
      'hierarchical-heldout-habit-was-not-empty');
      const caseRecords: { kind: string; value: unknown }[] = [];
      let latestFullDecision: unknown = null;
      const caseRecord = (kind: string, value: unknown) => {
        const copy = structuredClone(value);
        if (kind === 'joint-control-decision') {
          latestFullDecision = copy;
          const snapshot = copy as { lastDecision?: unknown; attentionDrive?: number;
            field?: { sites?: readonly { operation?: string; effectiveDrive?: number }[] };
            workspace?: { epoch?: number; observationSequence?: number;
              nodes?: readonly { node?: { kind?: string } }[]; dependencies?: readonly unknown[];
              pendingRequests?: readonly unknown[]; completedOperations?: readonly unknown[] } };
          const nodeKinds: Record<string, number> = {};
          for (const wrapper of snapshot.workspace?.nodes ?? []) {
            const nodeKind = wrapper.node?.kind ?? 'unknown'; nodeKinds[nodeKind] = (nodeKinds[nodeKind] ?? 0) + 1;
          }
          const operationDrives: Record<string, number> = {};
          for (const site of snapshot.field?.sites ?? []) if ((site.effectiveDrive ?? 0) > 0) {
            const operation = site.operation ?? 'unknown'; operationDrives[operation] = (operationDrives[operation] ?? 0) + 1;
          }
          record(kind, { caseId: heldoutCase.caseId, value: {
            version: 'HierarchicalShortChainControlDecisionAuditV1', lastDecision: snapshot.lastDecision,
            attentionDrive: snapshot.attentionDrive ?? 0, operationDrives,
            workspace: { epoch: snapshot.workspace?.epoch ?? null,
              observationSequence: snapshot.workspace?.observationSequence ?? null,
              nodeCount: snapshot.workspace?.nodes?.length ?? 0, nodeKinds,
              dependencyCount: snapshot.workspace?.dependencies?.length ?? 0,
              pendingRequestCount: snapshot.workspace?.pendingRequests?.length ?? 0,
              completedOperationCount: snapshot.workspace?.completedOperations?.length ?? 0 } } });
          return;
        }
        if (kind === 'control-action-result') {
          if (latestFullDecision !== null)
            caseRecords.push({ kind: 'joint-control-decision', value: structuredClone(latestFullDecision) });
          caseRecords.push({ kind, value: copy });
        }
        record(kind, { caseId: heldoutCase.caseId, value: copy });
      };
      const body = new MinecraftBody({ ...config.minecraft, worldId: heldoutCase.caseId,
        sessionId: heldoutCase.caseId, activeSecondsOffset: frozen.activeSeconds }, caseRecord);
      let runtime: V5Runtime | null = null;
      let caseViewer: Awaited<ReturnType<typeof startLoopbackMineflayerViewerV1>> | null = null;
      let dashboard: Server | null = null;
      try {
        await body.ready();
        await prepareGuidedNoteFixtureLiveV1(services, body, heldoutCase.layout, 0,
          heldoutCase.yawOffsetDegrees, { clearRadius: 12 });
        const readiness = await waitForUniqueNote(body, '0', 5), goal = noteTwoGoal(heldoutCase.caseId,
          readiness.controlId);
        const runConfig: Configuration = { ...config, actionBudget: heldoutCase.actionBudget };
        runtime = new V5Runtime(body, runConfig, caseEvidence, caseRecord,
          { compute, restoredExperience: restored });
        if (config.viewer.enabled) {
          caseViewer = await startLoopbackMineflayerViewerV1(body.bot, {
            host: config.viewer.host, port: config.viewer.port, firstPerson: true, viewDistance: 3,
          });
          dashboard = await startDashboard(runtime, config.viewer.dashboardPort);
          viewerEndpoints.push({ phase: heldoutCase.caseId, firstPerson: caseViewer.url,
            dashboard: `http://${config.viewer.host}:${config.viewer.dashboardPort}/`, readOnly: true });
          caseRecord('viewer-endpoint', viewerEndpoints.at(-1));
        }
        caseRecord('hierarchical-root-goal-injection', goal);
        const result = await runtime.runGoal(goal);
        const first = body.latest(); await body.waitTicks(5); const second = body.latest();
        const verified = noteValue(first, readiness.controlId) === '2'
          && noteValue(second, readiness.controlId) === '2';
        await runtime.save();
        const physicalEvidence = auditFrozenPhysicalActionEvidenceLiveV1(caseRecords, frozen);
        await saveJson(resolve(caseEvidence, 'FROZEN_PHYSICAL_ACTION_EVIDENCE_AUDIT.json'), physicalEvidence);
        heldout.push({ caseId: heldoutCase.caseId, status: result.status,
          actions: result.actions, verified, baselineHashUnchanged:
            await fileSha(pointerPath) === baselineBefore.pointer
            && await fileSha(baselineSnapshotPath) === baselineBefore.snapshot
            && await fileSha(baselineHabitPath) === baselineBefore.habit,
          frozenPhysicalEvidenceActions: physicalEvidence.actions.length,
          frozenPhysicalEvidencePassed: physicalEvidence.passed });
      } finally {
        await caseViewer?.close();
        if (dashboard) await new Promise<void>(done => dashboard!.close(() => done()));
        if (runtime) await runtime.close(); else { await body.close(); await compute.close(); }
      }
    }
    const result: MinecraftHierarchicalShortChainLiveResultV1 = {
      version: MINECRAFT_HIERARCHICAL_SHORT_CHAIN_LIVE_V1,
      passed: heldout.length === 4 && heldout.every(value => value.status === 'goal-verified'
        && value.verified && value.baselineHashUnchanged && value.frozenPhysicalEvidencePassed), planSha256: sha(plan),
      initialization: { r1Atoms: 128, r2Events: 36,
        p0Events: foundationEventIds['P0-note-0-increment'].length,
        p1Events: foundationEventIds['P1-note-1-increment'].length,
        p2Events: foundationEventIds['P2-spectator-no-increment'].length,
        lookFoundationR2Events: lookFoundationTimeline.length,
        frozenR1Atoms: frozen.annotations.length },
      intervention: { selections, protocols, pairs: pairEvents.size,
        lookSelection, lookProtocol, lookPairs: lookPairEvents.size,
        frozenSnapshotSha256: sha(frozen) }, heldout };
    await saveJson(resolve(evidence, 'VIEWER_ENDPOINTS.json'), viewerEndpoints);
    await saveJson(resolve(evidence, 'RESULT.json'), result);
    assert(result.passed, 'hierarchical-minecraft-short-chain-live-batch-failed');
    return result;
  } catch (error) {
    const failure = error as Error;
    const artifact = { version: 'MinecraftHierarchicalShortChainLiveFailureV1',
      message: failure.message, name: failure.name, stack: failure.stack ?? null,
      planSha256: sha(plan), viewerEndpoints: structuredClone(viewerEndpoints), retryCount: 0 };
    record('hierarchical-short-chain-live-first-failure', artifact);
    await saveJson(resolve(evidence, 'RUN_FAILURE.json'), artifact);
    await saveJson(resolve(evidence, 'VIEWER_ENDPOINTS.json'), viewerEndpoints);
    throw error;
  } finally {
    await trainingViewer?.close(); await trainingBody?.close(); await trainingCompute?.close(); await services.stop();
    await Promise.all([new Promise<void>(done => events.end(done)),
      new Promise<void>(done => frames.end(done))]);
  }
}
