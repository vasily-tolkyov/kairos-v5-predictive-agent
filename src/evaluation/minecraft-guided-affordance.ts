import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Action, ActionCue, Observation, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import { cueFor, cueIdentity, eventRows } from '../events.js';
import type { MemoryObservationReceipt, MemorySnapshot } from '../memory.js';
import { Services, type Configuration } from '../services.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2 } from '../control/controller.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, ContinuationPredictionV2,
  ContinuousPatternRecallV2, EffectRecallCandidateV1,
  GoalEvaluationV1, GroundedGoalV1, HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalReasoningPortV2, ProjectedParentRelationApplicabilityV1 } from '../control/contracts.js';
import { assert, canonical, saveJson, sha } from '../util.js';
import { prepareGuidedNoteFixtureLiveV1, type FixtureSideV1,
  type GuidedMinecraftLayoutV1 } from './minecraft-note-fixture-v1.js';
export { guidedFixtureGeometryV1, prepareGuidedNoteFixtureLiveV1,
  type FixtureSideV1, type GuidedMinecraftLayoutV1 } from './minecraft-note-fixture-v1.js';

export type GuidedMinecraftModeV1 = 'look-plus-acquire' | 'look-plus-away' | 'look-minus-acquire'
  | 'look-minus-away' | 'interact-on' | 'interact-off' | 'observe';

export interface GuidedMinecraftTrainingItemV1 {
  readonly index: number;
  readonly layoutIndex: number;
  readonly mode: GuidedMinecraftModeV1;
}

const TRAINING_PATTERN: readonly GuidedMinecraftModeV1[] = ['look-plus-acquire', 'look-plus-away',
  'look-minus-acquire', 'look-minus-away', 'interact-on', 'interact-off', 'observe', 'observe'];
const SIDES: readonly FixtureSideV1[] = ['south', 'east', 'north', 'west'];

export function guidedMinecraftTrainingPlanV1(): readonly GuidedMinecraftTrainingItemV1[] {
  return Array.from({ length: 128 }, (_, index) => ({ index, layoutIndex: Math.floor(index / 8) % 8,
    mode: TRAINING_PATTERN[index % TRAINING_PATTERN.length]! }));
}

export function guidedMinecraftTrainingLayoutV1(index: number): GuidedMinecraftLayoutV1 {
  assert(Number.isInteger(index) && index >= 0 && index < 8, 'invalid-guided-training-layout');
  return { id: `training-layout-${index}`, originX: 100, originZ: 100, side: SIDES[index % 4]!,
    markerVariant: index < 4 ? 0 : 1 };
}

export const guidedMinecraftHeldOutLayoutsV1: readonly GuidedMinecraftLayoutV1[] = [
  { id: 'held-out-layout-101', originX: 108, originZ: 106, side: 'south', markerVariant: 2 },
  { id: 'held-out-layout-102', originX: 92, originZ: 94, side: 'east', markerVariant: 2 },
];

function targetOffset(mode: GuidedMinecraftModeV1): number {
  if (mode === 'look-plus-acquire') return -15;
  if (mode === 'look-plus-away') return 15;
  if (mode === 'look-minus-acquire') return 15;
  if (mode === 'look-minus-away') return -15;
  return 0;
}

function actionFor(mode: GuidedMinecraftModeV1, observation: Observation): Action {
  if (mode.startsWith('look-plus')) return { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } };
  if (mode.startsWith('look-minus')) return { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } };
  if (mode === 'observe') return { kind: 'observe', parameters: { ticks: 5 } };
  const control = observation.objects.find(object => object.type === 'note_block');
  assert(control && observation.targetId === control.id, 'guided-interaction-requires-real-crosshair-control');
  return { kind: 'interact', parameters: {}, targetId: control.id };
}

function publicObject(observation: Observation, type: string) {
  const objects = observation.objects.filter(object => object.type === type);
  assert(objects.length === 1, `expected-one-public-${type}:${objects.length}`);
  return objects[0]!;
}

async function configureFixture(services: Services, body: MinecraftBody, layout: GuidedMinecraftLayoutV1,
  powered: boolean, yawOffsetDegrees: number): Promise<{ observation: Observation; controlId: string }> {
  return prepareGuidedNoteFixtureLiveV1(services, body, layout, powered ? 1 : 0, yawOffsetDegrees);
}

