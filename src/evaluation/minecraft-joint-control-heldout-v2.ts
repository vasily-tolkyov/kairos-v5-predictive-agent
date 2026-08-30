import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Vec3 } from 'vec3';
import type { Action, ActionCue, BodyResult, Observation, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import type { MemorySnapshot } from '../memory.js';
import { V5Runtime, type ExperiencePointer, type RestoredExperience } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import { PUBLIC_LAYOUT_SEMANTICS } from '../public-context.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import type { GroundedGoalV1 } from '../control/contracts.js';
import { ExperienceMediaStore } from '../core/learning/experience-store.js';
import { canonical, assert, fileSha, saveJson, sha } from '../util.js';
import { guidedFixtureGeometryV1, type GuidedMinecraftLayoutV1 } from './minecraft-guided-affordance.js';
import { cueIdentity } from '../events.js';

export const MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2 = Object.freeze({
  relativePath: 'evidence/r2-measurement-resolution-and-physical-basin-repair-v1/rebuilt-attempt017-v7-action-event-measurement-v2/experience-0128.json',
  fileSha256: '5ca48e3a80cd044431867f3641c1cb9299943102d0f23f5bc6d10eb5eeb16252',
  canonicalSha256: '8bc4bda690b63a1a474cc6c180a053eee70322c7ee724144b753601cbd466218',
  eventMapSha256: 'd782b5845f59141ca18cb52235c71f9dad89c402b713b71e02120b90de0e188e',
  eventCount: 128,
});

export type MinecraftJointControlHeldoutModeV2 =
  | 'look-plus-15'
  | 'look-minus-15'
  | 'already-aligned'
  | 'post-look-public-view-deviation';

export interface MinecraftJointControlHeldoutCaseV2 {
  readonly id: string;
  readonly mode: MinecraftJointControlHeldoutModeV2;
  readonly layout: GuidedMinecraftLayoutV1;
  readonly initialYawOffsetDegrees: -15 | 0 | 15;
  readonly publicDeviationDegrees: 0 | 30;
}

/** World placements and IDs are held out from all eight attempt-017 training layouts. */
export const minecraftJointControlHeldoutCasesV2: readonly MinecraftJointControlHeldoutCaseV2[] = Object.freeze([
  { id: 'joint-heldout-plus-15', mode: 'look-plus-15',
    layout: { id: 'joint-heldout-layout-201', originX: 112, originZ: 110, side: 'south', markerVariant: 2 },
    initialYawOffsetDegrees: -15, publicDeviationDegrees: 0 },
  { id: 'joint-heldout-minus-15', mode: 'look-minus-15',
    layout: { id: 'joint-heldout-layout-202', originX: 88, originZ: 110, side: 'east', markerVariant: 2 },
    initialYawOffsetDegrees: 15, publicDeviationDegrees: 0 },
  { id: 'joint-heldout-aligned', mode: 'already-aligned',
    layout: { id: 'joint-heldout-layout-203', originX: 112, originZ: 90, side: 'north', markerVariant: 2 },
    initialYawOffsetDegrees: 0, publicDeviationDegrees: 0 },
  { id: 'joint-heldout-public-deviation', mode: 'post-look-public-view-deviation',
    layout: { id: 'joint-heldout-layout-204', originX: 88, originZ: 90, side: 'west', markerVariant: 2 },
    initialYawOffsetDegrees: -15, publicDeviationDegrees: 30 },
]);

export interface FrozenPhysicalBaselineV2 {
  readonly path: string;
  readonly fileSha256: string;
  readonly canonicalSha256: string;
  readonly eventMapSha256: string;
  readonly snapshot: MemorySnapshot;
}

export async function readFrozenPhysicalBaselineV2(path: string): Promise<FrozenPhysicalBaselineV2> {
  const fileSha256 = await fileSha(path);
  assert(fileSha256 === MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.fileSha256,
    `heldout-frozen-baseline-file-identity-mismatch:${fileSha256}`);
  const snapshot = JSON.parse(await readFile(path, 'utf8')) as MemorySnapshot;
  const canonicalSha256 = sha(snapshot), eventMapSha256 = sha(snapshot.eventMap);
  assert(snapshot.version === 'KairosV5MemoryV4' && snapshot.writes === 128
    && snapshot.seenEventIds.length === MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.eventCount
    && snapshot.pendingInitialization.length === 0 && snapshot.eventMap !== null,
  'heldout-frozen-baseline-is-not-complete-128-event-memory');
  assert(snapshot.eventMeasurementVersion === 'R2EventMeasurementAdapterV2'
      && snapshot.projector?.version === 'PathProjectorStateV4'
    && snapshot.projector.measurementGeometry === 'source-translated-global-event-frame-v1'
    && snapshot.projector.resolution.version === 'R2MeasurementResolutionCalibrationV4'
    && snapshot.projector.resolution.equivalentGeometryMethod === 'vertex-preserving-polyline-densification'
    && snapshot.projector.resolution.boundaryGeometry === 'max-centered-radius-within-inscribed-sphere'
    && snapshot.r2a?.version === 'CausalFactorGraphStateV3'
    && snapshot.r2a.outcomeIdentityVersion === 'ActiveR2BasinMembershipV1'
    && snapshot.r2a.legacyOutcomeModesMigrated === false,
  'heldout-frozen-baseline-is-audit-only-representation');
  assert(canonicalSha256 === MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.canonicalSha256
    && eventMapSha256 === MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.eventMapSha256,
  'heldout-frozen-baseline-canonical-identity-mismatch');
  return { path, fileSha256, canonicalSha256, eventMapSha256, snapshot };
}

export interface FrozenTargetActionProductionPreflightV2 {
  readonly version: 'FrozenTargetActionProductionPreflightV2';
  readonly ready: boolean;
  readonly reason: 'ready' | 'experience-insufficient:target-action-has-no-production-r2a-relation';
  readonly interventionKey: string;
  readonly relationCount: number;
  readonly productionRelationIds: readonly string[];
  readonly productionFactorIds: readonly string[];
  readonly sourceEventCount: number;
}

/**
 * Structural, read-only capability gate for the sealed heldout batch.
 *
 * It does not decide an action and it does not treat R1/R2 history as a
 * substitute for a condition.  It only establishes that the frozen memory
 * contains at least one still-referenced production R2A relation for the
 * exact target action before starting an expensive Minecraft process.  Live
 * applicability and PredictionClone progress remain runtime requirements.
 */
export function inspectFrozenTargetActionProductionV2(snapshot: MemorySnapshot,
  cue: ActionCue): FrozenTargetActionProductionPreflightV2 {
  const interventionKey = cueIdentity(cue);
  const graph = snapshot.r2a;
  if (!graph) return { version: 'FrozenTargetActionProductionPreflightV2', ready: false,
    reason: 'experience-insufficient:target-action-has-no-production-r2a-relation', interventionKey,
    relationCount: 0, productionRelationIds: [], productionFactorIds: [], sourceEventCount: 0 };
  const stableFactors = new Set(graph.factorNodes.filter(node => node.state === 'stable')
    .map(node => node.factorId));
  const store = new ExperienceMediaStore(snapshot.store);
  const relations = graph.hyperedges.filter(edge => edge.interventionKey === interventionKey);
  const productionState = relations.filter(edge => edge.factorIds.length === 1
    ? edge.state === 'stable' : edge.state === 'minimal-under-tested-interventions');
  for (const edge of productionState) assert(edge.factorIds.length > 0
    && edge.factorIds.every(factorId => stableFactors.has(factorId)),
  `heldout-production-r2a-relation-references-nonstable-factor:${edge.hyperedgeId}`);
  const production = productionState.filter(edge => store.resolveActiveR2Basin(edge.targetR2VisitId) !== null);
  const factorIds = [...new Set(production.flatMap(edge => edge.factorIds))].sort();
  const sourceEventCount = new Set(production.flatMap(edge => edge.sourceEventIds)).size;
  const ready = production.length > 0;
  return { version: 'FrozenTargetActionProductionPreflightV2', ready,
    reason: ready ? 'ready' : 'experience-insufficient:target-action-has-no-production-r2a-relation',
    interventionKey, relationCount: relations.length,
    productionRelationIds: production.map(edge => edge.hyperedgeId).sort(),
    productionFactorIds: factorIds, sourceEventCount };
}

export interface FixtureVisibilityReadinessV2 {
  readonly ready: boolean;
  readonly firstSequence: number | null;
  readonly secondSequence: number | null;
  readonly controlId: string | null;
  readonly observedTicks: number;
  readonly reason: 'waiting' | 'ready' | 'ambiguous-or-not-visible';
}

/**
 * A fixture is ready only after every intervening public frame contains the same
 * sole note block for at least five real physics ticks. This class has no body or
 * action access and therefore cannot manufacture readiness.
 */
export class SingleVisibleNoteReadinessGateV2 {
  #firstSequence: number | null = null;
  #controlId: string | null = null;
  #observedTicks = 0;

  accept(observation: Observation): FixtureVisibilityReadinessV2 {
    const notes = observation.objects.filter(object => object.type === 'note_block');
    if (notes.length !== 1 || (this.#controlId !== null && notes[0]!.id !== this.#controlId)) {
      this.#firstSequence = null; this.#controlId = null; this.#observedTicks++;
      return { ready: false, firstSequence: null, secondSequence: null, controlId: null,
        observedTicks: this.#observedTicks, reason: 'ambiguous-or-not-visible' };
    }
    this.#firstSequence ??= observation.sequence; this.#controlId ??= notes[0]!.id; this.#observedTicks++;
    const ready = observation.sequence - this.#firstSequence >= 5;
    return { ready, firstSequence: this.#firstSequence,
      secondSequence: ready ? observation.sequence : null, controlId: this.#controlId,
      observedTicks: this.#observedTicks, reason: ready ? 'ready' : 'waiting' };
  }
}

export function noteStateGoalV2(caseId: string, controlId: string): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id: `heldout-note-one:${caseId}`,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'note-state-one',
      subject: { kind: 'public-object', id: controlId, expectedType: 'note_block' },
      observable: 'properties.note', comparator: 'equals', target: '1' } } };
}

