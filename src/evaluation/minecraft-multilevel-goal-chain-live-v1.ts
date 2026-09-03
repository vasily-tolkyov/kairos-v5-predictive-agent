import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Vec3 } from 'vec3';
import type { Action, ActionCue, BodyResult, Observation, PrimitiveKind, PublicChange,
  PublicValue } from '../contracts.js';
import { MinecraftBody, publicBlockSelectionShapesV1 } from '../body.js';
import { Compute } from '../compute.js';
import type { MemorySnapshot } from '../memory.js';
import { V5Runtime, type ExperiencePointer, type RestoredExperience } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import { PUBLIC_LAYOUT_SEMANTICS } from '../public-context.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { dependencyDepthV2, type PhysicalControlSnapshotV2 } from '../control/controller.js';
import { GroundedGoalEvaluatorV1 } from '../control/goal.js';
import type { ActionObservationScopeV1, ConditionApplicabilityV1,
  GoalPredicateV1, GroundedGoalV1, PhysicalEvidenceReferenceV1 } from '../control/contracts.js';
import type { LegacyBranchPredictionV1 as BranchPredictionV1,
  LegacyEffectRecallCandidateV1 as EffectRecallCandidateV1,
  LegacyOpaqueFactorTransitionTraceV1 as OpaqueFactorTransitionTraceV1 }
  from '../legacy/audit-control-contracts.js';
import { cueIdentity } from '../events.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import {
  MULTILEVEL_ABLATION_CONTRACT_V1,
  MULTILEVEL_ABLATIONS_V1,
  MULTILEVEL_GUIDED_MODES_V1,
  RecordingMultilevelGoalChainFixtureV1,
  auditMinecraftMultilevelGoalChainProtocolV1,
  foundationQualificationCasesV1,
  ironDoorOpenGoalV1,
  minecraftMultilevelGoalChainCasesV1,
  minecraftMultilevelGoalChainPerturbationsV1,
  scoreFoundationQualificationV1,
  scoreMultilevelAblationsV1,
  scoreMultilevelGoalChainCaseV1,
  type FoundationQualificationCaseV1,
  type FoundationQualificationEvidenceV1,
  type FoundationQualificationScoreV1,
  type GoalChainCaseEvidenceV1,
  type GoalChainCaseScoreV1,
  type GoalChainPerturbationV1,
  type MultilevelAblationScoreV1,
  type MultilevelAblationV1,
  type MultilevelDiagnosticBatchV1,
  type MultilevelGoalChainCaseV1,
  type RealNonObserveActionTriggerV1,
  type RealPublicStateMilestoneV1,
} from './minecraft-multilevel-goal-chain-v1.js';
import { FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1,
  applyMinecraftFixtureCommandBatchLiveV1,
  frozenMultilevelExperienceIdentityLiveV1,
  minecraftMultilevelGuidedFixtureCommandsLiveV1,
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedFixtureInitialViewLiveV1,
  minecraftMultilevelGuidedFixtureReadinessLiveV1,
  type MinecraftMultilevelGuidedFixtureGeometryLiveV1,
  type MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
} from './minecraft-multilevel-guided-training-live-v1.js';
export { FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1 } from
  './minecraft-multilevel-guided-training-live-v1.js';

export interface FrozenMultilevelExperienceV1 {
  readonly path: string;
  readonly fileSha256: string;
  readonly snapshotSha256: string;
  readonly snapshot: MemorySnapshot;
  readonly sourceAnnotationEventIds: ReadonlySet<string>;
  readonly sourceRelationIds: ReadonlySet<string>;
  readonly sourceFactorIds: ReadonlySet<string>;
}

/** A baseline identity is learned evidence, never a mutable evaluation checkpoint. */
export async function readFrozenMultilevelExperienceV1(path: string,
  expectedFileSha256?: string): Promise<FrozenMultilevelExperienceV1> {
  assert(basename(path) === FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1,
    'multilevel-baseline-filename-is-not-frozen-0256');
  const fileSha256 = await fileSha(path);
  if (expectedFileSha256 !== undefined)
    assert(fileSha256 === expectedFileSha256, `multilevel-baseline-file-identity-mismatch:${fileSha256}`);
  const snapshot = JSON.parse(await readFile(path, 'utf8')) as MemorySnapshot;
  const identity = frozenMultilevelExperienceIdentityLiveV1(snapshot);
  const graph = snapshot.r2a;
  assert(graph !== null, 'multilevel-baseline-r2a-missing-after-identity-check');
  return { path, fileSha256, snapshotSha256: identity.snapshotSha256, snapshot,
    sourceAnnotationEventIds: new Set(snapshot.annotations.map(value => value.eventId)),
    sourceRelationIds: new Set(graph.hyperedges.map(value => value.hyperedgeId)),
    sourceFactorIds: new Set(graph.factorNodes.map(value => value.factorId)) };
}

type AbsoluteBlockPositionV1 = readonly [number, number, number];

function blockId(position: AbsoluteBlockPositionV1): string {
  return `block:${position.join(',')}`;
}

function fixturePosition(specification: MultilevelGoalChainCaseV1,
  role: MultilevelGoalChainCaseV1['fixture']['components'][number]['role']): AbsoluteBlockPositionV1 {
  const component = specification.fixture.components.find(value => value.role === role);
  assert(component, `multilevel-fixture-component-missing:${specification.id}:${role}`);
  return [specification.fixture.origin[0] + component.relativePosition[0],
    specification.fixture.origin[1] + component.relativePosition[1],
    specification.fixture.origin[2] + component.relativePosition[2]];
}

/** Resolve the precommitted symbolic target onto the public ID emitted by MinecraftBody. */
export function materializeLiveGoalChainCaseV1(
  specification: MultilevelGoalChainCaseV1,
): MultilevelGoalChainCaseV1 {
  const doorObjectId = blockId(fixturePosition(specification, 'door'));
  return { ...structuredClone(specification), doorObjectId,
    rootGoal: ironDoorOpenGoalV1(specification.id, doorObjectId) };
}

export interface UniqueButtonDoorReadinessV1 {
  readonly ready: boolean;
  readonly firstSequence: number | null;
  readonly currentSequence: number;
  readonly buttonId: string | null;
  readonly doorId: string | null;
  readonly stableTicks: number;
  readonly commandBlocksObserved: number;
  readonly reason: 'waiting' | 'ready' | 'ambiguous-or-hidden' | 'command-block-visible';
}

/** Goal injection is permitted only after one unchanged public button/lower-door pair. */
export class UniqueButtonDoorReadinessGateV1 {
  #firstSequence: number | null = null;
  #previousSequence: number | null = null;
  #stableTicks = 0;

  constructor(readonly expectedButtonId: string, readonly expectedDoorId: string) {}

  accept(observation: Observation): UniqueButtonDoorReadinessV1 {
    const commandBlocks = observation.objects.filter(value =>
      ['command_block', 'chain_command_block', 'repeating_command_block'].includes(value.type));
    const buttons = observation.objects.filter(value => value.type === 'stone_button');
    const doors = observation.objects.filter(value => value.type === 'iron_door'
      && value.properties.half === 'lower');
    const exact = buttons.length === 1 && doors.length === 1
      && buttons[0]!.id === this.expectedButtonId && doors[0]!.id === this.expectedDoorId
      && doors[0]!.properties.open === false;
    if (commandBlocks.length > 0 || !exact) {
      this.#firstSequence = null; this.#previousSequence = observation.sequence; this.#stableTicks = 0;
      return { ready: false, firstSequence: null, currentSequence: observation.sequence,
        buttonId: buttons[0]?.id ?? null, doorId: doors[0]?.id ?? null, stableTicks: 0,
        commandBlocksObserved: commandBlocks.length,
        reason: commandBlocks.length > 0 ? 'command-block-visible' : 'ambiguous-or-hidden' };
    }
    if (this.#previousSequence === null || observation.sequence !== this.#previousSequence + 1) {
      this.#firstSequence = observation.sequence; this.#stableTicks = 0;
    } else {
      this.#firstSequence ??= observation.sequence - 1; this.#stableTicks++;
    }
    this.#previousSequence = observation.sequence;
    const ready = this.#stableTicks >= 5;
    return { ready, firstSequence: this.#firstSequence, currentSequence: observation.sequence,
      buttonId: buttons[0]!.id, doorId: doors[0]!.id, stableTicks: this.#stableTicks,
      commandBlocksObserved: 0, reason: ready ? 'ready' : 'waiting' };
  }
}

interface EvidenceRecordV1 { readonly kind: string; readonly value: unknown }