function assertTrainingOutcome(mode: GuidedMinecraftModeV1, event: RealEvent): void {
  const final = event.frames.at(-1)!, control = final.objects.find(object => object.type === 'note_block');
  assert(control, 'real-training-event-lost-public-control');
  const finalTarget = final.objects.find(object => object.id === final.targetId);
  if (mode.endsWith('acquire')) assert(finalTarget?.type === 'note_block', 'guided-look-did-not-acquire-control');
  if (mode.endsWith('away')) assert(finalTarget?.type !== 'note_block', 'guided-away-look-accidentally-acquired-control');
  if (mode === 'interact-on') assert(control.properties.note === '1', 'guided-interact-did-not-reach-target-note');
  if (mode === 'interact-off') assert(control.properties.note === '2', 'guided-interact-did-not-reach-contrast-note');
  const changes = eventRows(event).changes.flat();
  if (mode === 'interact-on') assert(changes.some(change => change.subject.startsWith('note_block#')
    && change.property === 'note' && change.before === '0' && change.after === '1'), 'missing-real-control-target-change');
  if (mode === 'interact-off') assert(changes.some(change => change.subject.startsWith('note_block#')
    && change.property === 'note' && change.before === '1' && change.after === '2'), 'missing-real-control-contrast-change');
}

class WorkerPhysicalReasoningPortV2 implements PhysicalReasoningPortV2 {
  constructor(readonly compute: Compute) {}
  recallByEffect(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.compute.call<readonly EffectRecallCandidateV1[]>('recallByEffect', goal, difference, observation);
  }
  recallAtomicEffect(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.compute.call<readonly EffectRecallCandidateV1[]>('recallAtomicEffect', goal, difference, observation);
  }
  recallContinuousPattern(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.compute.call<readonly ContinuousPatternRecallV2[]>('recallContinuousPattern', goal, difference, observation);
  }
  compareCurrentFactors(relationId: string, observation: Observation) {
    return this.compute.call<ConditionApplicabilityV1>('compareCurrentFactors', relationId, observation);
  }
  compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[],
    source: { readonly r1Active: boolean; readonly r2Active: boolean }) {
    return this.compute.call<readonly ProjectedParentRelationApplicabilityV1[]>(
      'compareProjectedParentRelations', relationIds, observation, states, source);
  }
  predictContinuation(patternId: string, exactActionCue: ActionCue, observation: Observation) {
    return this.compute.call<ContinuationPredictionV2>('predictContinuation', patternId, exactActionCue, observation);
  }
  compareConditions(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1) {
    return this.compute.call<ConditionApplicabilityV1>('compareConditions', candidate, state);
  }
  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1) {
    return this.compute.call<BranchPredictionV1>('predictCandidate', candidate, state, goal, evaluation);
  }
  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1) {
    return this.compute.call<readonly OpaqueFactorTransitionTraceV1[]>('recallFactorTransition', factorIds, state);
  }
}

class ReadOnlyMinecraftEvaluationEnvironmentV1 implements PhysicalControlEnvironmentV2 {
  readonly actionBudget = 8;
  actionCount = 0;
  readonly timeline: Array<{ kind: string; value: unknown }> = [];
  constructor(readonly body: MinecraftBody, readonly compute: Compute) {}
  async observe(): Promise<Observation> { return structuredClone(this.body.latest()); }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    return this.body.waitForObservationAfter(sequence);
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] { return this.body.listActionOffers(observation); }
  describeActionRequirement(actionCue: EffectRecallCandidateV1['actionCue'], observation: Observation) {
    return this.body.describeActionRequirement(actionCue, observation);
  }
  async executeOffer(offer: ActionOfferV1): Promise<{ executed: boolean; observation: Observation; eventId: string | null }> {
    assert(this.actionCount < this.actionBudget, 'guided-evaluation-action-budget-exhausted');
    const current = this.body.latest();
    const rebound = this.body.listActionOffers(current).find(candidate => cueIdentity(candidate.cue) === cueIdentity(offer.cue));
    assert(rebound, 'guided-evaluation-offer-not-available');
    const execution = await this.body.execute(rebound.action);
    if (execution.result.executed) this.actionCount++;
    this.timeline.push({ kind: 'physical-action', value: { offer: rebound, result: execution.result,
      event: execution.event, learned: false } });
    return { executed: execution.result.executed, observation: structuredClone(this.body.latest()),
      eventId: execution.event?.id ?? null };
  }
  async status(): Promise<{ ready: boolean; bufferedEvents: number; writes: number }> {
    const status = await this.compute.call<{ ready: boolean; bufferedEvents: number; writes: number }>('status');
    return status;
  }
  record(kind: string, value: unknown): void { this.timeline.push({ kind, value: structuredClone(value) }); }
}