function makeRestoredExperience(baseline: FrozenPhysicalBaselineV2, compute: Compute): Promise<RestoredExperience> {
  const pointer: ExperiencePointer = { runtimeVersion: 'KairosV5PhysicalControlRuntimeV1',
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS,
    filename: basename(baseline.path), sha256: baseline.canonicalSha256,
    actions: 0, eventCount: baseline.snapshot.seenEventIds.length, writes: baseline.snapshot.writes };
  const habit = new ControlHabitWeightsV1();
  return compute.call('restore', baseline.snapshot).then(() => ({ pointerPath: baseline.path,
    snapshotPath: baseline.path, habitPath: null, pointer, snapshot: baseline.snapshot, habit }));
}

async function configureHeldoutFixture(body: MinecraftBody, services: Services,
  heldout: MinecraftJointControlHeldoutCaseV2): Promise<void> {
  const layout = heldout.layout, geometry = guidedFixtureGeometryV1(layout);
  const radius = 4, minX = layout.originX - radius, maxX = layout.originX + radius;
  const minZ = layout.originZ - radius, maxZ = layout.originZ + radius;
  services.command(`fill ${minX} 64 ${minZ} ${maxX} 69 ${maxZ} air`);
  services.command(`fill ${minX} 63 ${minZ} ${maxX} 63 ${maxZ} minecraft:smooth_stone`);
  services.command(`setblock ${geometry.backing.join(' ')} minecraft:redstone_lamp[lit=false]`);
  services.command(`setblock ${geometry.control.join(' ')} minecraft:note_block[instrument=harp,note=0,powered=false]`);
  for (const command of geometry.markerCommands) services.command(command);
  services.command(`tp ${body.bot.username} ${geometry.bot.join(' ')} 0 0`);
  await body.waitTicks(6);
  let control = body.bot.blockAt(new Vec3(...geometry.control));
  for (let tick = 0; control?.name !== 'note_block' && tick < 40; tick++) {
    await body.waitTicks(1); control = body.bot.blockAt(new Vec3(...geometry.control));
  }
  assert(control?.name === 'note_block' && control.shapes.length > 0, 'heldout-fixture-control-shape-unavailable');
  const shape = control.shapes[0]!;
  const target = new Vec3(geometry.control[0] + (shape[0]! + shape[3]!) / 2,
    geometry.control[1] + (shape[1]! + shape[4]!) / 2,
    geometry.control[2] + (shape[2]! + shape[5]!) / 2);
  const eye = body.bot.entity.position.offset(0, 1.62, 0), delta = target.minus(eye);
  const yaw = Math.atan2(-delta.x, -delta.z), pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  await body.bot.look(yaw + heldout.initialYawOffsetDegrees * Math.PI / 180, pitch, true);
  await body.waitTicks(3);
}

