import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Action, Observation, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import type { ActionObservationScopeV1, EffectRecallCandidateV1, GroundedGoalV1 }
  from '../control/contracts.js';
import { GroundedGoalEvaluatorV1 } from '../control/goal.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { cueIdentity, eventRows, realEventHierarchyContinuityV1 } from '../events.js';
import type { HierarchicalMemoryObservationReceiptV1,
  HierarchicalMemorySnapshotV1 } from '../hierarchical-memory.js';
import { restoreExperience, saveExperienceBundleV1, V5Runtime } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import type { R2AInterventionEvidenceV1, R2AInterventionProtocolV1 }
  from '../core/learning/r2a-stable-pattern.js';
import type { R2ContinuousEventV1 } from '../core/learning/r2-continuous-event.js';
import { DeterministicTokenFieldEncoder } from '../core/learning/token-field.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import { ironDoorOpenGoalV1 } from './minecraft-multilevel-goal-chain-v1.js';
import {
  applyMinecraftFixtureCommandBatchLiveV1,
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedFixtureInitialViewLiveV1,
  minecraftMultilevelGuidedGlobalCommandsLiveV1,
  prepareMinecraftMultilevelGuidedFixtureLiveV1,
  type MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  type MinecraftMultilevelGuidedTrainingLayoutLiveV1,
  type PreparedMinecraftMultilevelGuidedFixtureLiveV1,
} from './minecraft-multilevel-guided-training-live-v1.js';
import { auditFrozenPhysicalActionEvidenceLiveV1,
  type OpaqueInterventionSelectionV1 } from './minecraft-hierarchical-short-chain-live-v1.js';

export const MINECRAFT_HIERARCHICAL_BUTTON_DOOR_LIVE_V1 =
  'MinecraftHierarchicalButtonDoorLiveV1' as const;
export const BUTTON_DOOR_NEW_BODY_SETTLE_TICKS_LIVE_V1 = 60 as const;

export type ButtonDoorFoundationArmLiveV1 =
  | 'look-acquire'
  | 'look-miss'
  | 'wired-open'
  | 'disconnected-no-open';

export interface ButtonDoorChainEpisodeLiveV1 {
  readonly episode: number;
  readonly phase: 'foundation' | 'intervention';
  readonly arm: ButtonDoorFoundationArmLiveV1;
  readonly pairIndex: number;
  readonly comparison: 'look-acquire-vs-miss' | 'wired-vs-disconnected';
  readonly layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1;
}

export interface MinecraftHierarchicalButtonDoorPlanLiveV1 {
  readonly version: 'MinecraftHierarchicalButtonDoorPlanLiveV1';
  readonly initialExperience: 'empty';
  readonly foundation: readonly ButtonDoorChainEpisodeLiveV1[];
  readonly interventions: readonly ButtonDoorChainEpisodeLiveV1[];
  readonly foundationR1Atoms: 128;
  readonly foundationR2Events: 64;
  readonly interventionR1Atoms: 32;
  readonly interventionR2Events: 16;
  readonly frozenR1Atoms: 160;
  readonly fullSolutionTrainingFragments: 0;
}

const CARDINALS = ['north', 'east', 'south', 'west'] as const;
const CONTEXT_BLOCKS = ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool',
  'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool'] as const;

function layout(index: number, phase: 'foundation' | 'intervention' | 'heldout'):
MinecraftMultilevelGuidedTrainingLayoutLiveV1 {
  const offset = phase === 'foundation' ? 0 : phase === 'intervention' ? 420 : 620;
  return Object.freeze({ id: `hierarchical-button-door-${phase}-layout-${index + 1}`,
    split: index < 8 ? 'calibration' : 'consolidation', replication: index,
    originX: 640 + offset + (index % 4) * 24,
    originZ: 640 + Math.floor(index / 4) * 24,
    facing: CARDINALS[index % CARDINALS.length]!, neutralMarkerMask: index % 8 });
}

/** Precommitted before any real outcome is observed. */
export function minecraftHierarchicalButtonDoorPlanLiveV1():
MinecraftHierarchicalButtonDoorPlanLiveV1 {
  const arms = ['look-acquire', 'look-miss', 'wired-open', 'disconnected-no-open'] as const;
  const foundation = Array.from({ length: 16 }, (_, context) => arms.map((arm, offset) => ({
    episode: context * 4 + offset, phase: 'foundation' as const, arm, pairIndex: context,
    comparison: arm.startsWith('look-') ? 'look-acquire-vs-miss' as const
      : 'wired-vs-disconnected' as const,
    layout: layout(context, 'foundation'),
  }))).flat();
  const interventions = (['look-acquire-vs-miss', 'wired-vs-disconnected'] as const)
    .flatMap((comparison, comparisonIndex) => Array.from({ length: 4 }, (_, pairIndex) => {
      const pairArms: readonly [ButtonDoorFoundationArmLiveV1, ButtonDoorFoundationArmLiveV1] =
        comparison === 'look-acquire-vs-miss'
          ? ['look-acquire', 'look-miss'] : ['wired-open', 'disconnected-no-open'];
      return pairArms.map((arm, armIndex) => ({ episode: comparisonIndex * 8 + pairIndex * 2 + armIndex,
        phase: 'intervention' as const, arm, pairIndex, comparison,
        layout: layout(comparisonIndex * 4 + pairIndex, 'intervention') }));
    }).flat());
  return Object.freeze({ version: 'MinecraftHierarchicalButtonDoorPlanLiveV1',
    initialExperience: 'empty', foundation: Object.freeze(foundation),
    interventions: Object.freeze(interventions), foundationR1Atoms: 128,
    foundationR2Events: 64, interventionR1Atoms: 32, interventionR2Events: 16,
    frozenR1Atoms: 160, fullSolutionTrainingFragments: 0 });
}