export interface MinecraftGuidedAffordanceEvaluationV1 {
  readonly version: 'MinecraftGuidedAffordanceEvaluationV1';
  readonly fixtureVerification: unknown;
  readonly training: { readonly realEvents: 128; readonly contexts: number; readonly modes: Readonly<Record<string, number>>;
    readonly mapSha256: string; readonly memorySha256: string; readonly writes: number };
  readonly heldOutCases: readonly { readonly layoutId: string; readonly status: string; readonly controlTargetReached: boolean;
    readonly actions: readonly string[]; readonly memoryBefore: string; readonly memoryAfter: string;
    readonly timeline: readonly unknown[] }[];
}

export async function runMinecraftGuidedAffordanceEvaluationV1(config: Configuration,
  evidence: string): Promise<MinecraftGuidedAffordanceEvaluationV1> {
  await mkdir(evidence, { recursive: true });
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown) => (kind === 'frame' ? frames : events)
    .write(canonical({ kind, value }) + '\n');
  const runRoot = resolve(config.runtimeRoot, `guided-affordance-${Date.now()}`);
  const services = new Services(config, runRoot, evidence); const compute = new Compute();
  let body: MinecraftBody | null = null;
  try {
    await services.start('empty');
    body = new MinecraftBody({ ...config.minecraft, worldId: 'guided-affordance-real-v1' }, record);
    await body.ready();
    // Keep the isolated evaluation area outside vanilla's operator-only spawn protection.
    services.command('setworldspawn 1000 64 1000'); services.command('gamerule spawnRadius 0');
    services.command('forceload add 80 80 120 120'); await body.waitTicks(60);

    const verificationLayout = guidedMinecraftTrainingLayoutV1(0);
    const verificationStart = await configureFixture(services, body, verificationLayout, false, 0);
    assert(publicObject(verificationStart.observation, 'note_block').properties.note === '0', 'fixture-control-not-initial-state');
    const verificationOn = await body.execute(actionFor('interact-on', body.latest()));
    assert(verificationOn.result.executed, 'fixture-verification-on-not-executed');
    const afterOn = body.latest();
    assert(publicObject(afterOn, 'note_block').properties.note === '1', 'fixture-control-did-not-reach-target-state');
    await body.waitTicks(10);
    assert(publicObject(body.latest(), 'note_block').properties.note === '1', 'fixture-control-state-not-persistent');
    const verificationOff = await body.execute(actionFor('interact-off', body.latest()));
    assert(verificationOff.result.executed && publicObject(body.latest(), 'note_block').properties.note === '2',
      'fixture-verification-off-failed');
    const fixtureVerification = { layout: verificationLayout, start: verificationStart.observation,
      onReceipt: verificationOn.result, onObservation: afterOn, offReceipt: verificationOff.result,
      finalObservation: body.latest(), learnedEvents: 0, persistentTicks: 10 };
    await saveJson(resolve(evidence, 'FIXTURE_VERIFICATION.json'), fixtureVerification);

    const contextIds = new Set<string>(), modeCounts: Record<string, number> = {};
    const trainingTimeline: unknown[] = [];
    for (const item of guidedMinecraftTrainingPlanV1()) {
      const layout = guidedMinecraftTrainingLayoutV1(item.layoutIndex);
      const powered = item.mode === 'interact-off' || (item.mode === 'observe' && item.index % 16 >= 8);
      const setup = await configureFixture(services, body, layout, powered, targetOffset(item.mode));
      const action = actionFor(item.mode, setup.observation), execution = await body.execute(action);
      assert(execution.result.executed && execution.event, `real-guided-action-failed:${item.index}:${item.mode}`);
      assertTrainingOutcome(item.mode, execution.event);
      const receipt = await compute.call<MemoryObservationReceipt>('observe', execution.event);
      contextIds.add(execution.event.frames[0]!.contextId); modeCounts[item.mode] = (modeCounts[item.mode] ?? 0) + 1;
      const entry = { item, layout, action, receipt, eventId: execution.event.id,
        observationWindow: [execution.event.frames[0]!.sequence, execution.event.frames.at(-1)!.sequence],
        contextId: execution.event.frames[0]!.contextId, changes: eventRows(execution.event).changes.flat() };
      trainingTimeline.push(entry); record('guided-training-event', entry);
    }
    const status = await compute.call<{ ready: boolean; bufferedEvents: number; writes: number; mapSha256: string | null }>('status');
    assert(status.ready && status.mapSha256 && status.writes === 128, 'real-guided-memory-did-not-initialize');
    assert(contextIds.size >= 4, `insufficient-real-public-contexts:${contextIds.size}`);
    const frozen = await compute.call<MemorySnapshot>('snapshot'), memorySha256 = sha(frozen);
    await saveJson(resolve(evidence, 'GUIDED_TRAINING_TIMELINE.json'), trainingTimeline);
    await saveJson(resolve(evidence, 'FROZEN_REAL_EXPERIENCE.json'), frozen);

    const heldOutCases: MinecraftGuidedAffordanceEvaluationV1['heldOutCases'][number][] = [];
    for (const [caseIndex, layout] of guidedMinecraftHeldOutLayoutsV1.entries()) {
      const setup = await configureFixture(services, body, layout, false, caseIndex === 0 ? -15 : 15);
      const control = publicObject(setup.observation, 'note_block');
      const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: `held-out-control-note-one:${layout.id}`,
        expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'control-note-one',
          subject: { kind: 'public-object', id: control.id, expectedType: 'note_block' }, observable: 'properties.note',
          comparator: 'equals', target: '1' } } };
      const memoryBefore = await compute.call<string>('hash');
      const environment = new ReadOnlyMinecraftEvaluationEnvironmentV1(body, compute);
      const manager = new PhysicalControlManagerV2(new WorkerPhysicalReasoningPortV2(compute), environment, config.control);
      const result = await manager.runGoal(goal), final = body.latest(), memoryAfter = await compute.call<string>('hash');
      const targetReached = publicObject(final, 'note_block').properties.note === '1';
      const actions = environment.timeline.filter(item => item.kind === 'physical-action')
        .map(item => ((item.value as { offer: ActionOfferV1 }).offer.action.kind));
      const heldOutAttempt = { layoutId: layout.id, status: result.status, controlTargetReached: targetReached,
        actions, memoryBefore, memoryAfter, timeline: structuredClone(environment.timeline) };
      await saveJson(resolve(evidence, `HELD_OUT_CASE_ATTEMPT_${caseIndex + 1}.json`), heldOutAttempt);
      assert(result.status === 'goal-verified' && targetReached, `held-out-real-goal-failed:${layout.id}:${result.status}`);
      assert(actions.includes('look') && actions.includes('interact'), `held-out-real-action-chain-incomplete:${layout.id}`);
      assert(memoryBefore === memoryAfter && memoryAfter === memorySha256, 'held-out-evaluation-mutated-long-term-memory');
      heldOutCases.push(heldOutAttempt);
    }
    const result: MinecraftGuidedAffordanceEvaluationV1 = { version: 'MinecraftGuidedAffordanceEvaluationV1',
      fixtureVerification, training: { realEvents: 128, contexts: contextIds.size, modes: modeCounts,
        mapSha256: status.mapSha256, memorySha256, writes: status.writes }, heldOutCases };
    await saveJson(resolve(evidence, 'EVALUATION_RESULT.json'), result); return result;
  } finally {
    await body?.close(); await compute.close(); await services.stop();
    await Promise.all([new Promise<void>(done => events.end(done)), new Promise<void>(done => frames.end(done))]);
  }
}