async function awaitFixtureReadiness(body: MinecraftBody): Promise<FixtureVisibilityReadinessV2> {
  const gate = new SingleVisibleNoteReadinessGateV2();
  let result = gate.accept(body.latest());
  for (let tick = 0; !result.ready && tick < 200; tick++) {
    await body.waitTicks(1); result = gate.accept(body.latest());
  }
  return result;
}

/** Test-only world perturbation. It changes only the real public view after the
 * first genuine look action; no action or subgoal is handed to the controller. */
class PublicViewDeviationBodyV2 extends MinecraftBody {
  #deviationApplied = false;
  constructor(configuration: ConstructorParameters<typeof MinecraftBody>[0],
    record: ConstructorParameters<typeof MinecraftBody>[1], readonly deviationDegrees: number) {
    super(configuration, record);
  }
  override async execute(action: Action): Promise<{ result: BodyResult; event: RealEvent | null }> {
    const result = await super.execute(action);
    if (!this.#deviationApplied && result.result.executed && action.kind === 'look') {
      this.#deviationApplied = true;
      const before = this.latest();
      await this.bot.look(this.bot.entity.yaw + this.deviationDegrees * Math.PI / 180,
        this.bot.entity.pitch, true);
      // A full production attention window observes the externally imposed offset.
      await this.waitTicks(25);
      this.record('heldout-public-view-deviation', { beforeSequence: before.sequence,
        afterSequence: this.latest().sequence, degrees: this.deviationDegrees });
    }
    return result;
  }
}