class PreGoalFixtureCommandPortV1 {
  #sealed = false;
  readonly commands: string[] = [];
  constructor(readonly services: Services, readonly record: (kind: string, value: unknown) => void) {}
  command(command: string): void {
    assert(!this.#sealed, 'post-goal-fixture-command-rejected');
    this.commands.push(command); this.record('multilevel-fixture-command', { phase: 'before-goal', command });
    this.services.command(command);
  }
  seal(): void { assert(!this.#sealed, 'goal-injection-already-recorded'); this.#sealed = true; }
  get sealed(): boolean { return this.#sealed; }
}

export interface VanillaLatchPreflightV1 {
  readonly pulseExecuted: boolean;
  readonly firstOpenSequence: number;
  readonly heldOpenSequence: number;
  readonly heldRealTicks: number;
  readonly containerPresentAtStart: boolean;
  readonly containerPresentAfterHold: boolean;
  readonly comparatorPoweredAtStart: boolean;
  readonly comparatorPoweredAfterHold: boolean;
  readonly repeaterPoweredAtStart: boolean;
  readonly repeaterPoweredAfterHold: boolean;
  readonly doorOpenAtStart: boolean;
  readonly doorOpenAfterHold: boolean;
}

function blockProperties(body: MinecraftBody, position: AbsoluteBlockPositionV1,
  expectedName: string): Readonly<Record<string, PublicValue>> {
  const block = body.bot.blockAt(new Vec3(...position));
  assert(block?.name === expectedName, `fixture-real-block-missing:${expectedName}:${position.join(',')}`);
  return block.getProperties() as Readonly<Record<string, PublicValue>>;
}

async function aimAt(body: MinecraftBody, position: readonly [number, number, number],
  yawOffsetDegrees = 0): Promise<void> {
  const eye = body.bot.entity.position.offset(0, 1.62, 0);
  const target = new Vec3(position[0], position[1], position[2]);
  const delta = target.minus(eye);
  const yaw = Math.atan2(-delta.x, -delta.z) + yawOffsetDegrees * Math.PI / 180;
  const pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  await body.bot.look(yaw, pitch, true); await body.waitTicks(2);
}

/**
 * Use the same public selection geometry as MinecraftBody's visibility and
 * interaction ray. In 1.21.4 a vanilla button has no collision shape, so
 * reading `block.shapes` here would reject a genuinely visible target.
 */
export function publicSelectionAimPointLiveV1(position: AbsoluteBlockPositionV1,
  block: Parameters<typeof publicBlockSelectionShapesV1>[0]): readonly [number, number, number] {
  const shape = publicBlockSelectionShapesV1(block)[0];
  assert(shape, `fixture-public-selection-shape-missing:${block.name}:${position.join(',')}`);
  return [position[0] + (shape[0]! + shape[3]!) / 2,
    position[1] + (shape[1]! + shape[4]!) / 2,
    position[2] + (shape[2]! + shape[5]!) / 2];
}

async function aimAtBlockShape(body: MinecraftBody, position: AbsoluteBlockPositionV1,
  expectedName: string, yawOffsetDegrees = 0): Promise<void> {
  let block = body.bot.blockAt(new Vec3(...position));
  for (let tick = 0; (block?.name !== expectedName
    || publicBlockSelectionShapesV1(block).length === 0) && tick < 40; tick++) {
    await body.waitTicks(1); block = body.bot.blockAt(new Vec3(...position));
  }
  assert(block?.name === expectedName && publicBlockSelectionShapesV1(block).length > 0,
    `fixture-public-shape-missing:${expectedName}:${position.join(',')}`);
  await aimAt(body, publicSelectionAimPointLiveV1(position, block), yawOffsetDegrees);
}

export type GoalChainObstacleGeometryLiveV1 =
  | { readonly kind: 'open-approach'; readonly commands: readonly string[] }
  | { readonly kind: 'one-block-low'; readonly position: AbsoluteBlockPositionV1;
      readonly heightBlocks: 1; readonly overheadClear: true; readonly commands: readonly string[] }
  | { readonly kind: 'mirrored-high-side-route'; readonly openSide: 'left' | 'right';
      readonly centralBarrier: { readonly from: AbsoluteBlockPositionV1;
        readonly to: AbsoluteBlockPositionV1; readonly block: 'iron_bars'; readonly heightBlocks: 3 };
      readonly blockedSideBarrier: { readonly side: 'left' | 'right';
        readonly from: AbsoluteBlockPositionV1; readonly to: AbsoluteBlockPositionV1 };
      readonly commands: readonly string[] };

/** Static fixture geometry only; none of these facts are sent to the controller. */
export function goalChainObstacleGeometryLiveV1(
  specification: MultilevelGoalChainCaseV1,
): GoalChainObstacleGeometryLiveV1 {
  const [x, y, z] = specification.fixture.origin;
  if (specification.tier === 'A') return { kind: 'open-approach', commands: [] };
  if (specification.tier === 'B') {
    // Feet stand at y. A one-block obstacle therefore occupies exactly y,
    // while y+1 and above remain real public headroom.
    const position = [x, y, z + 6] as const;
    return { kind: 'one-block-low', position, heightBlocks: 1, overheadClear: true,
      commands: [`setblock ${position.join(' ')} minecraft:smooth_stone`] };
  }
  const ordinal = Number(specification.id.slice(-2));
  const openRight = ordinal % 2 === 1;
  // Three stacked iron-bar blocks stop the body but retain narrow real ray
  // gaps, so the public button/door can remain observable. A solid wall on
  // the opposite side leaves exactly one nearby lateral route.
  const centralFrom = [x - 2, y, z + 6] as const;
  const centralTo = [x + 2, y + 2, z + 6] as const;
  const blockedX = x + (openRight ? -3 : 3);
  const blockedFrom = [blockedX, y, z + 5] as const;
  const blockedTo = [blockedX, y + 2, z + 8] as const;
  return { kind: 'mirrored-high-side-route', openSide: openRight ? 'right' : 'left',
    centralBarrier: { from: centralFrom, to: centralTo, block: 'iron_bars', heightBlocks: 3 },
    blockedSideBarrier: { side: openRight ? 'left' : 'right', from: blockedFrom, to: blockedTo },
    commands: [`fill ${centralFrom.join(' ')} ${centralTo.join(' ')} minecraft:iron_bars`,
      `fill ${blockedFrom.join(' ')} ${blockedTo.join(' ')} minecraft:stone_bricks`] };
}

function obstacleCommands(specification: MultilevelGoalChainCaseV1): readonly string[] {
  return goalChainObstacleGeometryLiveV1(specification).commands;
}

/**
 * Exact translated form of the command-block-free run-004 latch. The fixed
 * north-facing signal path is the same physical circuit, not a new rule or a
 * script callback: button -> one-item dropper -> barrel -> comparator -> dust
 * -> west-facing one-tick repeater -> iron door.
 */
export function goalChainLatchFixtureCommandsLiveV1(
  specification: MultilevelGoalChainCaseV1,
): readonly string[] {
  const [x, y, z] = specification.fixture.origin;
  const button = fixturePosition(specification, 'button');
  const dropper = fixturePosition(specification, 'dropper');
  const container = fixturePosition(specification, 'container');
  const comparator = fixturePosition(specification, 'comparator');
  const wire = fixturePosition(specification, 'wire');
  const repeater = fixturePosition(specification, 'repeater');
  const door = fixturePosition(specification, 'door');
  const supports = [dropper, container, comparator, wire, repeater, door]
    .map(position => [position[0], position[1] - 1, position[2]] as const);
  assert(specification.fixture.facing === 'north' && specification.fixture.outputSide === 'right',
    'goal-chain-latch-orientation-is-not-the-proven-contract');
  return [
    `fill ${x - 7} ${y} ${z - 2} ${x + 7} ${y + 6} ${z + 12} air`,
    `fill ${x - 7} ${y - 1} ${z - 2} ${x + 7} ${y - 1} ${z + 12} minecraft:smooth_stone`,
    ...supports.map(position => `setblock ${position.join(' ')} minecraft:smooth_stone`),
    `setblock ${dropper.join(' ')} minecraft:dropper[facing=north,triggered=false]`
      + '{Items:[{Slot:0b,id:"minecraft:cobblestone",count:1}]}',
    `setblock ${container.join(' ')} minecraft:barrel[facing=north,open=false]`,
    `setblock ${button.join(' ')} minecraft:stone_button[face=wall,facing=south,powered=false]`,
    `setblock ${comparator.join(' ')} minecraft:comparator[facing=south,mode=compare,powered=false]`,
    `setblock ${wire.join(' ')} minecraft:redstone_wire`,
    `setblock ${repeater.join(' ')} minecraft:repeater[delay=1,facing=west,locked=false,powered=false]`,
    `setblock ${door.join(' ')} minecraft:iron_door[facing=north,half=lower,hinge=left,open=false,powered=false]`,
    `setblock ${door[0]} ${door[1] + 1} ${door[2]} minecraft:iron_door[facing=north,half=upper,hinge=left,open=false,powered=false]`,
    ...obstacleCommands(specification),
  ];
}

function configureLatchFixtureCommandsV1(port: PreGoalFixtureCommandPortV1,
  specification: MultilevelGoalChainCaseV1): void {
  for (const command of goalChainLatchFixtureCommandsLiveV1(specification)) port.command(command);
}

export function goalChainCaseInitialPositionLiveV1(
  specification: MultilevelGoalChainCaseV1,
): readonly [number, number, number] {
  const [x, y, z] = specification.fixture.origin;
  const ordinal = Number(specification.id.slice(-2));
  const mirror = ordinal % 2 === 1 ? 1 : -1;
  // Button outline centre is z+5.0625. With lateral 3.8 the horizontal
  // distance is 4.516.. and the full eye ray is about 4.65 blocks (outside
  // interaction range), while the lower door still intersects the body's
  // eight-block public ray fan.
  if (specification.tier === 'A') return [x + .5 + mirror * 3.8, y, z + 7.5];
  if (specification.tier === 'B') return [x + .5, y, z + 7.5];
  // A slight sub-block offset avoids aiming through the centre post of the
  // iron-bar barrier; it is fixture geometry, not an R1 coordinate mapping.
  return [x + .1, y, z + 7.5];
}

async function waitForUniqueFixtureReadinessV1(body: MinecraftBody, buttonId: string,
  doorId: string): Promise<UniqueButtonDoorReadinessV1> {
  const gate = new UniqueButtonDoorReadinessGateV1(buttonId, doorId);
  let result = gate.accept(body.latest());
  for (let tick = 0; !result.ready && tick < 200; tick++) {
    await body.waitTicks(1); result = gate.accept(body.latest());
  }
  return result;
}

async function pulseAndVerifyVanillaLatchV1(body: MinecraftBody,
  specification: MultilevelGoalChainCaseV1): Promise<VanillaLatchPreflightV1> {
  const buttonPosition = fixturePosition(specification, 'button');
  const doorPosition = fixturePosition(specification, 'door');
  const containerPosition = fixturePosition(specification, 'container');
  const comparatorPosition = fixturePosition(specification, 'comparator');
  const repeaterPosition = fixturePosition(specification, 'repeater');
  await aimAtBlockShape(body, buttonPosition, 'stone_button');
  let observation = body.latest();
  const buttonId = blockId(buttonPosition);
  assert(observation.targetId === buttonId, 'vanilla-latch-preflight-button-not-on-crosshair');
  const pulse = await body.execute({ kind: 'interact', parameters: {}, targetId: buttonId });
  assert(pulse.result.executed, 'vanilla-latch-preflight-pulse-not-executed');
  await aimAt(body, [doorPosition[0] + .5, doorPosition[1] + 1, doorPosition[2] + .5]);
  for (let tick = 0; blockProperties(body, doorPosition, 'iron_door').open !== true && tick < 40; tick++)
    await body.waitTicks(1);
  observation = body.latest();
  const firstOpenSequence = observation.sequence;
  const doorOpenAtStart = blockProperties(body, doorPosition, 'iron_door').open === true;
  blockProperties(body, containerPosition, 'barrel');
  const containerPresentAtStart = true;
  const comparatorPoweredAtStart = blockProperties(body, comparatorPosition, 'comparator').powered === true;
  const repeaterPoweredAtStart = blockProperties(body, repeaterPosition, 'repeater').powered === true;
  assert(doorOpenAtStart && comparatorPoweredAtStart && repeaterPoweredAtStart,
    'vanilla-container-latch-did-not-open-from-real-button-pulse');
  await body.waitTicks(200);
  const heldOpenSequence = body.latest().sequence;
  const doorOpenAfterHold = blockProperties(body, doorPosition, 'iron_door').open === true;
  blockProperties(body, containerPosition, 'barrel');
  const containerPresentAfterHold = true;
  const comparatorPoweredAfterHold = blockProperties(body, comparatorPosition, 'comparator').powered === true;
  const repeaterPoweredAfterHold = blockProperties(body, repeaterPosition, 'repeater').powered === true;
  assert(heldOpenSequence - firstOpenSequence >= 200 && doorOpenAfterHold
    && comparatorPoweredAfterHold && repeaterPoweredAfterHold,
  'vanilla-container-comparator-latch-did-not-hold-for-200-real-ticks');
  return { pulseExecuted: true, firstOpenSequence, heldOpenSequence,
    heldRealTicks: heldOpenSequence - firstOpenSequence, containerPresentAtStart,
    containerPresentAfterHold, comparatorPoweredAtStart, comparatorPoweredAfterHold,
    repeaterPoweredAtStart, repeaterPoweredAfterHold, doorOpenAtStart, doorOpenAfterHold };
}

function isNonObserveKind(kind: PrimitiveKind): kind is Exclude<PrimitiveKind, 'observe' | 'wait'> {
  return kind !== 'observe' && kind !== 'wait';
}

/** The only post-injection world intervention is the exact precommitted C01/C02 yaw. */
class PerturbedGoalChainBodyV1 extends MinecraftBody {
  #armed = false;
  #completedNonObserveActions = 0;
  #perturbationApplied = false;
  constructor(configuration: ConstructorParameters<typeof MinecraftBody>[0],
    record: ConstructorParameters<typeof MinecraftBody>[1],
    readonly fixtureRecorder: RecordingMultilevelGoalChainFixtureV1,
    readonly perturbation: GoalChainPerturbationV1 | null) { super(configuration, record); }

  armPostGoalPerturbation(): void {
    assert(!this.#armed, 'post-goal-perturbation-already-armed');
    this.#armed = true; this.#completedNonObserveActions = 0;
  }

  override async execute(action: Action, observationScope?: ActionObservationScopeV1):
    Promise<{ result: BodyResult; event: import('../contracts.js').RealEvent | null }> {
    const execution = await super.execute(action, observationScope);
    if (this.#armed && execution.result.executed && isNonObserveKind(action.kind))
      this.#completedNonObserveActions++;
    if (this.#armed && !this.#perturbationApplied && this.perturbation && execution.result.executed
      && isNonObserveKind(action.kind) && this.#completedNonObserveActions === 1) {
      assert(execution.event, 'precommitted-perturbation-trigger-has-no-real-event');
      this.#perturbationApplied = true;
      const trigger: RealNonObserveActionTriggerV1 = { source: 'real-body-result',
        eventId: execution.event.id, actionKind: action.kind, executed: true,
        completedNonObserveActionOrdinal: 1 };
      this.fixtureRecorder.recordPrecommittedPerturbation(this.perturbation.id, trigger);
      const beforeSequence = this.latest().sequence;
      await this.bot.look(this.bot.entity.yaw + this.perturbation.yawDegrees * Math.PI / 180,
        this.bot.entity.pitch, true);
      await this.waitTicks(25);
      this.record('multilevel-precommitted-public-yaw-deviation', {
        perturbationId: this.perturbation.id, yawDegrees: this.perturbation.yawDegrees,
        trigger, beforeSequence, afterSequence: this.latest().sequence,
      });
    }
    return execution;
  }
}

export interface MultilevelRunnerBoundaryFlagsV1 {
  readonly dependencyExpansionEnabled: boolean;
  readonly r2aConnectedToControl: boolean;
  readonly predictionCloneProgressGateEnabled: boolean;
  readonly attentionDeviationInputEnabled: boolean;
}

export function multilevelRunnerBoundaryFlagsV1(
  variant: 'full-system' | MultilevelAblationV1,
): MultilevelRunnerBoundaryFlagsV1 {
  return { dependencyExpansionEnabled: variant !== 'dependency-expansion-disabled',
    r2aConnectedToControl: variant !== 'r2a-isolated',
    predictionCloneProgressGateEnabled: variant !== 'prediction-clone-progress-gate-disabled',
    attentionDeviationInputEnabled: variant !== 'attention-deviation-input-disabled' };
}

class BoundaryVariantComputeV1 extends Compute {
  constructor(readonly flags: MultilevelRunnerBoundaryFlagsV1) { super(); }
  override async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const value = await super.call<unknown>(method, ...args);
    if (method === 'recallFactorTransition' && !this.flags.dependencyExpansionEnabled)
      return [] as T;
    if (method === 'recallByEffect' && !this.flags.r2aConnectedToControl) {
      return (value as readonly EffectRecallCandidateV1[]).map(candidate => ({ ...candidate,
        evidence: { ...candidate.evidence,
          r2a: { relationIds: [], applicability: 0, productionEligible: false } } })) as T;
    }
    if (method === 'compareConditions' && !this.flags.r2aConnectedToControl) {
      return { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
        applicability: 0, productionEligible: false } as T;
    }
    if (method === 'predictCandidate') {
      let prediction = value as BranchPredictionV1;
      if (!this.flags.r2aConnectedToControl) {
        const evidence = prediction.currentEvidence;
        prediction = { ...prediction,
          ...(evidence ? { currentEvidence: { ...evidence,
            r2a: { relationIds: [], applicability: 0, productionEligible: false } } } : {}),
          prediction: { ...prediction.prediction, support: 0, samples: [] },
          validSampleCount: 0, progressSampleCount: 0, progressFraction: 0,
          nextStates: [], unknown: [...prediction.unknown, 'runner-boundary-r2a-isolated'] };
      } else if (!this.flags.predictionCloneProgressGateEnabled) {
        prediction = { ...prediction,
          progressSampleCount: Math.max(1, prediction.nextStates.length), progressFraction: 1,
          nextStates: prediction.nextStates.map(state => ({ ...state,
            knownActiveFactorIds: [...new Set([...state.knownActiveFactorIds,
              ...state.unknownFactorIds])].sort(), unknownFactorIds: [] })) };
      }
      return prediction as T;
    }
    return value as T;
  }
}

function removeRuntimeAttentionFrameInputV1(body: MinecraftBody,
  listenersBeforeRuntime: ReadonlySet<(...args: unknown[]) => void>): number {
  const added = body.listeners('frame').filter(listener =>
    !listenersBeforeRuntime.has(listener as (...args: unknown[]) => void));
  for (const listener of added) body.off('frame', listener as (...args: unknown[]) => void);
  return added.length;
}

async function makeCaseLocalRestoredExperienceV1(baseline: FrozenMultilevelExperienceV1,
  compute: Compute): Promise<RestoredExperience> {
  const snapshot = structuredClone(baseline.snapshot);
  await compute.call('restore', snapshot);
  const pointer: ExperiencePointer = { runtimeVersion: 'KairosV5PhysicalControlRuntimeV1',
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename: basename(baseline.path),
    sha256: baseline.snapshotSha256, actions: 0, eventCount: snapshot.seenEventIds.length,
    writes: snapshot.writes };
  return { pointerPath: baseline.path, snapshotPath: baseline.path, habitPath: null,
    pointer, snapshot, habit: new ControlHabitWeightsV1() };
}

function milestone(observation: Observation, objectId: string, objectType: string,
  observable: string, value: PublicValue): RealPublicStateMilestoneV1 {
  return { source: 'real-public-observation', sequence: observation.sequence,
    objectId, objectType, observable, value };
}

class DoorStateRecorderV1 {
  readonly states: RealPublicStateMilestoneV1[] = [];
  #lastValue: PublicValue | undefined;
  #firstOpenSequence: number | null = null;
  #confirmed = false;
  readonly listener = (observation: Observation): void => { this.accept(observation); };
  constructor(readonly objectId: string,
    readonly fixture: RecordingMultilevelGoalChainFixtureV1) {}
  accept(observation: Observation): void {
    const door = observation.objects.find(value => value.id === this.objectId
      && value.type === 'iron_door' && value.properties.half === 'lower');
    if (!door) return;
    const value = door.properties.open;
    const confirmation = value === true && this.#firstOpenSequence !== null
      && observation.sequence >= this.#firstOpenSequence + 5 && !this.#confirmed;
    if (value === this.#lastValue && !confirmation) return;
    const state = milestone(observation, door.id, door.type, 'properties.open', value ?? null);
    this.states.push(state); this.fixture.recordRealObservation(state); this.#lastValue = value;
    if (value === true && this.#firstOpenSequence === null) this.#firstOpenSequence = observation.sequence;
    if (confirmation) this.#confirmed = true;
  }
}

export interface GoalChainExecutedActionEvidenceV1 {
  readonly ordinal: number;
  readonly action: Action;
  readonly eventId: string | null;
  readonly nodeId: string | null;
  readonly dependencyDepth: number;
  readonly rootNodeId: string | null;
  readonly rootRetained: boolean;
  readonly decisionObservationSequence: number | null;
  readonly conditionObservationSequence: number | null;
  readonly predictionObservationSequence: number | null;
  readonly conditionFresh: boolean | null;
  readonly predictionFresh: boolean | null;
  readonly physicalEvidence: PhysicalEvidenceReferenceV1 | null;
  readonly sourceFrozenBaseline: boolean;
  readonly productionRelationIds: readonly string[];
  readonly productionFactorIds: readonly string[];
  readonly predictionClone: {
    readonly validSampleCount: number;
    readonly progressSampleCount: number;
    readonly progressFraction: number;
  } | null;
  readonly factorTransitionIds: readonly string[];
}

function nodePhysicalEvidence(snapshot: PhysicalControlSnapshotV2, nodeId: string | null):
  PhysicalEvidenceReferenceV1 | null {
  const node = snapshot.workspace.nodes.find(value => value.node.nodeId === nodeId);
  if (!node || (node.node.kind !== 'experienced' && node.node.kind !== 'factor-transition')) return null;
  return node.node.kind === 'experienced' ? node.node.candidate.evidence : node.node.transition.evidence;
}

/** Extract evidence from the controller's actual selected node; never infer an expected action path. */
export function extractGoalChainExecutedActionEvidenceV1(records: readonly EvidenceRecordV1[],
  baseline: Pick<FrozenMultilevelExperienceV1, 'snapshot' | 'sourceAnnotationEventIds'
    | 'sourceRelationIds' | 'sourceFactorIds'>,
  expectedRootGoalId: string): readonly GoalChainExecutedActionEvidenceV1[] {
  const relationById = new Map((baseline.snapshot.r2a?.hyperedges ?? [])
    .map(value => [value.hyperedgeId, value]));
  const rows: GoalChainExecutedActionEvidenceV1[] = [];
  let latestDecision: PhysicalControlSnapshotV2 | null = null;
  for (const record of records) {
    if (record.kind === 'joint-control-decision') latestDecision = record.value as PhysicalControlSnapshotV2;
    if (record.kind !== 'control-action-result') continue;
    const value = record.value as { offer?: { action?: Action }; result?: {
      executed?: boolean; eventId?: string | null } };
    const action = value.offer?.action;
    if (!action || !value.result?.executed || !isNonObserveKind(action.kind)) continue;
    const snapshot = latestDecision;
    const nodeId = snapshot?.lastDecision?.nodeId ?? null;
    const node = snapshot?.workspace.nodes.find(item => item.node.nodeId === nodeId);
    const physicalEvidence = snapshot ? nodePhysicalEvidence(snapshot, nodeId) : null;
    const relationIds = physicalEvidence?.r2a.relationIds ?? [];
    const factors = [...new Set(relationIds.flatMap(id => relationById.get(id)?.factorIds ?? []))].sort();
    const prediction = node?.prediction?.value ?? null;
    const transitions = snapshot?.workspace.nodes.filter(item => item.node.kind === 'factor-transition') ?? [];
    const sourceFrozenBaseline = physicalEvidence !== null
      && baseline.sourceAnnotationEventIds.has(physicalEvidence.eventId)
      && physicalEvidence.r1.active && physicalEvidence.r2.active
      && physicalEvidence.r2a.productionEligible && relationIds.length > 0
      && relationIds.every(id => baseline.sourceRelationIds.has(id))
      && factors.length > 0 && factors.every(id => baseline.sourceFactorIds.has(id));
    const rootNodeId = snapshot?.workspace.rootNodeId ?? null;
    rows.push({ ordinal: rows.length + 1, action: structuredClone(action),
      eventId: value.result.eventId ?? null, nodeId,
      dependencyDepth: snapshot && nodeId ? dependencyDepthV2(nodeId, snapshot.workspace.dependencies) : 0,
      rootNodeId, rootRetained: Boolean(rootNodeId && snapshot?.workspace.goalId === expectedRootGoalId
        && snapshot.workspace.nodes.some(item => item.node.nodeId === rootNodeId
          && item.node.kind === 'root' && item.node.goal.id === expectedRootGoalId)),
      decisionObservationSequence: snapshot?.workspace.observationSequence ?? null,
      conditionObservationSequence: node?.condition?.observationSequence ?? null,
      predictionObservationSequence: node?.prediction?.observationSequence ?? null,
      conditionFresh: node?.condition?.fresh ?? null, predictionFresh: node?.prediction?.fresh ?? null,
      physicalEvidence: physicalEvidence ? structuredClone(physicalEvidence) : null,
      sourceFrozenBaseline, productionRelationIds: [...relationIds].sort(),
      productionFactorIds: factors,
      predictionClone: prediction ? { validSampleCount: prediction.validSampleCount,
        progressSampleCount: prediction.progressSampleCount,
        progressFraction: prediction.progressFraction } : null,
      factorTransitionIds: transitions.map(item => item.node.kind === 'factor-transition'
        ? item.node.transition.transitionId : '').filter(Boolean).sort() });
  }
  return rows;
}

function staleRefusalCount(records: readonly EvidenceRecordV1[]): number {
  return records.filter(record => record.kind === 'control-action-reality-refusal'
    && (record.value as { reason?: string }).reason === 'offer-stale'
    || record.kind === 'control-action-result'
      && (record.value as { result?: { refusal?: string } }).result?.refusal === 'offer-stale').length;
}

function invalidBodyInteractionCount(records: readonly EvidenceRecordV1[]): number {
  return records.filter(record => record.kind === 'control-action-result'
    && (record.value as { offer?: { action?: Action }; result?: { executed?: boolean } })
      .offer?.action?.kind === 'interact'
    && (record.value as { result?: { executed?: boolean } }).result?.executed !== true).length;
}

function attentionEvidence(records: readonly EvidenceRecordV1[]): GoalChainCaseEvidenceV1['attention'] {
  const deviation = records.find(record => record.kind === 'multilevel-precommitted-public-yaw-deviation')
    ?.value as { beforeSequence?: number; afterSequence?: number } | undefined;
  const realDeviationSequence = deviation?.beforeSequence === undefined
    ? null : deviation.beforeSequence + 1;
  const wake = realDeviationSequence === null ? null : records.find(record => {
    if (record.kind !== 'attention-wake') return false;
    const sequence = Number((record.value as { sequence?: number }).sequence);
    return sequence >= realDeviationSequence
      && (deviation?.afterSequence === undefined || sequence <= deviation.afterSequence);
  });
  const notificationSequence = (wake?.value as { sequence?: number } | undefined)?.sequence ?? null;
  let oldConditionInvalidatedSequence: number | null = null;
  let oldPredictionInvalidatedSequence: number | null = null;
  let recompetitionSequence: number | null = null;
  if (notificationSequence !== null) for (const record of records) {
    if (record.kind !== 'joint-control-decision') continue;
    const snapshot = record.value as PhysicalControlSnapshotV2;
    const sequence = snapshot.workspace.observationSequence;
    if (sequence === null || sequence < notificationSequence) continue;
    if (oldConditionInvalidatedSequence === null && snapshot.workspace.nodes.some(node =>
      node.condition?.invalidatedBy === 'attention')) oldConditionInvalidatedSequence = sequence;
    if (oldPredictionInvalidatedSequence === null && snapshot.workspace.nodes.some(node =>
      node.prediction?.invalidatedBy === 'attention')) oldPredictionInvalidatedSequence = sequence;
    if (oldConditionInvalidatedSequence !== null && oldPredictionInvalidatedSequence !== null
      && snapshot.lastDecision?.converged) { recompetitionSequence = sequence; break; }
  }
  return { realDeviationSequence, notificationSequence, oldConditionInvalidatedSequence,
    oldPredictionInvalidatedSequence, recompetitionSequence };
}

function dependencyEvidence(records: readonly EvidenceRecordV1[], rootGoalId: string):
  GoalChainCaseEvidenceV1['dependency'] {
  const snapshots = records.filter(record => record.kind === 'joint-control-decision')
    .map(record => record.value as PhysicalControlSnapshotV2);
  const matching = snapshots.filter(snapshot => snapshot.workspace.goalId === rootGoalId);
  const last = matching.at(-1);
  const dependencies = matching.flatMap(snapshot => snapshot.workspace.dependencies);
  const nodes = [...new Set(dependencies.map(value => value.requiredNodeId))];
  return { rootGoalId: last?.workspace.goalId ?? null, rootNodeId: last?.workspace.rootNodeId ?? null,
    discoveredDependencyNodeIds: nodes.sort(), expansionObserved: dependencies.length > 0 };
}

export interface GoalChainCaseAuditV1 {
  readonly sourceFileHashBefore: string;
  readonly sourceFileHashAfter: string;
  readonly sourceMemoryUnchanged: boolean;
  readonly protocolLeakageAuditPassed: boolean;
  readonly postGoalFixtureCommandCount: 0;
  readonly staleRefusals: number;
  readonly invalidInteractions: number;
  readonly staleAuditPassed: boolean;
  readonly hiddenAssistanceAuditPassed: boolean;
  readonly leakageAuditPassed: boolean;
  readonly rootRetainedAcrossAllDecisions: boolean;
  readonly successfulActionEvidenceAllFromFrozenBaseline: boolean;
  readonly executedActions: readonly GoalChainExecutedActionEvidenceV1[];
}

export interface MinecraftMultilevelGoalChainLiveCaseResultV1 {
  readonly version: 'MinecraftMultilevelGoalChainLiveCaseResultV1';
  readonly caseId: string;
  readonly tier: 'A' | 'B' | 'C';
  readonly variant: 'full-system' | MultilevelAblationV1;
  readonly symbolicDoorObjectId: string;
  readonly liveDoorObjectId: string;
  readonly fixtureReadiness: UniqueButtonDoorReadinessV1;
  readonly latchPreflight: VanillaLatchPreflightV1;
  readonly controllerStatus: string;
  readonly actionCount: number;
  readonly evidence: GoalChainCaseEvidenceV1;
  readonly score: GoalChainCaseScoreV1;
  readonly audit: GoalChainCaseAuditV1;
  readonly fixtureJournal: RecordingMultilevelGoalChainFixtureV1['journal'];
  readonly boundaryFlags: MultilevelRunnerBoundaryFlagsV1;
}

async function closeStreams(streams: readonly ReturnType<typeof createWriteStream>[]): Promise<void> {
  await Promise.all(streams.map(stream => new Promise<void>((done, reject) => {
    stream.once('error', reject); stream.end(done);
  })));
}

async function runOneGoalChainCaseV1(config: Configuration, services: Services,
  baseline: FrozenMultilevelExperienceV1, specification: MultilevelGoalChainCaseV1,
  caseEvidence: string, variant: 'full-system' | MultilevelAblationV1,
  foundationQualified: boolean): Promise<MinecraftMultilevelGoalChainLiveCaseResultV1> {
  await mkdir(caseEvidence, { recursive: true });
  const eventStream = createWriteStream(resolve(caseEvidence, 'events.jsonl'), { flags: 'wx' });
  const frameStream = createWriteStream(resolve(caseEvidence, 'frames.jsonl'), { flags: 'wx' });
  const records: EvidenceRecordV1[] = [];
  const record = (kind: string, value: unknown): void => {
    const copy = structuredClone(value); records.push({ kind, value: copy });
    (kind === 'frame' ? frameStream : eventStream).write(canonical({ kind, value: copy }) + '\n');
  };
  const live = materializeLiveGoalChainCaseV1(specification);
  const recorder = new RecordingMultilevelGoalChainFixtureV1(live);
  const perturbation = minecraftMultilevelGoalChainPerturbationsV1
    .find(value => value.caseId === specification.id) ?? null;
  const flags = multilevelRunnerBoundaryFlagsV1(variant);
  const body = new PerturbedGoalChainBodyV1({ ...config.minecraft, worldId: specification.id,
    sessionId: `${variant}:${specification.id}`, activeSecondsOffset: baseline.snapshot.activeSeconds },
  record, recorder, perturbation);
  const commands = new PreGoalFixtureCommandPortV1(services, record);
  const compute = new BoundaryVariantComputeV1(flags);
  let runtime: V5Runtime | null = null;
  const sourceFileHashBefore = await fileSha(baseline.path);
  try {
    await body.ready();
    configureLatchFixtureCommandsV1(commands, live);
    const preflightPosition = goalChainCaseInitialPositionLiveV1(live);
    commands.command(`tp ${body.bot.username} ${preflightPosition.join(' ')} 0 0`);
    await body.waitTicks(8);
    const latchPreflight = await pulseAndVerifyVanillaLatchV1(body, live);

    // The only reset is before the case goal. No command path remains after seal().
    configureLatchFixtureCommandsV1(commands, live);
    const initial = goalChainCaseInitialPositionLiveV1(live);
    commands.command(`tp ${body.bot.username} ${initial.join(' ')} 0 0`);
    await body.waitTicks(8);
    const buttonPosition = fixturePosition(live, 'button');
    const doorPosition = fixturePosition(live, 'door');
    await aimAtBlockShape(body, buttonPosition, 'stone_button', live.initialView.yawOffsetDegrees);
    const readiness = await waitForUniqueFixtureReadinessV1(body, blockId(buttonPosition), blockId(doorPosition));
    assert(readiness.ready && readiness.commandBlocksObserved === 0, 'goal-chain-fixture-readiness-failed');
    recorder.recordPreparation({ caseId: live.id, layoutId: live.fixture.layoutId, ready: true,
      realObservationSequence: readiness.currentSequence, commandBlocksObserved: 0 });

    const restored = await makeCaseLocalRestoredExperienceV1(baseline, compute);
    const caseLocalInitialHash = await compute.call<string>('hash');
    assert(caseLocalInitialHash === baseline.snapshotSha256,
      'goal-chain-case-local-copy-does-not-match-frozen-source');
    record('multilevel-case-local-experience-copy', { copyId: live.experience.copyId,
      sourceSnapshotSha256: baseline.snapshotSha256, caseLocalInitialHash,
      independentCaseLocalCopy: true, sourceWriteBack: false, initialHabitWeightCount: 0 });
    const listenersBeforeRuntime = new Set(body.listeners('frame')
      .map(listener => listener as (...args: unknown[]) => void));
    runtime = new V5Runtime(body, { ...config, actionBudget: 32 }, caseEvidence, record,
      { compute, restoredExperience: restored });
    if (!flags.attentionDeviationInputEnabled) {
      const removed = removeRuntimeAttentionFrameInputV1(body, listenersBeforeRuntime);
      assert(removed === 1, `attention-ablation-boundary-listener-count:${removed}`);
      record('multilevel-attention-deviation-input-disabled', { removedFrameListeners: removed });
    }
    assert(runtime.habitCheckpointForDisplay.weights.length === 0, 'goal-chain-case-habit-not-empty');
    commands.seal(); recorder.recordRootGoalInjection(live.rootGoal); body.armPostGoalPerturbation();
    const doorRecorder = new DoorStateRecorderV1(live.doorObjectId, recorder);
    doorRecorder.accept(body.latest()); body.on('frame', doorRecorder.listener);
    const controller = await runtime.runGoal(live.rootGoal);
    doorRecorder.accept(body.latest()); body.off('frame', doorRecorder.listener);
    await runtime.save();

    const executedActions = extractGoalChainExecutedActionEvidenceV1(records, baseline, live.rootGoal.id);
    const decisions = records.filter(value => value.kind === 'joint-control-decision')
      .map(value => value.value as PhysicalControlSnapshotV2);
    const rootRetainedAcrossAllDecisions = decisions.length > 0 && decisions.every(snapshot => {
      const root = snapshot.workspace.rootNodeId;
      return snapshot.workspace.goalId === live.rootGoal.id && root !== null
        && snapshot.workspace.nodes.some(node => node.node.nodeId === root && node.node.kind === 'root');
    });
    const sourceFileHashAfter = await fileSha(baseline.path);
    const successfulActionEvidenceAllFromFrozenBaseline = executedActions.length > 0
      && executedActions.every(value => value.sourceFrozenBaseline && value.rootRetained
        && value.physicalEvidence?.r1.active && value.physicalEvidence.r2.active
        && value.physicalEvidence.r2a.productionEligible && value.predictionClone !== null
        && value.predictionClone.validSampleCount > 0 && value.predictionClone.progressSampleCount > 0);
    const staleRefusals = staleRefusalCount(records);
    const invalidInteractions = invalidBodyInteractionCount(records);
    const protocolAudit = auditMinecraftMultilevelGoalChainProtocolV1();
    const sourceMemoryUnchanged = sourceFileHashAfter === sourceFileHashBefore
      && sourceFileHashAfter === baseline.fileSha256;
    const hiddenAssistanceAuditPassed = readiness.commandBlocksObserved === 0 && commands.sealed;
    const leakageAuditPassed = sourceMemoryUnchanged && protocolAudit.passed
      && hiddenAssistanceAuditPassed && rootRetainedAcrossAllDecisions
      && (controller.status !== 'goal-verified' || successfulActionEvidenceAllFromFrozenBaseline);
    const audit: GoalChainCaseAuditV1 = { sourceFileHashBefore, sourceFileHashAfter,
      sourceMemoryUnchanged,
      protocolLeakageAuditPassed: protocolAudit.passed, postGoalFixtureCommandCount: 0,
      staleRefusals, invalidInteractions, staleAuditPassed: staleRefusals === 0,
      hiddenAssistanceAuditPassed, leakageAuditPassed, rootRetainedAcrossAllDecisions,
      successfulActionEvidenceAllFromFrozenBaseline, executedActions };
    const evidence: GoalChainCaseEvidenceV1 = { caseId: live.id,
      experienceCopyId: live.experience.copyId, initialHabitWeightCount: 0,
      leakageAuditPassed: audit.leakageAuditPassed,
      fixtureReady: readiness.ready && latchPreflight.heldRealTicks >= 200,
      foundationQualified,
      representationQualified: executedActions.length > 0 && executedActions.every(value =>
        value.physicalEvidence?.r1.active && value.physicalEvidence.r2.active
          && value.physicalEvidence.r2a.productionEligible),
      physicalRecallOrRolloutObserved: executedActions.length > 0 && executedActions.every(value =>
        value.predictionClone !== null && value.predictionClone.validSampleCount > 0
          && value.predictionClone.progressSampleCount > 0),
      dependency: dependencyEvidence(records, live.rootGoal.id),
      controlSelectionObserved: executedActions.length > 0 && executedActions.every(value => value.nodeId !== null),
      controlCapacityExhausted: runtime.actionCount >= 32
        || controller.status === 'current-experience-and-budget-exhausted',
      bodyIntegrationSucceeded: staleRefusals === 0 && invalidInteractions === 0
        && executedActions.every(value => value.eventId !== null),
      attention: attentionEvidence(records), realDoorStates: doorRecorder.states };
    const score = scoreMultilevelGoalChainCaseV1(live, evidence);
    const result: MinecraftMultilevelGoalChainLiveCaseResultV1 = {
      version: 'MinecraftMultilevelGoalChainLiveCaseResultV1', caseId: live.id, tier: live.tier,
      variant, symbolicDoorObjectId: specification.doorObjectId, liveDoorObjectId: live.doorObjectId,
      fixtureReadiness: readiness, latchPreflight, controllerStatus: controller.status,
      actionCount: runtime.actionCount, evidence, score, audit,
      fixtureJournal: structuredClone(recorder.journal), boundaryFlags: flags };
    await saveJson(resolve(caseEvidence, 'CASE_RESULT.json'), result); return result;
  } finally {
    if (runtime) await runtime.close(); else { await body.close(); await compute.close(); }
    await closeStreams([eventStream, frameStream]);
  }
}

interface ComputeCallPortV1 { call<T = unknown>(method: string, ...args: unknown[]): Promise<T> }

export function materializeFoundationEpisodeLiveV1(specification: FoundationQualificationCaseV1):
MinecraftMultilevelGuidedTrainingEpisodeLiveV1 {
  const [originX, _y, originZ] = specification.layout.origin;
  const cue = specification.exactActionCue;
  const action: Action = { kind: cue.kind as PrimitiveKind, parameters: { ...cue.parameters },
    ...(cue.kind === 'interact' ? { targetId: `${specification.layout.id}:public-stone-button` } : {}) };
  return { version: 'MinecraftMultilevelGuidedTrainingEpisodeLiveV1', episode: 1000
      + foundationQualificationCasesV1.findIndex(value => value.id === specification.id),
    half: 'second-128-consolidation', mode: specification.mechanism,
    layout: { id: specification.layout.id, split: 'consolidation',
      replication: 16 + specification.replicate, originX, originZ,
      facing: specification.layout.side, neutralMarkerMask: specification.layout.markerPermutation },
    action, reset: 'before-this-episode-only', fullSolutionDisclosed: false };
}

function predicateGoal(id: string, predicate: GroundedGoalV1['expression']): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id, expression: predicate };
}

export function materializeFoundationGoalV1(specification: FoundationQualificationCaseV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1,
  target: Exclude<FoundationQualificationCaseV1['query']['target'], 'no-public-change'>
    | Exclude<FoundationQualificationCaseV1['query']['counterfactualPositiveTarget'], null>,
): GroundedGoalV1 {
  const id = `foundation-effect:${specification.id}:${target}`;
  const wrap = (predicate: GoalPredicateV1): GroundedGoalV1 =>
    predicateGoal(id, { kind: 'predicate', predicate });
  if (target === 'crosshair-acquired') return wrap({ version: 'GoalPredicateV1', id: `${id}:p`,
    subject: { kind: 'crosshair' }, observable: 'type', comparator: 'equals', target: 'stone_button' });
  if (target === 'crosshair-left') return wrap({ version: 'GoalPredicateV1', id: `${id}:p`,
    subject: { kind: 'crosshair' }, observable: 'type', comparator: 'not-equals', target: 'stone_button' });
  if (target === 'vertical-excursion-increased') return wrap({ version: 'GoalPredicateV1', id: `${id}:p`,
    subject: { kind: 'self' }, observable: 'position.1', comparator: 'increase', minimumDelta: .4 });
  if (target === 'door-opened') return wrap({ version: 'GoalPredicateV1', id: `${id}:p`,
    subject: { kind: 'public-object', id: geometry.doorId, expectedType: 'iron_door' },
    observable: 'properties.open', comparator: 'equals', target: true });
  return wrap({ version: 'GoalPredicateV1', id: `${id}:p`,
    subject: { kind: 'public-object', id: geometry.referenceId, expectedType: 'copper_bulb' },
    observable: 'relativeDistance', comparator: target === 'reference-distance-decreased'
      ? 'decrease' : 'increase', minimumDelta: .04 });
}

function angleDistance(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

async function prepareFoundationFixtureV1(services: Services, body: MinecraftBody,
  specification: FoundationQualificationCaseV1): Promise<{ readonly episode:
    MinecraftMultilevelGuidedTrainingEpisodeLiveV1;
    readonly geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1;
    readonly observation: Observation; readonly fixtureReady: boolean }> {
  const episode = materializeFoundationEpisodeLiveV1(specification);
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
  applyMinecraftFixtureCommandBatchLiveV1(services,
    minecraftMultilevelGuidedFixtureCommandsLiveV1(episode, body.bot.username));
  const view = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry);
  const readiness = minecraftMultilevelGuidedFixtureReadinessLiveV1(episode);
  let stable = 0;
  for (let tick = 0; stable < 3 && tick < 160; tick++) {
    const observation = body.latest();
    const pose = Math.hypot(...observation.self.position.map((value, index) =>
      value - geometry.bot[index]!)) < .2 && observation.self.properties.onGround === true
      && angleDistance(observation.self.yaw, view.yaw) < .03
      && angleDistance(observation.self.pitch, view.pitch) < .03;
    const present = readiness.present.every(value => {
      const block = body.bot.blockAt(new Vec3(...value.position));
      if (block?.name !== value.name) return false;
      const properties = block.getProperties() as Readonly<Record<string, unknown>>;
      return Object.entries(value.properties ?? {}).every(([key, expected]) => properties[key] === expected);
    });
    const empty = readiness.empty.every(position => body.bot.blockAt(new Vec3(...position))?.name === 'air');
    stable = pose && present && empty ? stable + 1 : 0;
    if (stable < 3) await body.waitTicks(1);
  }
  await body.waitTicks(4);
  const observation = structuredClone(body.latest());
  const goalTarget = specification.query.target === 'no-public-change'
    ? specification.query.counterfactualPositiveTarget : specification.query.target;
  const publicSubjectReady = goalTarget === null ? true
    : goalTarget === 'crosshair-acquired' || goalTarget === 'crosshair-left'
      ? observation.objects.some(value => value.id === geometry.buttonId && value.type === 'stone_button')
      : goalTarget === 'door-opened'
        ? observation.objects.some(value => value.id === geometry.doorId && value.type === 'iron_door')
        : goalTarget === 'vertical-excursion-increased' ? true
          : observation.objects.some(value => value.id === geometry.referenceId && value.type === 'copper_bulb');
  return { episode, geometry, observation, fixtureReady: stable >= 3 && publicSubjectReady };
}

type SnapshotAnnotationV1 = MemorySnapshot['annotations'][number];

const annotationChanges = (annotation: SnapshotAnnotationV1): readonly PublicChange[] =>
  annotation.kernelChanges.flat();

function maximumNumericAfter(annotation: SnapshotAnnotationV1, subject: string,
  properties: readonly string[]): number {
  return Math.max(0, ...annotationChanges(annotation)
    .filter(change => (change.subject === subject || change.subject.startsWith(`${subject}#`))
      && properties.includes(change.property) && typeof change.after === 'number')
    .map(change => Math.abs(change.after as number)));
}

function annotationMatchesEffectV1(annotation: SnapshotAnnotationV1,
  target: Exclude<FoundationQualificationCaseV1['query']['target'], 'no-public-change'>): boolean {
  const changes = annotationChanges(annotation);
  if (target === 'crosshair-acquired') return changes.some(change => change.subject === 'crosshair'
    && change.property === 'type' && change.after === 'stone_button');
  if (target === 'crosshair-left') return changes.some(change => change.subject === 'crosshair'
    && change.property === 'type' && change.before === 'stone_button' && change.after !== 'stone_button');
  if (target === 'reference-distance-decreased' || target === 'reference-distance-increased')
    return changes.some(change => change.subject.startsWith('copper_bulb#')
      && change.property === 'relativeDistance' && typeof change.before === 'number'
      && typeof change.after === 'number' && (target === 'reference-distance-decreased'
        ? change.after < change.before - .02 : change.after > change.before + .02));
  if (target === 'vertical-excursion-increased')
    return maximumNumericAfter(annotation, 'self', ['displacement.1']) >= .5;
  return changes.some(change => change.subject.startsWith('iron_door#')
    && change.property === 'open' && change.before === false && change.after === true);
}

function annotationMatchesNoEffectV1(annotation: SnapshotAnnotationV1,
  mechanism: FoundationQualificationCaseV1['mechanism']): boolean {
  const changes = annotationChanges(annotation);
  if (mechanism === 'forward-blocked' || mechanism === 'left-blocked' || mechanism === 'right-blocked')
    return maximumNumericAfter(annotation, 'self', ['displacement.0', 'displacement.2']) <= .26;
  if (mechanism === 'jump-forward-blocked-low-roof-high-obstacle')
    return maximumNumericAfter(annotation, 'self', ['displacement.1']) <= .35
      && maximumNumericAfter(annotation, 'self', ['displacement.0', 'displacement.2']) <= .26;
  if (mechanism === 'interact-visible-disconnected-button-no-door-change')
    return !changes.some(change => change.subject.startsWith('iron_door#')
      && change.property === 'open' && change.after === true);
  return changes.length > 0 && changes.every(change => change.subject === 'event'
    && change.property === 'change-within-observed-window' && change.before === false && change.after === false);
}

function noEffectAuditCandidatesV1(specification: FoundationQualificationCaseV1,
  snapshot: MemorySnapshot): readonly EffectRecallCandidateV1[] {
  const cueId = cueIdentity(specification.exactActionCue);
  const coactivationById = new Map(snapshot.store.coactivations.map(value => [value.coactivationId, value]));
  const annotationByAnchor = new Map(snapshot.annotations.map(value => [value.anchorId, value]));
  const relationsByAnchor = new Map<string, string[]>();
  for (const relation of snapshot.r2a?.hyperedges ?? []) {
    if (relation.interventionKey !== cueId || (relation.factorIds.length === 1
      ? relation.state !== 'stable' : relation.state !== 'minimal-under-tested-interventions')) continue;
    const anchor = coactivationById.get(relation.targetR2VisitId)?.experienceAnchorId;
    if (anchor) relationsByAnchor.set(anchor, [...(relationsByAnchor.get(anchor) ?? []), relation.hyperedgeId]);
  }
  return [...relationsByAnchor].flatMap(([anchorId, relationIds]) => {
    const annotation = annotationByAnchor.get(anchorId);
    if (!annotation || cueIdentity(annotation.cue) !== cueId
      || !annotationMatchesNoEffectV1(annotation, specification.mechanism)) return [];
    const coactivation = snapshot.store.coactivations.find(value => value.experienceAnchorId === anchorId
      && value.r1Trace.pageId === annotation.pageId && value.r1Trace.traceId === annotation.traceId);
    if (!coactivation) return [];
    return [{ candidateId: sha({ kind: 'foundation-no-effect-audit', anchorId, relationIds }),
      goalPredicateIds: [], actionCue: structuredClone(annotation.cue),
      observedChanges: structuredClone(annotationChanges(annotation)),
      observedBefore: structuredClone(annotation.context),
      evidence: { eventId: annotation.eventId, anchorId, r1: { pageId: annotation.pageId,
        traceId: annotation.traceId, active: true }, r2: { coordinate: [...annotation.r2Coordinate], active: true },
        r2a: { relationIds: [...relationIds].sort(), applicability: 0, productionEligible: true } },
      unknown: ['historical-no-effect-is-window-bounded-counterevidence'] }];
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

export interface FoundationQueryAuditV1 {
  readonly candidateCount: number;
  readonly queriedCandidateIds: readonly string[];
  readonly sourceEventIds: readonly string[];
  readonly allCandidateProvenanceFromFrozenBaseline: boolean;
}

export async function collectFoundationQualificationEvidenceV1(
  specification: FoundationQualificationCaseV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1, observation: Observation,
  compute: ComputeCallPortV1, baseline: FrozenMultilevelExperienceV1,
  fixtureReady: boolean): Promise<{ readonly evidence: FoundationQualificationEvidenceV1;
    readonly audit: FoundationQueryAuditV1; readonly queryGoal: GroundedGoalV1 | null }> {
  const memoryHashBefore = await compute.call<string>('hash');
  const annotationByEvent = new Map(baseline.snapshot.annotations.map(value => [value.eventId, value]));
  const exactCueIdentity = cueIdentity(specification.exactActionCue);
  const queryTarget = specification.query.target === 'no-public-change'
    ? null : specification.query.target;
  const queryGoal = queryTarget === null ? null
    : materializeFoundationGoalV1(specification, geometry, queryTarget);
  const recall = async (goal: GroundedGoalV1 | null,
    effect: Exclude<FoundationQualificationCaseV1['query']['target'], 'no-public-change'> | null) => {
    if (!goal || !effect) return [];
    const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, observation);
    const values = await compute.call<readonly EffectRecallCandidateV1[]>(
      'recallByEffect', goal, evaluator.evaluate(observation), observation);
    return values.filter(value => cueIdentity(value.actionCue) === exactCueIdentity
      && (() => { const annotation = annotationByEvent.get(value.evidence.eventId);
        return annotation ? annotationMatchesEffectV1(annotation, effect) : false; })());
  };
  const positive = await recall(queryGoal, queryTarget);
  const noEffect = noEffectAuditCandidatesV1(specification, baseline.snapshot);
  const primary = specification.query.kind === 'positive-effect' ? positive : noEffect;
  const counterfactualTarget = specification.query.counterfactualPositiveTarget;
  const counterfactualGoal = counterfactualTarget === null ? null
    : materializeFoundationGoalV1(specification, geometry, counterfactualTarget);
  const counterfactual = await recall(counterfactualGoal, counterfactualTarget);
  const relationById = new Map((baseline.snapshot.r2a?.hyperedges ?? [])
    .map(value => [value.hyperedgeId, value]));
  const query = async (candidates: readonly EffectRecallCandidateV1[]) => {
    const conditions: ConditionApplicabilityV1[] = [], predictions: BranchPredictionV1[] = [];
    const predictionGoal = queryGoal ?? counterfactualGoal ?? predicateGoal(
      `foundation-no-effect:${specification.id}`, { kind: 'predicate', predicate: {
        version: 'GoalPredicateV1', id: 'bounded-window-no-effect', subject: { kind: 'self' },
        observable: 'visible', comparator: 'equals', target: true } });
    const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(predictionGoal, observation);
    const evaluation = evaluator.evaluate(observation);
    for (const candidate of candidates) {
      conditions.push(await compute.call<ConditionApplicabilityV1>('compareConditions', candidate, observation));
      predictions.push(await compute.call<BranchPredictionV1>('predictCandidate', candidate,
        observation, predictionGoal, evaluation));
    }
    return { conditions, predictions };
  };
  const primaryQueries = await query(primary), counterfactualQueries = await query(counterfactual);
  const transitions: OpaqueFactorTransitionTraceV1[] = [];
  const queriedConditions = [...primaryQueries.conditions, ...counterfactualQueries.conditions];
  const queriedFactorIds = [...new Set(queriedConditions.flatMap(condition => [
    ...condition.matchedFactorIds, ...condition.contradictedFactorIds, ...condition.unknownFactorIds]))];
  if (queriedFactorIds.length > 0) transitions.push(...await compute.call<readonly OpaqueFactorTransitionTraceV1[]>(
    'recallFactorTransition', queriedFactorIds, observation));
  const refreshedEvidence = primaryQueries.predictions.map((value, index) =>
    value.currentEvidence ?? primary[index]!.evidence);
  const relationIds = [...new Set(refreshedEvidence.flatMap(value => value.r2a.relationIds))].sort();
  const factorIds = [...new Set(relationIds.flatMap(id => relationById.get(id)?.factorIds ?? []))].sort();
  const visitIds = [...new Set(relationIds.flatMap(id => {
    const visit = relationById.get(id)?.targetR2VisitId; return visit ? [visit] : [];
  }))].sort();
  const bestPrediction = [...primaryQueries.predictions].sort((left, right) =>
    right.validSampleCount - left.validSampleCount || right.progressSampleCount - left.progressSampleCount)[0];
  const allQueriedCandidates = [...primary, ...counterfactual];
  const sourceEventIds = [...new Set(allQueriedCandidates.map(value => value.evidence.eventId))].sort();
  const allCandidateProvenanceFromFrozenBaseline = primary.length > 0 && allQueriedCandidates.every(value =>
    baseline.sourceAnnotationEventIds.has(value.evidence.eventId)
      && value.evidence.r2a.relationIds.every(id => baseline.sourceRelationIds.has(id)));
  const currentApplicability = Math.max(0, ...primaryQueries.conditions.map(value => value.applicability));
  const counterfactualMaximumApplicability = Math.max(0,
    ...counterfactualQueries.conditions.map(value => value.applicability));
  const counterfactualProgressSampleCount = Math.max(0,
    ...counterfactualQueries.predictions.map(value => value.progressSampleCount));
  const memoryHashAfter = await compute.call<string>('hash');
  const evidence: FoundationQualificationEvidenceV1 = { caseId: specification.id,
    mechanism: specification.mechanism, replicate: specification.replicate,
    publicContextId: observation.contextId,
    leakageAuditPassed: auditMinecraftMultilevelGoalChainProtocolV1().passed
      && allCandidateProvenanceFromFrozenBaseline,
    fixtureReady, sourceSnapshot: { guidedRealEventCount: baseline.snapshot.seenEventIds.length,
      snapshotId: baseline.snapshotSha256, memoryHashBefore, memoryHashAfter },
    r1: { active: refreshedEvidence.some(value => value.r1.active),
      traceIds: [...new Set(refreshedEvidence.filter(value => value.r1.active)
        .map(value => value.r1.traceId))].sort() },
    r2: { active: refreshedEvidence.some(value => value.r2.active), visitIds },
    productionR2A: { productionEligible: primary.length > 0
      && primaryQueries.conditions.some(value => value.productionEligible), currentApplicability,
      relationIds, factorIds },
    factorTransition: { recalled: transitions.length > 0,
      factorIds: [...new Set(transitions.flatMap(value => [...value.activatedFactorIds,
        ...value.deactivatedFactorIds, ...value.unchangedActiveFactorIds]))].sort(),
      transitionTraceIds: [...new Set(transitions.map(value => value.transitionId))].sort() },
    predictionClone: { interpretation: specification.query.kind === 'positive-effect'
      ? 'positive-progress' : 'no-effect-physical-readout',
      validSampleCount: bestPrediction?.validSampleCount ?? 0,
      progressSampleCount: bestPrediction?.progressSampleCount ?? 0 },
    exactEffectLookup: { queryKind: specification.query.kind, goalId: queryGoal?.id ?? null,
      expectedCueIdentity: exactCueIdentity, candidateIds: primary.map(value => value.candidateId),
      candidateRelationIds: relationIds },
    counterevidence: { required: specification.query.kind === 'no-effect-counterevidence',
      exactNoEffectCandidateIds: noEffect.map(value => value.candidateId),
      noEffectRelationIds: [...new Set(noEffect.flatMap(value => value.evidence.r2a.relationIds))].sort(),
      noEffectCurrentApplicability: specification.query.kind === 'no-effect-counterevidence'
        ? currentApplicability : 0,
      counterfactualCandidateIds: counterfactual.map(value => value.candidateId),
      counterfactualMaximumApplicability, counterfactualProgressSampleCount } };
  return { evidence, queryGoal, audit: { candidateCount: allQueriedCandidates.length,
    queriedCandidateIds: allQueriedCandidates.map(value => value.candidateId), sourceEventIds,
    allCandidateProvenanceFromFrozenBaseline } };
}

export interface FoundationQualificationCaseResultLiveV1 {
  readonly specificationId: string;
  readonly mechanism: FoundationQualificationCaseV1['mechanism'];
  readonly replicate: 0 | 1;
  readonly queryGoal: GroundedGoalV1 | null;
  readonly evidence: FoundationQualificationEvidenceV1;
  readonly score: FoundationQualificationScoreV1;
  readonly queryAudit: FoundationQueryAuditV1;
}

export interface MinecraftFoundationQualificationBatchLiveV1 {
  readonly version: 'MinecraftFoundationQualificationBatchLiveV1';
  readonly baseline: { readonly path: string; readonly fileSha256: string;
    readonly snapshotSha256: string; readonly realEventCount: 256 };
  readonly cases: readonly FoundationQualificationCaseResultLiveV1[];
  readonly coverage: {
    readonly modeCounts: Readonly<Record<string, number>>;
    readonly modeReplicatePairs: readonly string[];
    readonly uniquePublicContextIds: number;
    readonly completeCartesianCoverage: boolean;
  };
  readonly passed: boolean;
  readonly sourceSnapshotReadOnly: boolean;
}

export function foundationQualificationCoverageLiveV1(
  results: readonly { readonly mechanism: FoundationQualificationCaseV1['mechanism'];
    readonly replicate: 0 | 1; readonly evidence: { readonly publicContextId: string } }[],
): MinecraftFoundationQualificationBatchLiveV1['coverage'] {
  const modeCounts = Object.fromEntries(MULTILEVEL_GUIDED_MODES_V1.map(mode => [mode,
    results.filter(value => value.mechanism === mode).length]));
  const modeReplicatePairs = [...new Set(results.map(value => `${value.mechanism}:${value.replicate}`))].sort();
  const uniquePublicContextIds = new Set(results.map(value => value.evidence.publicContextId)).size;
  const completeCartesianCoverage = MULTILEVEL_GUIDED_MODES_V1.every(mode =>
    ([0, 1] as const).every(replicate => results.some(value => value.mechanism === mode
      && value.replicate === replicate))) && modeReplicatePairs.length === 32;
  return { modeCounts, modeReplicatePairs, uniquePublicContextIds, completeCartesianCoverage };
}

export async function runMinecraftFoundationQualificationBatchLiveV1(config: Configuration,
  evidenceDirectory: string, baselinePath: string,
  expectedBaselineFileSha256?: string): Promise<MinecraftFoundationQualificationBatchLiveV1> {
  await mkdir(evidenceDirectory, { recursive: true });
  const baseline = await readFrozenMultilevelExperienceV1(baselinePath, expectedBaselineFileSha256);
  const sourceHashBefore = await fileSha(baseline.path);
  const runRoot = resolve(config.runtimeRoot, `multilevel-foundation-live-v1-${Date.now()}`);
  const services = new Services(config, runRoot, evidenceDirectory);
  const eventStream = createWriteStream(resolve(evidenceDirectory, 'events.jsonl'), { flags: 'wx' });
  const frameStream = createWriteStream(resolve(evidenceDirectory, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown): void => {
    (kind === 'frame' ? frameStream : eventStream).write(canonical({ kind, value }) + '\n');
  };
  let body: MinecraftBody | null = null;
  const results: FoundationQualificationCaseResultLiveV1[] = [];
  try {
    await services.start('empty');
    body = new MinecraftBody({ ...config.minecraft,
      worldId: 'multilevel-foundation-qualification-live-v1',
      sessionId: 'multilevel-foundation-qualification-live-v1',
      activeSecondsOffset: baseline.snapshot.activeSeconds }, record);
    await body.ready();
    services.command('setworldspawn 1000 64 1000'); services.command('gamerule spawnRadius 0');
    services.command('gamerule doDaylightCycle false'); services.command('gamerule doWeatherCycle false');
    services.command('gamerule doMobSpawning false'); services.command('time set noon');
    services.command('forceload add 224 224 456 352');
    for (const specification of foundationQualificationCasesV1) {
      const caseDirectory = resolve(evidenceDirectory, specification.id);
      await mkdir(caseDirectory);
      const fixture = await prepareFoundationFixtureV1(services, body, specification);
      const compute = new Compute();
      try {
        await compute.call('restore', structuredClone(baseline.snapshot));
        const collected = await collectFoundationQualificationEvidenceV1(specification,
          fixture.geometry, fixture.observation, compute, baseline, fixture.fixtureReady);
        const score = scoreFoundationQualificationV1(specification, collected.evidence);
        const result = { specificationId: specification.id, mechanism: specification.mechanism,
          replicate: specification.replicate, queryGoal: collected.queryGoal,
          evidence: collected.evidence, score, queryAudit: collected.audit };
        results.push(result); await saveJson(resolve(caseDirectory, 'QUALIFICATION_RESULT.json'), result);
      } finally { await compute.close(); }
    }
  } finally {
    await body?.close(); await services.stop(); await closeStreams([eventStream, frameStream]);
  }
  const sourceHashAfter = await fileSha(baseline.path);
  const coverage = foundationQualificationCoverageLiveV1(results);
  const batch: MinecraftFoundationQualificationBatchLiveV1 = {
    version: 'MinecraftFoundationQualificationBatchLiveV1',
    baseline: { path: baseline.path, fileSha256: baseline.fileSha256,
      snapshotSha256: baseline.snapshotSha256, realEventCount: 256 }, cases: results,
    coverage,
    passed: results.length === 32 && results.every(value => value.score.passed)
      && coverage.completeCartesianCoverage && coverage.uniquePublicContextIds === 32
      && sourceHashAfter === sourceHashBefore,
    sourceSnapshotReadOnly: sourceHashAfter === sourceHashBefore };
  await saveJson(resolve(evidenceDirectory, 'FOUNDATION_QUALIFICATION_BATCH.json'), batch);
  assert(batch.passed, `minecraft-foundation-qualification-failed:${results.find(value => !value.score.passed)?.specificationId ?? 'incomplete'}`);
  return batch;
}

export interface MinecraftMultilevelGoalChainLiveBatchV1 {
  readonly version: 'MinecraftMultilevelGoalChainLiveBatchV1';
  readonly baseline: { readonly path: string; readonly fileSha256: string;
    readonly snapshotSha256: string; readonly realEventCount: 256 };
  readonly foundationQualificationPassed: true;
  readonly cases: readonly MinecraftMultilevelGoalChainLiveCaseResultV1[];
  readonly completedTiers: readonly ('A' | 'B' | 'C')[];
  readonly passed: boolean;
  readonly sourceSnapshotReadOnly: boolean;
}

export async function readFoundationQualificationBatchLiveV1(path: string):
  Promise<MinecraftFoundationQualificationBatchLiveV1> {
  const result = JSON.parse(await readFile(path, 'utf8')) as MinecraftFoundationQualificationBatchLiveV1;
  assert(result.version === 'MinecraftFoundationQualificationBatchLiveV1'
    && result.passed && result.sourceSnapshotReadOnly && result.cases.length === 32
    && result.baseline.realEventCount === 256
    && result.coverage.completeCartesianCoverage && result.coverage.uniquePublicContextIds === 32
    && result.coverage.modeReplicatePairs.length === 32
    && new Set(result.cases.map(value => value.specificationId)).size === 32
    && foundationQualificationCasesV1.every(specification => result.cases.some(value =>
      value.specificationId === specification.id && value.score.passed
        && value.evidence.sourceSnapshot.memoryHashBefore
          === value.evidence.sourceSnapshot.memoryHashAfter
        && value.queryAudit.allCandidateProvenanceFromFrozenBaseline)),
  'multilevel-foundation-qualification-not-passing');
  return result;
}

async function startMultilevelServicesV1(config: Configuration, evidenceDirectory: string): Promise<Services> {
  const services = new Services(config,
    resolve(config.runtimeRoot, `multilevel-goal-chain-live-v1-${Date.now()}`), evidenceDirectory);
  await services.start('empty');
  services.command('setworldspawn 1000 64 1000'); services.command('gamerule spawnRadius 0');
  services.command('gamerule doDaylightCycle false'); services.command('gamerule doWeatherCycle false');
  services.command('gamerule doMobSpawning false'); services.command('time set noon');
  services.command('forceload add 384 384 464 464');
  return services;
}

export async function runMinecraftMultilevelGoalChainLiveBatchV1(config: Configuration,
  evidenceDirectory: string, baselinePath: string,
  foundation: MinecraftFoundationQualificationBatchLiveV1,
  expectedBaselineFileSha256?: string): Promise<MinecraftMultilevelGoalChainLiveBatchV1> {
  await mkdir(evidenceDirectory, { recursive: true });
  const baseline = await readFrozenMultilevelExperienceV1(baselinePath, expectedBaselineFileSha256);
  assert(foundation.passed && foundation.baseline.snapshotSha256 === baseline.snapshotSha256
    && foundation.sourceSnapshotReadOnly, 'goal-chain-foundation-gate-or-baseline-identity-mismatch');
  const sourceHashBefore = await fileSha(baseline.path);
  const services = await startMultilevelServicesV1(config, evidenceDirectory);
  const results: MinecraftMultilevelGoalChainLiveCaseResultV1[] = [];
  const completedTiers: Array<'A' | 'B' | 'C'> = [];
  try {
    for (const tier of ['A', 'B', 'C'] as const) {
      const cases = minecraftMultilevelGoalChainCasesV1.filter(value => value.tier === tier);
      const tierResults: MinecraftMultilevelGoalChainLiveCaseResultV1[] = [];
      for (const specification of cases) {
        const result = await runOneGoalChainCaseV1(config, services, baseline, specification,
          resolve(evidenceDirectory, specification.id), 'full-system', true);
        tierResults.push(result); results.push(result);
      }
      if (!tierResults.every(value => value.score.passed)) break;
      completedTiers.push(tier);
    }
  } finally { await services.stop(); }
  const sourceHashAfter = await fileSha(baseline.path);
  const batch: MinecraftMultilevelGoalChainLiveBatchV1 = {
    version: 'MinecraftMultilevelGoalChainLiveBatchV1',
    baseline: { path: baseline.path, fileSha256: baseline.fileSha256,
      snapshotSha256: baseline.snapshotSha256, realEventCount: 256 },
    foundationQualificationPassed: true, cases: results, completedTiers,
    passed: results.length === 12 && completedTiers.length === 3
      && results.every(value => value.score.passed) && sourceHashAfter === sourceHashBefore,
    sourceSnapshotReadOnly: sourceHashAfter === sourceHashBefore };
  await saveJson(resolve(evidenceDirectory, 'GOAL_CHAIN_LIVE_BATCH.json'), batch);
  assert(batch.passed, `minecraft-multilevel-goal-chain-failed:${results.find(value => !value.score.passed)?.caseId ?? 'incomplete'}`);
  return batch;
}

export interface MinecraftMultilevelAblationLiveResultV1 {
  readonly version: 'MinecraftMultilevelAblationLiveResultV1';
  readonly caseResults: Readonly<Record<'full-system' | MultilevelAblationV1,
    readonly MinecraftMultilevelGoalChainLiveCaseResultV1[]>>;
  readonly diagnosticBatches: readonly MultilevelDiagnosticBatchV1[];
  readonly score: MultilevelAblationScoreV1;
  readonly sourceSnapshotReadOnly: boolean;
}

function diagnosticBatch(variant: 'full-system' | MultilevelAblationV1,
  cases: readonly MinecraftMultilevelGoalChainLiveCaseResultV1[]): MultilevelDiagnosticBatchV1 {
  return { variant, outcomes: cases.map(value => {
    const attention = value.evidence.attention;
    const latency = attention.realDeviationSequence !== null && attention.notificationSequence !== null
      ? attention.notificationSequence - attention.realDeviationSequence : null;
    const staleAcrossDeviation = attention.realDeviationSequence !== null
      && value.audit.executedActions.some(action =>
        action.decisionObservationSequence !== null
        && action.decisionObservationSequence >= attention.realDeviationSequence!
        && ((action.conditionObservationSequence !== null
          && action.conditionObservationSequence < attention.realDeviationSequence!)
          || (action.predictionObservationSequence !== null
            && action.predictionObservationSequence < attention.realDeviationSequence!)));
    return { caseId: value.caseId, success: value.score.passed,
      attentionResponseLatencyTicks: latency,
      staleConditionOrPredictionUsed: value.audit.executedActions.some(action =>
        action.conditionFresh === false || action.predictionFresh === false) || staleAcrossDeviation };
  }) };
}

export async function runMinecraftMultilevelAblationsLiveV1(config: Configuration,
  evidenceDirectory: string, baselinePath: string,
  foundation: MinecraftFoundationQualificationBatchLiveV1,
  expectedBaselineFileSha256?: string): Promise<MinecraftMultilevelAblationLiveResultV1> {
  await mkdir(evidenceDirectory, { recursive: true });
  const baseline = await readFrozenMultilevelExperienceV1(baselinePath, expectedBaselineFileSha256);
  assert(foundation.passed && foundation.sourceSnapshotReadOnly
    && foundation.baseline.snapshotSha256 === baseline.snapshotSha256,
    'ablation-foundation-gate-or-baseline-identity-mismatch');
  const diagnostics = minecraftMultilevelGoalChainCasesV1.filter(value =>
    MULTILEVEL_ABLATION_CONTRACT_V1.diagnosticCaseIds.includes(value.id as typeof MULTILEVEL_ABLATION_CONTRACT_V1.diagnosticCaseIds[number]));
  assert(diagnostics.length === 4 && diagnostics.every(value => value.tier === 'C'),
    'ablation-diagnostics-not-exactly-C01-C04');
  const sourceHashBefore = await fileSha(baseline.path);
  const services = await startMultilevelServicesV1(config, evidenceDirectory);
  const variants: readonly ('full-system' | MultilevelAblationV1)[] = [
    'full-system', ...MULTILEVEL_ABLATIONS_V1.map(value => value.id),
  ];
  const caseResults = {} as Record<'full-system' | MultilevelAblationV1,
    MinecraftMultilevelGoalChainLiveCaseResultV1[]>;
  try {
    for (const variant of variants) {
      caseResults[variant] = [];
      for (const specification of diagnostics) caseResults[variant].push(
        await runOneGoalChainCaseV1(config, services, baseline, specification,
          resolve(evidenceDirectory, variant, specification.id), variant, true));
    }
  } finally { await services.stop(); }
  const batches = variants.map(variant => diagnosticBatch(variant, caseResults[variant]));
  const full = batches.find(value => value.variant === 'full-system')!;
  const score = scoreMultilevelAblationsV1(full,
    batches.filter(value => value.variant !== 'full-system'));
  const sourceHashAfter = await fileSha(baseline.path);
  const result: MinecraftMultilevelAblationLiveResultV1 = {
    version: 'MinecraftMultilevelAblationLiveResultV1', caseResults,
    diagnosticBatches: batches, score,
    sourceSnapshotReadOnly: sourceHashAfter === sourceHashBefore };
  await saveJson(resolve(evidenceDirectory, 'ABLATION_LIVE_RESULT.json'), result);
  assert(result.sourceSnapshotReadOnly && score.passed,
    `minecraft-multilevel-ablation-contract-failed:${score.contractViolations.join(',')}`);
  return result;
}