export const MINECRAFT_HIERARCHICAL_BUTTON_DOOR_HELDOUTS_LIVE_V1 = Object.freeze(
  Array.from({ length: 4 }, (_, index) => Object.freeze({
    caseId: `hierarchical-button-door-heldout-${index + 1}`,
    layout: layout(index, 'heldout'), yawOffsetDegrees: index < 2 ? 0 : -15,
    actionBudget: 12 as const,
  })),
);

/**
 * Cross-object fixture selector. It keeps the short-chain selector's exact
 * arm membership and unique-pattern rules, while accepting one genuinely
 * discriminative opaque factor because a single physical circuit bit is a
 * valid first-order intervention.
 */
export function selectButtonDoorOpaqueInterventionAtBranchLiveV1(
  snapshot: HierarchicalMemorySnapshotV1, targetEventIds: readonly string[],
  contrastEventIds: readonly string[], branchAtomIndex: number,
  exactNextActionIdentity: string): OpaqueInterventionSelectionV1 {
  assert(snapshot.r2a && snapshot.tokenEncoder, 'button-door-selector-requires-R2A');
  const targetSet = new Set(targetEventIds), contrastSet = new Set(contrastEventIds);
  assert(targetSet.size === targetEventIds.length && contrastSet.size === contrastEventIds.length
    && [...targetSet].every(id => !contrastSet.has(id)),
  'button-door-precommitted-arm-membership-invalid');
  const exactPattern = (members: ReadonlySet<string>) => {
    const matches = snapshot.r2a!.patterns.filter(pattern =>
      pattern.memberEventIds.length === members.size
      && pattern.memberEventIds.every(id => members.has(id)));
    assert(matches.length === 1, `button-door-arm-requires-one-complete-stable-pattern:${matches.length}`);
    return matches[0]!;
  };
  const target = exactPattern(targetSet), contrast = exactPattern(contrastSet);
  const relations = snapshot.r2a.relations.filter(relation =>
    relation.targetPatternId === target.patternId
    && relation.contrastPatternIds.includes(contrast.patternId)
    && relation.branchAtomIndex === branchAtomIndex
    && relation.exactNextActionIdentity === exactNextActionIdentity
    && relation.predictiveSinceEventId !== null
    && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(relation.grade));
  assert(relations.length === 1, `button-door-foundation-relation-not-unique:${relations.length}`);
  const relation = relations[0]!, encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
  const evidence = new Map(snapshot.r2a.evidence.map(value => [value.eventId, value]));
  const values = (eventIds: readonly string[], tokenIndex: number) => eventIds.map(eventId => {
    const item = evidence.get(eventId);
    assert(item?.atomPrePerceptions[branchAtomIndex],
      `button-door-branch-perception-missing:${eventId}`);
    return encoder.encode(`${eventId}:atom:${branchAtomIndex}`,
      new Float64Array(item.atomPrePerceptions[branchAtomIndex]!)).tokens[tokenIndex]!.standardizedValue;
  });
  const changedFactorIds = relation.factorIds.filter(factorId => {
    const factor = snapshot.r2a!.factors.find(value => value.factorId === factorId);
    assert(factor, `button-door-relation-factor-missing:${factorId}`);
    const left = values(target.memberEventIds, factor.tokenIndex);
    const right = values(contrast.memberEventIds, factor.tokenIndex);
    const mean = (input: readonly number[]) => input.reduce((sum, value) => sum + value, 0) / input.length;
    const spread = (input: readonly number[]) => Math.max(...input) - Math.min(...input);
    return spread(left) <= factor.tolerance && spread(right) <= factor.tolerance
      && Math.abs(mean(left) - mean(right)) > factor.tolerance;
  }).sort((left, right) => left.localeCompare(right, 'en'));
  assert(changedFactorIds.length >= 1,
    `button-door-opaque-factor-set-not-recovered:${changedFactorIds.length}`);
  return Object.freeze({ version: 'OpaqueInterventionSelectionV1',
    targetPatternId: target.patternId, contrastPatternId: contrast.patternId,
    relationId: relation.relationId, changedFactorIds: Object.freeze(changedFactorIds),
    branchAtomIndex, targetMemberEventIds: Object.freeze([...target.memberEventIds]),
    contrastMemberEventIds: Object.freeze([...contrast.memberEventIds]),
    targetArmCoverage: target.memberEventIds.length / targetEventIds.length,
    contrastArmCoverage: contrast.memberEventIds.length / contrastEventIds.length,
    selectionInputs: 'precommitted-arm-membership-and-pre-action-perception-only' });
}

export function minecraftHierarchicalButtonDoorScopeLiveV1(buttonId: string, doorId: string):
ActionObservationScopeV1 {
  assert(buttonId.startsWith('block:') && doorId.startsWith('block:') && buttonId !== doorId,
    'button-door-scope-requires-distinct-public-blocks');
  const match = /^block:(-?\d+),(-?\d+),(-?\d+)$/.exec(doorId);
  assert(match, 'button-door-scope-requires-public-block-door');
  const upperDoorId = `block:${match[1]},${Number(match[2]) + 1},${match[3]}`;
  return { version: 'ActionObservationScopeV1',
    referencedPublicObjectIds: Object.freeze([buttonId, doorId, upperDoorId]) };
}

function retag(event: RealEvent, sessionId: string, boundaryBefore: 'continuous' | 'reset'):
RealEvent {
  const publicEvent = { ...event, hierarchyContinuity: undefined };
  return { ...publicEvent,
    hierarchyContinuity: realEventHierarchyContinuityV1(publicEvent, sessionId, boundaryBefore) };
}

async function executeRealAtom(body: MinecraftBody, action: Action,
  scope: ActionObservationScopeV1, boundaryBefore: 'continuous' | 'reset') {
  const execution = await body.execute(action, scope);
  assert(execution.result.executed && execution.event,
    `button-door-guided-action-failed:${action.kind}:${execution.result.status}`);
  const event = retag(execution.event, body.session.id, boundaryBefore);
  return { event };
}