export interface MinecraftJointControlHeldoutCaseResultV2 {
  readonly caseId: string;
  readonly mode: MinecraftJointControlHeldoutModeV2;
  readonly fixture: FixtureVisibilityReadinessV2;
  readonly status: 'goal-verified' | 'fixture-failed' | 'control-failed';
  readonly controllerStatus: string | null;
  readonly goalReached: boolean;
  readonly actions: readonly string[];
  readonly invalidInteractions: number;
  readonly staleRefusals: number;
  readonly scriptGeneratedSubgoals: 0;
  readonly targetBranchRetainedAcrossLook: boolean;
  readonly attentionNoticeCount: number;
  readonly attentionDeviationNoticeCount: number;
  readonly baselineHashBefore: string;
  readonly baselineHashAfter: string;
  readonly initialHabitWeightCount: 0;
  readonly temporaryExperienceHash: string | null;
  readonly error: string | null;
}

export interface MinecraftJointControlHeldoutBatchV2 {
  readonly version: 'MinecraftJointControlHeldoutBatchV2';
  readonly baseline: Omit<FrozenPhysicalBaselineV2, 'snapshot'> & { readonly writes: 128 };
  readonly cases: readonly MinecraftJointControlHeldoutCaseResultV2[];
  readonly passed: boolean;
  readonly oneFrozenBatch: true;
}

function actionKindsFromRecords(records: readonly { kind: string; value: unknown }[]): string[] {
  return records.filter(record => record.kind === 'body-result')
    .map(record => canonical((record.value as BodyResult).action));
}

export function heldoutStaleRefusalCountV2(records: readonly { kind: string; value: unknown }[]): number {
  return records.filter(record => {
    if (record.kind === 'control-action-reality-refusal') {
      return (record.value as { reason?: string }).reason === 'offer-stale';
    }
    if (record.kind !== 'control-action-result') return false;
    return (record.value as { result?: { refusal?: string } }).result?.refusal === 'offer-stale';
  }).length;
}

export function heldoutInvalidInteractionCountV2(records: readonly { kind: string; value: unknown }[]): number {
  return records.filter(record => record.kind === 'control-action-result'
    && (record.value as { offer?: { action?: Action }; result?: { executed?: boolean } }).offer?.action?.kind === 'interact'
    && (record.value as { result?: { executed?: boolean } }).result?.executed !== true).length;
}

/** Count only an unknown-change wake whose real yaw evidence falls inside the
 * externally imposed view-deviation interval.  A notice caused by the agent's
 * own preceding look cannot satisfy this gate. */
export function heldoutDeviationAttentionNoticeCountV2(
  records: readonly { kind: string; value: unknown }[]): number {
  const intervals = records.filter(record => record.kind === 'heldout-public-view-deviation')
    .map(record => record.value as { beforeSequence: number; afterSequence: number });
  return records.filter(record => {
    if (record.kind !== 'attention-wake') return false;
    const notice = record.value as { kind?: string; subjectId?: string; sequence?: number;
      evidence?: readonly { subject?: string; property?: string; before?: unknown; after?: unknown }[] };
    if (notice.kind !== 'unknown-change' || notice.subjectId !== 'self'
      || !Number.isInteger(notice.sequence)) return false;
    if (!intervals.some(interval => notice.sequence! > interval.beforeSequence
      && notice.sequence! <= interval.afterSequence)) return false;
    return Array.isArray(notice.evidence) && notice.evidence.some(change => change.subject === 'self'
      && change.property === 'yaw' && change.before !== change.after);
  }).length;
}

export function heldoutCaseActionChainMatchesV2(mode: MinecraftJointControlHeldoutModeV2,
  actionRows: readonly string[]): boolean {
  const actions = actionRows.map(row => JSON.parse(row) as Action), kinds = actions.map(action => action.kind);
  if (mode === 'already-aligned') return canonical(kinds) === canonical(['interact', 'observe']);
  if (mode === 'look-plus-15' || mode === 'look-minus-15') {
    const yaw = mode === 'look-plus-15' ? 15 : -15;
    return canonical(kinds) === canonical(['look', 'interact', 'observe'])
      && actions[0]!.parameters.yawDegrees === yaw && actions[0]!.parameters.pitchDegrees === 0;
  }
  return kinds.length >= 4 && kinds.at(-2) === 'interact' && kinds.at(-1) === 'observe'
    && kinds.slice(0, -2).every(kind => kind === 'look')
    && actions[0]!.parameters.yawDegrees === 15;
}