function submitRealAtom(compute: Compute, event: RealEvent) {
  // Attach both branches immediately so a worker failure cannot become an
  // unhandled rejection while the following real observation closes.
  return compute.call<HierarchicalMemoryObservationReceiptV1>('observe', event).then(
    receipt => ({ receipt } as const), error => ({ error } as const));
}

function acceptedRealAtom(outcome: Awaited<ReturnType<typeof submitRealAtom>>) {
  if ('error' in outcome) throw outcome.error;
  const { receipt } = outcome;
  assert(receipt.representationRejection === null,
    `button-door-event-unrepresented:${canonical(receipt.representationRejection)}`);
  return receipt;
}

function position(layoutValue: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
  lateral: number, forwardDistance: number, y = 64): readonly [number, number, number] {
  const forward = layoutValue.facing === 'north' ? [0, -1] as const
    : layoutValue.facing === 'south' ? [0, 1] as const
      : layoutValue.facing === 'east' ? [1, 0] as const : [-1, 0] as const;
  const right = [-forward[1], forward[0]] as const;
  return [layoutValue.originX + right[0] * lateral + forward[0] * forwardDistance,
    y, layoutValue.originZ + right[1] * lateral + forward[1] * forwardDistance];
}

/** Neutral scene-identity evidence for the real fixture.  The blocks sit well
 * inside the public 8-block/45-degree observation cone, but outside the centre
 * ray and the button/circuit.  Their material varies across layouts and is
 * identical inside each wired/disconnected matched pair. */
export const BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1 = Object.freeze([
  Object.freeze({ lateral: -3, forwardDistance: 6, y: 65 }),
  Object.freeze({ lateral: -3, forwardDistance: 6, y: 66 }),
  Object.freeze({ lateral: 3, forwardDistance: 6, y: 65 }),
  Object.freeze({ lateral: 3, forwardDistance: 6, y: 66 }),
]);

function episodeForFixture(specification: ButtonDoorChainEpisodeLiveV1,
  wired = specification.arm !== 'disconnected-no-open'):
MinecraftMultilevelGuidedTrainingEpisodeLiveV1 {
  return { version: 'MinecraftMultilevelGuidedTrainingEpisodeLiveV1',
    episode: specification.episode, half: specification.phase === 'foundation'
      ? 'first-128-calibration' : 'second-128-consolidation',
    mode: wired ? 'interact-wired-button-opens-iron-door'
      : 'interact-visible-disconnected-button-no-door-change',
    layout: specification.layout, action: { kind: 'interact', parameters: {},
      targetId: `${specification.layout.id}:materialized-at-runtime` },
    reset: 'before-this-episode-only', fullSolutionDisclosed: false };
}