export async function runMinecraftJointControlHeldoutBatchV2(config: Configuration, evidence: string,
  baselinePath = resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath)):
  Promise<MinecraftJointControlHeldoutBatchV2> {
  await mkdir(dirname(evidence), { recursive: true }); await mkdir(evidence);
  const baseline = await readFrozenPhysicalBaselineV2(baselinePath);
  const productionPreflight = inspectFrozenTargetActionProductionV2(baseline.snapshot,
    { kind: 'interact', parameters: {}, targetRole: 'note_block' });
  await saveJson(resolve(evidence, 'FROZEN_TARGET_ACTION_PREFLIGHT.json'), productionPreflight);
  assert(productionPreflight.ready, productionPreflight.reason);
  const baselineHashBefore = await fileSha(baselinePath);
  const runRoot = resolve(config.runtimeRoot, `joint-control-heldout-v2-${Date.now()}`);
  const services = new Services(config, runRoot, evidence); const results: MinecraftJointControlHeldoutCaseResultV2[] = [];
  try {
    await services.start('empty');
    services.command('setworldspawn 1000 64 1000'); services.command('gamerule spawnRadius 0');
    services.command('gamerule doDaylightCycle false'); services.command('gamerule doWeatherCycle false');
    services.command('gamerule doMobSpawning false'); services.command('time set noon');
    services.command('forceload add 80 80 120 120');
    for (const heldout of minecraftJointControlHeldoutCasesV2) {
      const caseEvidence = resolve(evidence, heldout.id); await mkdir(caseEvidence);
      const eventStream = createWriteStream(resolve(caseEvidence, 'events.jsonl'), { flags: 'wx' });
      const frameStream = createWriteStream(resolve(caseEvidence, 'frames.jsonl'), { flags: 'wx' });
      const records: { kind: string; value: unknown }[] = [];
      const record = (kind: string, value: unknown): void => {
        const copy = structuredClone(value); records.push({ kind, value: copy });
        (kind === 'frame' ? frameStream : eventStream).write(canonical({ kind, value: copy }) + '\n');
      };
      const body = heldout.publicDeviationDegrees === 0
        ? new MinecraftBody({ ...config.minecraft, worldId: heldout.id, sessionId: heldout.id,
          activeSecondsOffset: baseline.snapshot.activeSeconds }, record)
        : new PublicViewDeviationBodyV2({ ...config.minecraft, worldId: heldout.id, sessionId: heldout.id,
          activeSecondsOffset: baseline.snapshot.activeSeconds }, record, heldout.publicDeviationDegrees);
      let runtime: V5Runtime | null = null, compute: Compute | null = null;
      let fixture: FixtureVisibilityReadinessV2 = { ready: false, firstSequence: null,
        secondSequence: null, controlId: null, observedTicks: 0, reason: 'waiting' };
      let caseResult: MinecraftJointControlHeldoutCaseResultV2 | null = null;
      try {
        await body.ready(); await configureHeldoutFixture(body, services, heldout);
        fixture = await awaitFixtureReadiness(body);
        if (!fixture.ready || !fixture.controlId) {
          caseResult = { caseId: heldout.id, mode: heldout.mode, fixture, status: 'fixture-failed',
            controllerStatus: null, goalReached: false, actions: [], invalidInteractions: 0, staleRefusals: 0,
            scriptGeneratedSubgoals: 0, targetBranchRetainedAcrossLook: false, attentionNoticeCount: 0,
            attentionDeviationNoticeCount: 0,
            baselineHashBefore, baselineHashAfter: await fileSha(baselinePath), initialHabitWeightCount: 0,
            temporaryExperienceHash: null, error: 'fixture-readiness-timeout' };
        } else {
          compute = new Compute(); const restored = await makeRestoredExperience(baseline, compute);
          const caseConfig: Configuration = { ...config, actionBudget: 8 };
          runtime = new V5Runtime(body, caseConfig, caseEvidence, record, { compute, restoredExperience: restored });
          assert(runtime.habitCheckpointForDisplay.weights.length === 0, 'heldout-case-habit-not-zero');
          const result = await runtime.runGoal(noteStateGoalV2(heldout.id, fixture.controlId));
          const final = body.latest(), note = final.objects.find(object => object.id === fixture.controlId);
          await runtime.save();
          const temporaryExperienceHash = await compute.call<string>('hash');
          const actions = actionKindsFromRecords(records);
          const invalidInteractions = heldoutInvalidInteractionCountV2(records);
          const staleRefusals = heldoutStaleRefusalCountV2(records);
          const lookIndex = records.findIndex(record => record.kind === 'body-result'
            && (record.value as BodyResult).action.kind === 'look');
          const targetBranchRetainedAcrossLook = lookIndex < 0 || records.slice(lookIndex).some(record => {
            if (record.kind !== 'joint-control-decision') return false;
            const snapshot = record.value as { workspace?: { rootNodeId?: string; nodes?: readonly {
              node: { nodeId: string; kind?: string; candidate?: { goalPredicateIds?: readonly string[] } } }[] } };
            return Boolean(snapshot.workspace?.rootNodeId && snapshot.workspace.nodes
              ?.some(node => node.node.nodeId === snapshot.workspace!.rootNodeId)
              && snapshot.workspace.nodes.some(node => node.node.kind === 'experienced'
                && node.node.candidate?.goalPredicateIds?.includes('note-state-one')));
          });
          const reached = note?.type === 'note_block' && note.properties.note === '1';
          caseResult = { caseId: heldout.id, mode: heldout.mode, fixture,
            status: result.status === 'goal-verified' && reached && invalidInteractions === 0 && staleRefusals === 0
              ? 'goal-verified' : 'control-failed',
            controllerStatus: result.status, goalReached: reached, actions, invalidInteractions, staleRefusals,
            scriptGeneratedSubgoals: 0, targetBranchRetainedAcrossLook,
            attentionNoticeCount: runtime.attention.notices.length,
            attentionDeviationNoticeCount: heldoutDeviationAttentionNoticeCountV2(records), baselineHashBefore,
            baselineHashAfter: await fileSha(baselinePath), initialHabitWeightCount: 0,
            temporaryExperienceHash, error: null };
        }
      } catch (error) {
        caseResult = { caseId: heldout.id, mode: heldout.mode, fixture,
          status: fixture.ready ? 'control-failed' : 'fixture-failed', controllerStatus: null,
          goalReached: false, actions: actionKindsFromRecords(records),
          invalidInteractions: heldoutInvalidInteractionCountV2(records),
          staleRefusals: heldoutStaleRefusalCountV2(records),
          scriptGeneratedSubgoals: 0, targetBranchRetainedAcrossLook: false,
          attentionNoticeCount: runtime?.attention.notices.length ?? 0,
          attentionDeviationNoticeCount: heldoutDeviationAttentionNoticeCountV2(records), baselineHashBefore,
          baselineHashAfter: await fileSha(baselinePath), initialHabitWeightCount: 0,
          temporaryExperienceHash: compute ? await compute.call<string>('hash').catch(() => null) : null,
          error: error instanceof Error ? `${error.name}:${error.message}` : String(error) };
      } finally {
        if (runtime) await runtime.close(); else { await body.close(); await compute?.close(); }
        await Promise.all([new Promise<void>(done => eventStream.end(done)),
          new Promise<void>(done => frameStream.end(done))]);
      }
      assert(caseResult, 'heldout-case-result-missing'); results.push(caseResult);
      await saveJson(resolve(caseEvidence, 'CASE_RESULT.json'), caseResult);
      // One frozen batch preserves its first failure and never selects a later rerun.
      if (caseResult.status !== 'goal-verified') break;
    }
  } finally { await services.stop(); }
  const baselineHashAfter = await fileSha(baselinePath);
  assert(baselineHashAfter === baselineHashBefore, 'heldout-frozen-baseline-mutated');
  const passed = results.length === 4 && results.every(result => result.status === 'goal-verified'
    && result.targetBranchRetainedAcrossLook && result.baselineHashAfter === baselineHashBefore
    && heldoutCaseActionChainMatchesV2(result.mode, result.actions)
    && (result.mode !== 'post-look-public-view-deviation' || result.attentionDeviationNoticeCount > 0));
  const batch: MinecraftJointControlHeldoutBatchV2 = { version: 'MinecraftJointControlHeldoutBatchV2',
    baseline: { path: baseline.path, fileSha256: baseline.fileSha256,
      canonicalSha256: baseline.canonicalSha256, eventMapSha256: baseline.eventMapSha256, writes: 128 },
    cases: results, passed, oneFrozenBatch: true };
  await saveJson(resolve(evidence, 'HELDOUT_BATCH_RESULT.json'), batch);
  assert(passed, `minecraft-joint-control-heldout-batch-failed:${results.at(-1)?.caseId ?? 'no-case'}`);
  return batch;
}