class FixtureCommandBoundaryLiveV1 {
  #sealed = false;
  #count = 0;
  readonly #forcedRegions = new Set<string>();
  constructor(readonly services: Services) {}
  command(command: string): void {
    assert(!this.#sealed, 'fixture-command-after-root-goal-injection');
    this.services.command(command); this.#count++;
  }
  ensureLoaded(layoutValue: MinecraftMultilevelGuidedTrainingLayoutLiveV1): boolean {
    const command = buttonDoorFixtureForceloadCommandLiveV1(layoutValue);
    if (this.#forcedRegions.has(command)) return false;
    this.command(command); this.#forcedRegions.add(command); return true;
  }
  seal(): number { this.#sealed = true; return this.#count; }
  get count(): number { return this.#count; }
}

/**
 * Fixture coordinates are deliberately outside the old note-block arena.
 * Force-load only the small current arena before issuing reset commands; this
 * is environment preparation, not an observation or planning input.
 */
export function buttonDoorFixtureForceloadCommandLiveV1(
  layoutValue: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
): string {
  return `forceload add ${layoutValue.originX - 16} ${layoutValue.originZ - 16}`
    + ` ${layoutValue.originX + 16} ${layoutValue.originZ + 16}`;
}

async function waitForPoseAndPublicFixture(body: MinecraftBody,
  fixture: PreparedMinecraftMultilevelGuidedFixtureLiveV1, expectedYaw: number,
  expectedPitch: number, expectButton: boolean,
  expectedNeutralMarkerType: string | null): Promise<Observation> {
  const angular = (left: number, right: number) =>
    Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
  for (let tick = 0; tick < 100; tick++) {
    const observation = body.latest();
    const button = observation.objects.find(value => value.id === fixture.buttonId);
    const door = observation.objects.find(value => value.id === fixture.doorId);
    const upperDoorReady = observation.objects.some(value => value.type === 'iron_door'
      && value.properties.half === 'upper');
    const buttonReady = expectButton ? button?.type === 'stone_button' : button === undefined;
    const markerReady = expectedNeutralMarkerType === null
      || observation.objects.some(value => value.type === expectedNeutralMarkerType);
    if (buttonReady && door?.type === 'iron_door' && upperDoorReady
      && markerReady
      && door.properties.open === false && angular(observation.self.yaw, expectedYaw) < .03
      && angular(observation.self.pitch, expectedPitch) < .03) return observation;
    await body.waitTicks(1);
  }
  throw new Error('button-door-public-fixture-or-pose-not-ready');
}

/** Fixture work ends before a learned action or root goal is issued. */
async function prepareButtonDoorFixture(commands: FixtureCommandBoundaryLiveV1, body: MinecraftBody,
  specification: ButtonDoorChainEpisodeLiveV1, yawOffsetDegrees: number,
  includeNeutralMarkers: boolean) {
  // Commands against an unloaded destination are accepted by the server but
  // do not build the fixture.  Wait for the real server ticket before reset.
  if (commands.ensureLoaded(specification.layout)) await body.waitTicks(20);
  const episode = episodeForFixture(specification);
  const fixture = await prepareMinecraftMultilevelGuidedFixtureLiveV1(commands, body, episode);
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(specification.layout);
  // Remove the guided fixture's marker fan and every position owned by this
  // fixture before rebuilding the selected public context.  These are setup
  // observations only; they never encode the wired/disconnected result.
  for (const [lateral, distance] of [[-2, 6], [0, 8], [3, 5]] as const)
    for (const y of [64, 65, 66]) commands.command(`setblock ${position(specification.layout,
      lateral, distance, y).join(' ')} air`);
  for (const offset of BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1)
    commands.command(`setblock ${position(specification.layout, offset.lateral,
      offset.forwardDistance, offset.y).join(' ')} air`);
  const contextType = includeNeutralMarkers
    ? CONTEXT_BLOCKS[specification.layout.neutralMarkerMask % CONTEXT_BLOCKS.length]! : null;
  if (contextType !== null) {
    for (const offset of BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1)
      commands.command(`setblock ${position(specification.layout, offset.lateral,
        offset.forwardDistance, offset.y).join(' ')} minecraft:${contextType}`);
  }
  const expectButton = buttonDoorLookButtonPresentLiveV1(specification.arm);
  if (!expectButton) commands.command(`setblock ${fixture.geometry.button.join(' ')} air`);
  const exact = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry);
  const expectedYaw = exact.yaw + yawOffsetDegrees * Math.PI / 180;
  const notchYaw = ((180 - expectedYaw * 180 / Math.PI) % 360 + 360) % 360;
  const notchPitch = -exact.pitch * 180 / Math.PI;
  commands.command(`tp ${body.bot.username} ${geometry.bot.join(' ')} ${notchYaw} ${notchPitch}`);
  await body.waitTicks(4);
  const observation = await waitForPoseAndPublicFixture(body, fixture, expectedYaw, exact.pitch,
    expectButton, contextType);
  return { episode, fixture, observation };
}

/**
 * Both look arms start from the same public pose and execute the same action.
 * The matched intervention changes only whether the public button exists.
 */
export function buttonDoorInitialYawOffsetLiveV1(arm: ButtonDoorFoundationArmLiveV1): number {
  return arm.startsWith('look-') ? -15 : 0;
}

export function buttonDoorLookButtonPresentLiveV1(arm: ButtonDoorFoundationArmLiveV1): boolean {
  return arm !== 'look-miss';
}

function doorOpen(observation: Observation, doorId: string): boolean {
  return observation.objects.find(value => value.id === doorId)?.properties.open === true;
}

export function assertButtonDoorInteractionEventLiveV1(event: RealEvent, buttonId: string,
  doorId: string, expectedDoorTransition: 'false-to-true' | 'remains-false'): void {
  assert(event.trackedIds.includes(buttonId) && event.trackedIds.includes(doorId),
    'button-door-interaction-event-did-not-retain-both-public-objects');
  const roles = eventRows(event).roles, doorRole = roles[doorId];
  assert(doorRole?.startsWith('iron_door#'), 'button-door-interaction-door-role-missing');
  const transitions = eventRows(event).changes.flat().filter(change => change.subject === doorRole
    && change.property === 'open');
  const publicDoorValues = event.frames.map(frame => frame.objects.find(value => value.id === doorId))
    .filter((value): value is NonNullable<typeof value> => value !== undefined)
    .map(value => value.properties.open);
  assert(publicDoorValues.length > 0 && publicDoorValues[0] === false,
    'button-door-interaction-did-not-start-with-public-closed-door');
  if (expectedDoorTransition === 'false-to-true') {
    assert(transitions.some(change => change.before === false && change.after === true)
      && publicDoorValues.includes(true), 'button-door-wired-event-missing-real-open-transition');
  } else assert(transitions.length === 0 && publicDoorValues.every(value => value === false),
    'button-door-disconnected-event-did-not-remain-publicly-closed');
}

/** Calibration must cover both public blocks of the same real iron door. */
export function assertButtonDoorEventPartCoverageLiveV1(event: RealEvent): void {
  for (const frame of [event.frames[0]!, event.frames.at(-1)!]) {
    const halves = new Set(frame.objects.filter(value => value.type === 'iron_door')
      .map(value => value.properties.half));
    assert(halves.has('lower') && halves.has('upper'),
      `button-door-event-boundary-missing-public-door-half:${frame.sequence}`);
  }
}

function circuitIds(specification: ButtonDoorChainEpisodeLiveV1): readonly string[] {
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(specification.layout);
  const blockId = (value: readonly [number, number, number]) => `block:${value.join(',')}`;
  return Object.freeze([geometry.dropper, geometry.container, geometry.comparator,
    geometry.repeater, position(specification.layout, 0, 7)].map(blockId));
}

/** Assert a matched pair changes only actual public circuit components. */
export function buttonDoorPublicCircuitDifferenceLiveV1(wired: Observation,
  disconnected: Observation, allowedCircuitIds: readonly string[],
  buttonId: string, doorId: string): readonly string[] {
  const view = (observation: Observation, id: string) => {
    const object = observation.objects.find(value => value.id === id);
    return object ? canonical({ type: object.type, relativePosition: object.relativePosition,
      properties: object.properties }) : null;
  };
  assert(view(wired, buttonId) === view(disconnected, buttonId)
    && view(wired, doorId) === view(disconnected, doorId),
  'button-door-matched-pair-changed-button-or-door-prestate');
  const ids = new Set([...wired.objects, ...disconnected.objects].map(value => value.id));
  const changed = [...ids].filter(id => view(wired, id) !== view(disconnected, id)).sort();
  assert(changed.length > 0, 'button-door-matched-pair-has-no-public-circuit-difference');
  const allowed = new Set(allowedCircuitIds);
  assert(changed.every(id => allowed.has(id)),
    `button-door-matched-pair-changed-non-circuit-public-state:${changed.filter(id => !allowed.has(id)).join(',')}`);
  return Object.freeze(changed);
}

export interface ExpectedButtonDoorR2ChainLiveV1 {
  readonly episode: number;
  readonly arm: ButtonDoorFoundationArmLiveV1;
  readonly sourceEventIds: readonly [string, string];
  readonly orderedExperienceIdentities: readonly [string, string];
}

export function exactCompleteTwoAtomButtonDoorR2LiveV1(snapshot: HierarchicalMemorySnapshotV1,
  expected: ExpectedButtonDoorR2ChainLiveV1): R2ContinuousEventV1 {
  const matches = snapshot.r2Store.events.filter(value => value.sourceEventIds.length === 2
    && value.sourceEventIds.every((id, index) => id === expected.sourceEventIds[index]));
  assert(matches.length === 1, `button-door-R2-exact-source-match-count:${expected.episode}:${matches.length}`);
  const event = matches[0]!;
  assert(event.completion === 'complete' && event.learningEligible
    && event.boundaryReason === 'public-process-resolved',
  `button-door-R2-completion-invalid:${expected.episode}:${event.completion}:${event.boundaryReason}`);
  assert(event.orderedExperienceIdentities.length === 2
    && event.orderedExperienceIdentities.every((value, index) =>
      value === expected.orderedExperienceIdentities[index]),
  `button-door-R2-action-order-invalid:${expected.episode}`);
  return event;
}

export function verifyInitializedButtonDoorFoundationLiveV1(snapshot: HierarchicalMemorySnapshotV1,
  expected: readonly ExpectedButtonDoorR2ChainLiveV1[]) {
  assert(snapshot.annotations.length === 128 && snapshot.writes === 128,
    'button-door-foundation-requires-exact-128-initial-atoms');
  assert(expected.length === 64, 'button-door-foundation-requires-64-two-atom-chains');
  const events = expected.map(value => exactCompleteTwoAtomButtonDoorR2LiveV1(snapshot, value));
  assert(new Set(events.map(value => value.eventId)).size === 64,
    'button-door-foundation-reused-R2-event');
  assert(snapshot.r2Store.events.filter(value => value.learningEligible).length === 64,
    'button-door-foundation-has-extra-or-missing-R2-event');
  return Object.freeze(events);
}

async function executeChain(compute: Compute, commands: FixtureCommandBoundaryLiveV1, body: MinecraftBody,
  specification: ButtonDoorChainEpisodeLiveV1, verifyImmediately: boolean) {
  const offset = buttonDoorInitialYawOffsetLiveV1(specification.arm);
  // Both foundation and matched-intervention events need the same public,
  // outcome-neutral context variation.  Omitting it from the intervention
  // phase collapses all validation pairs into one self-centred context.
  const prepared = await prepareButtonDoorFixture(commands, body, specification, offset, true);
  const buttonId = prepared.fixture.buttonId!, doorId = prepared.fixture.doorId!;
  const scope = minecraftHierarchicalButtonDoorScopeLiveV1(buttonId, doorId);
  const action: Action = specification.arm.startsWith('look-')
    ? { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } }
    : { kind: 'interact', parameters: {}, targetId: buttonId };
  const first = await executeRealAtom(body, action, scope, 'reset');
  assertButtonDoorEventPartCoverageLiveV1(first.event);
  // R1 submission starts immediately, but the real body must not wait for the
  // slower upper-layer update before beginning the explicitly continuous
  // observation atom. Otherwise valid public ticks are omitted between the
  // two R1 windows and R2 correctly refuses to join them.
  const firstLearning = submitRealAtom(compute, first.event);
  if (specification.arm === 'look-acquire')
    assert(body.latest().targetId === buttonId, 'button-door-look-acquire-did-not-acquire-button');
  if (specification.arm === 'look-miss')
    assert(body.latest().targetId !== buttonId, 'button-door-look-miss-acquired-button');
  if (specification.arm === 'wired-open')
    { assert(doorOpen(body.latest(), doorId), 'button-door-wired-interaction-did-not-open-door');
      assertButtonDoorInteractionEventLiveV1(first.event, buttonId, doorId, 'false-to-true'); }
  if (specification.arm === 'disconnected-no-open')
    { assert(!doorOpen(body.latest(), doorId), 'button-door-disconnected-interaction-opened-door');
      assertButtonDoorInteractionEventLiveV1(first.event, buttonId, doorId, 'remains-false'); }
  const second = await executeRealAtom(body,
    { kind: 'observe', parameters: { ticks: 5 } }, scope, 'continuous');
  assertButtonDoorEventPartCoverageLiveV1(second.event);
  const firstReceipt = acceptedRealAtom(await firstLearning);
  const secondReceipt = acceptedRealAtom(await submitRealAtom(compute, second.event));
  const expectation: ExpectedButtonDoorR2ChainLiveV1 = { episode: specification.episode,
    arm: specification.arm, sourceEventIds: [first.event.id, second.event.id],
    orderedExperienceIdentities: [cueIdentity(first.event.cue), cueIdentity(second.event.cue)] };
  const r2Event = verifyImmediately
    ? exactCompleteTwoAtomButtonDoorR2LiveV1(
      await compute.call<HierarchicalMemorySnapshotV1>('snapshot'), expectation) : null;
  return { specification, prepared, first: { ...first, receipt: firstReceipt },
    second: { ...second, receipt: secondReceipt }, expectation, r2Event };
}

type ButtonDoorChainExecutionLiveV1 = Awaited<ReturnType<typeof executeChain>>;

export interface DisconnectedQualificationLiveV1 {
  readonly version: 'DisconnectedQualificationLiveV1';
  readonly candidateCount: number;
  readonly productionEligibleCount: 0;
  readonly snapshotHashUnchanged: true;
}

async function qualifyDisconnectedReadOnly(compute: Compute, commands: FixtureCommandBoundaryLiveV1,
  body: MinecraftBody,
  specification: ButtonDoorChainEpisodeLiveV1): Promise<DisconnectedQualificationLiveV1> {
  const prepared = await prepareButtonDoorFixture(commands, body, specification, 0, false);
  const goal = ironDoorOpenGoalV1('button-door-disconnected-negative', prepared.fixture.doorId!);
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, body.latest());
  const before = await compute.call<string>('hash');
  const candidates = await compute.call<readonly EffectRecallCandidateV1[]>('recallAtomicEffect',
    goal, evaluator.evaluate(body.latest()), body.latest());
  const relevant = candidates.filter(value => value.actionCue.kind === 'interact'
    && value.actionCue.targetRole === 'stone_button');
  assert(relevant.length > 0, 'button-door-negative-qualification-missing-wired-recall');
  const conditions = await Promise.all(relevant.map(candidate => compute.call<{
    productionEligible: boolean }>('compareConditions', candidate, body.latest())));
  assert(conditions.every(value => !value.productionEligible),
    'button-door-disconnected-context-was-production-eligible');
  assert(await compute.call<string>('hash') === before,
    'button-door-negative-qualification-wrote-physical-memory');
  return { version: 'DisconnectedQualificationLiveV1', candidateCount: relevant.length,
    productionEligibleCount: 0, snapshotHashUnchanged: true };
}

async function preverifyAndResetHeldoutFixture(commands: FixtureCommandBoundaryLiveV1, body: MinecraftBody,
  specification: ButtonDoorChainEpisodeLiveV1, yawOffsetDegrees: number) {
  const diagnostic = await prepareButtonDoorFixture(commands, body, specification, 0, false);
  const scope = minecraftHierarchicalButtonDoorScopeLiveV1(diagnostic.fixture.buttonId!,
    diagnostic.fixture.doorId!);
  const execution = await body.execute({ kind: 'interact', parameters: {},
    targetId: diagnostic.fixture.buttonId! }, scope);
  assert(execution.result.executed && doorOpen(body.latest(), diagnostic.fixture.doorId!),
    'button-door-heldout-latch-preverification-did-not-open');
  await body.waitTicks(200);
  assert(doorOpen(body.latest(), diagnostic.fixture.doorId!),
    'button-door-heldout-latch-did-not-remain-open-200-ticks');
  const reset = await prepareButtonDoorFixture(commands, body, specification, yawOffsetDegrees, false);
  let stable = 0;
  for (let tick = 0; tick < 200; tick++) {
    const observation = body.latest();
    const ready = observation.objects.some(value => value.id === reset.fixture.buttonId
      && value.type === 'stone_button') && observation.objects.some(value => value.id === reset.fixture.doorId
        && value.type === 'iron_door' && value.properties.open === false);
    stable = ready ? stable + 1 : 0;
    if (stable >= 5) return reset;
    await body.waitTicks(1);
  }
  throw new Error('button-door-heldout-five-tick-public-readiness-failed');
}

export interface MinecraftHierarchicalButtonDoorLiveResultV1 {
  readonly version: typeof MINECRAFT_HIERARCHICAL_BUTTON_DOOR_LIVE_V1;
  readonly passed: boolean;
  readonly frozenSnapshotSha256: string;
  readonly negativeQualification: DisconnectedQualificationLiveV1;
  readonly heldout: readonly { readonly caseId: string; readonly status: string;
    readonly actions: number; readonly verified: boolean; readonly baselineHashUnchanged: boolean;
    readonly realButtonDoorEventPassed: boolean;
    readonly frozenPhysicalEvidencePassed: boolean }[];
}

function realButtonDoorHeldoutEventPassed(after: HierarchicalMemorySnapshotV1,
  frozen: HierarchicalMemorySnapshotV1): boolean {
  const old = new Set(frozen.annotations.map(value => value.eventId));
  return after.annotations.filter(value => !old.has(value.eventId)).some(annotation =>
    annotation.cue.kind === 'interact' && annotation.cue.targetRole === 'stone_button'
    && annotation.kernelChanges.flat().some(change => change.subject.startsWith('iron_door#')
      && change.property === 'open' && change.before === false && change.after === true));
}

export async function runMinecraftHierarchicalButtonDoorLiveV1(config: Configuration,
  evidence: string): Promise<MinecraftHierarchicalButtonDoorLiveResultV1> {
  await mkdir(evidence);
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown): void => {
    (kind === 'frame' ? frames : events).write(canonical({ kind, value }) + '\n');
  };
  const plan = minecraftHierarchicalButtonDoorPlanLiveV1();
  await saveJson(resolve(evidence, 'RUN_PROTOCOL.json'), plan);
  const services = new Services(config, resolve(config.runtimeRoot,
    `hierarchical-button-door-live-${Date.now()}`), evidence);
  let trainingBody: MinecraftBody | null = null, trainingCompute: Compute | null = null;
  try {
    await services.start('empty');
    applyMinecraftFixtureCommandBatchLiveV1(services, minecraftMultilevelGuidedGlobalCommandsLiveV1());
    trainingBody = new MinecraftBody({ ...config.minecraft,
      worldId: 'hierarchical-button-door-training-v1',
      sessionId: 'hierarchical-button-door-training-v1' }, record);
    await trainingBody.ready(); await trainingBody.waitTicks(20); trainingCompute = new Compute();
    const trainingCommands = new FixtureCommandBoundaryLiveV1(services);
    const foundationTimeline = [];
    for (const specification of plan.foundation)
      foundationTimeline.push(await executeChain(trainingCompute, trainingCommands, trainingBody,
        specification, false));
    const initialized = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    const foundationR2 = verifyInitializedButtonDoorFoundationLiveV1(initialized,
      foundationTimeline.map(value => value.expectation));
    const foundationEventIds = new Map<ButtonDoorFoundationArmLiveV1, string[]>([
      ['look-acquire', []], ['look-miss', []], ['wired-open', []], ['disconnected-no-open', []],
    ]);
    foundationTimeline.forEach((value, index) =>
      foundationEventIds.get(value.specification.arm)!.push(foundationR2[index]!.eventId));
    const lookCue = cueIdentity({ kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 },
      targetRole: null });
    const interactCue = cueIdentity({ kind: 'interact', parameters: {}, targetRole: 'stone_button' });
    const lookSelection = selectButtonDoorOpaqueInterventionAtBranchLiveV1(initialized,
      foundationEventIds.get('look-acquire')!, foundationEventIds.get('look-miss')!, 0, lookCue);
    const doorSelection = selectButtonDoorOpaqueInterventionAtBranchLiveV1(initialized,
      foundationEventIds.get('wired-open')!, foundationEventIds.get('disconnected-no-open')!, 0,
      interactCue);
    const lookProtocol = await trainingCompute.call<R2AInterventionProtocolV1>(
      'registerMatchedInterventionProtocol', { protocolId: 'button-door-look-acquire-protocol-v1',
        relationId: lookSelection.relationId, changedFactorIds: lookSelection.changedFactorIds,
        formationMatchedPairs: lookSelection.targetMemberEventIds.map((targetEventId, index) => ({
          targetEventId, contrastEventId: lookSelection.contrastMemberEventIds[index]!,
        })) });
    const doorProtocol = await trainingCompute.call<R2AInterventionProtocolV1>(
      'registerMatchedInterventionProtocol', { protocolId: 'button-door-wired-open-protocol-v1',
        relationId: doorSelection.relationId, changedFactorIds: doorSelection.changedFactorIds,
        formationMatchedPairs: doorSelection.targetMemberEventIds.map((targetEventId, index) => ({
          targetEventId, contrastEventId: doorSelection.contrastMemberEventIds[index]!,
        })) });
    const pairs = new Map<string, { target?: string; contrast?: string }>();
    const pairExecutions = new Map<string, { target?: ButtonDoorChainExecutionLiveV1;
      contrast?: ButtonDoorChainExecutionLiveV1 }>();
    const interventionTimeline = [];
    for (const specification of plan.interventions) {
      const value = await executeChain(trainingCompute, trainingCommands, trainingBody, specification, true);
      assert(value.r2Event, 'button-door-intervention-chain-missing-R2-event');
      const key = `${specification.comparison}:${specification.pairIndex}`;
      const pair = pairs.get(key) ?? {};
      const executions = pairExecutions.get(key) ?? {};
      const target = specification.arm === 'look-acquire' || specification.arm === 'wired-open';
      if (target) { pair.target = value.r2Event.eventId; executions.target = value; }
      else { pair.contrast = value.r2Event.eventId; executions.contrast = value; }
      pairs.set(key, pair); pairExecutions.set(key, executions); interventionTimeline.push(value);
      if (pair.target && pair.contrast) {
        if (specification.comparison === 'wired-vs-disconnected') {
          assert(executions.target && executions.contrast,
            'button-door-circuit-pair-execution-missing');
          buttonDoorPublicCircuitDifferenceLiveV1(executions.target.prepared.observation,
            executions.contrast.prepared.observation, circuitIds(specification),
            executions.target.prepared.fixture.buttonId!, executions.target.prepared.fixture.doorId!);
        }
        const selection = specification.comparison === 'look-acquire-vs-miss'
          ? lookSelection : doorSelection;
        const protocol = specification.comparison === 'look-acquire-vs-miss'
          ? lookProtocol : doorProtocol;
        const intervention: R2AInterventionEvidenceV1 = { version: 'R2AInterventionEvidenceV1',
          pairId: `button-door-${key}`, protocolId: protocol.protocolId,
          relationId: selection.relationId, baselineEventId: pair.target,
          interventionEventId: pair.contrast, changedFactorIds: selection.changedFactorIds,
          trustedActualObservation: true };
        await trainingCompute.call('recordMatchedIntervention', intervention);
      }
    }
    assert(pairs.size === 8 && [...pairs.values()].every(value => value.target && value.contrast),
      'button-door-intervention-pairs-incomplete');
    const frozen = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    assert(frozen.annotations.length === 160 && frozen.writes === 160,
      'button-door-frozen-cardinality-invalid');
    for (const selection of [lookSelection, doorSelection]) {
      const relation = frozen.r2a?.relations.find(value => value.relationId === selection.relationId);
      const evidenceSet = relation?.factorSetInterventions.find(value => canonical(value.factorIds)
        === canonical(selection.changedFactorIds));
      assert(relation?.grade === 'intervention-supported' && evidenceSet?.pairIds.length === 4
        && Math.min(...evidenceSet.removalSelectionDrops) >= .25,
      `button-door-intervention-not-production-grade:${selection.relationId}`);
    }
    const negativeSpecification: ButtonDoorChainEpisodeLiveV1 = { episode: 999,
      phase: 'intervention', arm: 'disconnected-no-open', pairIndex: 0,
      comparison: 'wired-vs-disconnected', layout: layout(12, 'intervention') };
    const negativeQualification = await qualifyDisconnectedReadOnly(trainingCompute, trainingCommands,
      trainingBody, negativeSpecification);
    assert(await trainingCompute.call<string>('hash') === sha(frozen),
      'button-door-read-only-qualification-changed-frozen-snapshot');
    await saveJson(resolve(evidence, 'FOUNDATION_TIMELINE.json'), foundationTimeline);
    await saveJson(resolve(evidence, 'FOUNDATION_R2.json'), foundationR2);
    await saveJson(resolve(evidence, 'INTERVENTION_TIMELINE.json'), interventionTimeline);
    await saveJson(resolve(evidence, 'FROZEN_HIERARCHICAL_EXPERIENCE.json'), frozen);
    await saveJson(resolve(evidence, 'DISCONNECTED_READ_ONLY_QUALIFICATION.json'), negativeQualification);
    const baselineDirectory = resolve(evidence, 'frozen-baseline'); await mkdir(baselineDirectory);
    await saveExperienceBundleV1(baselineDirectory, frozen,
      { actions: 0, eventCount: 160, writes: 160 }, new ControlHabitWeightsV1());
    const pointerPath = resolve(baselineDirectory, 'EXPERIENCE_LATEST.json');
    const baselineSnapshotPath = resolve(baselineDirectory, 'experience-0160.json');
    const baselineBefore = await fileSha(baselineSnapshotPath);
    await trainingBody.close(); trainingBody = null; await trainingCompute.close(); trainingCompute = null;

    const heldout = [];
    for (const heldoutCase of MINECRAFT_HIERARCHICAL_BUTTON_DOOR_HELDOUTS_LIVE_V1) {
      const caseEvidence = resolve(evidence, heldoutCase.caseId); await mkdir(caseEvidence);
      const compute = new Compute(); const restored = await restoreExperience(compute, pointerPath);
      assert(restored, 'button-door-heldout-baseline-restore-failed');
      const caseRecords: { kind: string; value: unknown }[] = [];
      const caseRecord = (kind: string, value: unknown) => {
        const copy = structuredClone(value); if (kind === 'joint-control-decision'
          || kind === 'control-action-result') caseRecords.push({ kind, value: copy });
        record(kind, { caseId: heldoutCase.caseId, value: copy });
      };
      const body = new MinecraftBody({ ...config.minecraft, worldId: heldoutCase.caseId,
        sessionId: heldoutCase.caseId, activeSecondsOffset: frozen.activeSeconds }, caseRecord);
      let runtime: V5Runtime | null = null;
      try {
        await body.ready();
        // A newly connected real client is not action-ready merely because its
        // first public frame arrived.  Use the same proven connection settling
        // interval as the underlying real redstone fixture verification.
        await body.waitTicks(BUTTON_DOOR_NEW_BODY_SETTLE_TICKS_LIVE_V1);
        const caseCommands = new FixtureCommandBoundaryLiveV1(services);
        const specification: ButtonDoorChainEpisodeLiveV1 = { episode: 1000,
          phase: 'intervention', arm: 'wired-open', pairIndex: 0,
          comparison: 'wired-vs-disconnected', layout: heldoutCase.layout };
        const prepared = await preverifyAndResetHeldoutFixture(caseCommands, body, specification,
          heldoutCase.yawOffsetDegrees);
        const goal: GroundedGoalV1 = ironDoorOpenGoalV1(heldoutCase.caseId, prepared.fixture.doorId!);
        runtime = new V5Runtime(body, { ...config, actionBudget: heldoutCase.actionBudget },
          caseEvidence, caseRecord, { compute, restoredExperience: restored,
            habit: new ControlHabitWeightsV1() });
        // This is the last fixture-side statement before control begins. No
        // service command or fixture mutation is reachable after injection.
        const fixtureCommandCountAtGoal = caseCommands.seal();
        caseRecord('hierarchical-button-door-root-goal-injection', goal);
        const result = await runtime.runGoal(goal);
        const first = body.latest(); await body.waitTicks(5); const second = body.latest();
        const verified = doorOpen(first, prepared.fixture.doorId!)
          && doorOpen(second, prepared.fixture.doorId!) && second.sequence - first.sequence >= 5;
        await runtime.save();
        assert(caseCommands.count === fixtureCommandCountAtGoal,
          'button-door-fixture-command-count-changed-after-goal');
        const physicalEvidence = auditFrozenPhysicalActionEvidenceLiveV1(caseRecords, frozen);
        const after = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
        const realButtonDoorEventPassed = realButtonDoorHeldoutEventPassed(after, frozen);
        assert(realButtonDoorEventPassed,
          'button-door-heldout-missing-real-interact-door-transition-event');
        await saveJson(resolve(caseEvidence, 'FROZEN_PHYSICAL_ACTION_EVIDENCE_AUDIT.json'),
          physicalEvidence);
        heldout.push({ caseId: heldoutCase.caseId, status: result.status,
          actions: result.actions, verified,
          baselineHashUnchanged: await fileSha(baselineSnapshotPath) === baselineBefore,
          realButtonDoorEventPassed,
          frozenPhysicalEvidencePassed: physicalEvidence.passed });
      } finally {
        if (runtime) await runtime.close(); else { await body.close(); await compute.close(); }
      }
    }
    const result: MinecraftHierarchicalButtonDoorLiveResultV1 = {
      version: MINECRAFT_HIERARCHICAL_BUTTON_DOOR_LIVE_V1,
      passed: heldout.length === 4 && heldout.every(value => value.status === 'goal-verified'
        && value.verified && value.baselineHashUnchanged && value.realButtonDoorEventPassed
        && value.frozenPhysicalEvidencePassed),
      frozenSnapshotSha256: sha(frozen), negativeQualification, heldout };
    await saveJson(resolve(evidence, 'RESULT.json'), result);
    assert(result.passed, 'hierarchical-button-door-live-batch-failed');
    return result;
  } catch (error) {
    const failure = error as Error;
    await saveJson(resolve(evidence, 'RUN_FAILURE.json'), { version: 'ButtonDoorFailureV1',
      message: failure.message, name: failure.name, stack: failure.stack ?? null,
      planSha256: sha(plan), retryCount: 0 });
    throw error;
  } finally {
    await trainingBody?.close(); await trainingCompute?.close(); await services.stop();
    await Promise.all([new Promise<void>(done => events.end(done)),
      new Promise<void>(done => frames.end(done))]);
  }
}
