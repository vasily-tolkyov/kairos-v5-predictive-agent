import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Action, ActionCue, Observation, Prediction, RealEvent } from './contracts.js';
import type { Configuration } from './services.js';
import { MinecraftBody } from './body.js';
import { Compute } from './compute.js';
import { AttentionMonitor } from './attention/monitor.js';
import { actionObservationTrackedIdsV1, eventRows, cueIdentity, realEventHierarchyContinuityV1,
  validateEvent } from './events.js';
import { assert, saveJson, sha } from './util.js';
import { DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3, DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  type DistributedMemoryObservationReceiptV1 as MemoryObservationReceipt,
  type DistributedMemorySnapshotV3 as MemorySnapshot } from './distributed-hierarchical-memory.js';
import { PUBLIC_LAYOUT_SEMANTICS } from './public-context.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalReasoningPortV2, ContinuationPredictionV2, ContinuousPatternRecallV2 } from './control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2, type PhysicalControlResultV2,
  type PhysicalControlSnapshotV2 } from './control/controller.js';
import { ControlHabitWeightsV1, type ControlHabitCheckpointV1, type TrustedRealActionOutcomeV1 } from './control/habit.js';
import type { DistributedR2AInterventionPairV2 }
  from './core/learning/distributed-r2a-physical-contracts.js';

export interface ExperiencePointer {
  /** Untrusted on-disk discriminator. Production validates the exact V2 value before use. */
  readonly runtimeVersion: string;
  readonly sourceContextVersion: typeof PUBLIC_LAYOUT_SEMANTICS;
  readonly filename: string; readonly sha256: string;
  /** Optional so every legacy V1 pointer remains a valid zero-habit checkpoint. */
  readonly habitFilename?: string; readonly habitSha256?: string;
  /**
   * Optional producer provenance.  Ordinary runtime checkpoints do not need a
   * producer declaration; G6 frozen baselines do.  Keeping this out of the
   * generic snapshot hash lets old read-only pointers remain inspectable while
   * allowing the G6 gate to reject an unbound baseline explicitly.
   */
  readonly distributedG6Provenance?: DistributedG6ExperienceProvenanceV1;
  readonly actions: number; readonly eventCount: number; readonly writes: number;
}

export const DISTRIBUTED_G6_PROVENANCE_VERSION_V1 =
  'DistributedG6ExperienceProvenanceV1' as const;
export type DistributedG6ExperienceProducerV1 =
  | 'trusted-r1-rebuild-v1'
  | 'continuous-capture-v1';

/** Stable identities for the two producers permitted to create a G6 baseline. */
export const DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1 = sha({
  version: 'DistributedG6R1RebuildProducerContractV1',
  output: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  semantics: DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
});
export const DISTRIBUTED_G6_CONTINUOUS_CAPTURE_PRODUCER_IDENTITY_V1 = sha({
  version: 'DistributedG6ContinuousCaptureProducerContractV1',
  output: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  semantics: DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
});

/** Provenance carried by a pointer, never interpreted as a physical result. */
export interface DistributedG6ExperienceProvenanceV1 {
  readonly version: typeof DISTRIBUTED_G6_PROVENANCE_VERSION_V1;
  readonly producer: DistributedG6ExperienceProducerV1;
  readonly producerIdentitySha256: string;
  readonly sourceId: string;
  readonly sourceEventsSha256: string;
  readonly commitmentSha256: string;
}

export function distributedG6ProvenanceCommitmentV1(value: Pick<
  DistributedG6ExperienceProvenanceV1,
  'version' | 'producer' | 'producerIdentitySha256' | 'sourceId' | 'sourceEventsSha256'
>): string {
  // Pick is erased at runtime; explicitly project the committed fields so an
  // attached commitment or future metadata cannot recursively alter the hash.
  return sha({ version: value.version, producer: value.producer,
    producerIdentitySha256: value.producerIdentitySha256, sourceId: value.sourceId,
    sourceEventsSha256: value.sourceEventsSha256 });
}

export function createDistributedG6ProvenanceV1(value: Omit<
  DistributedG6ExperienceProvenanceV1, 'commitmentSha256'
>): DistributedG6ExperienceProvenanceV1 {
  assert(value.version === DISTRIBUTED_G6_PROVENANCE_VERSION_V1,
    'distributed-g6-provenance-version-invalid');
  assert(/^[a-f0-9]{64}$/.test(value.producerIdentitySha256)
    && /^[a-f0-9]{64}$/.test(value.sourceEventsSha256)
    && value.sourceId.length > 0, 'distributed-g6-provenance-fields-invalid');
  const commitmentSha256 = distributedG6ProvenanceCommitmentV1(value);
  return Object.freeze({ ...value, commitmentSha256 });
}

export function validateDistributedG6ProvenanceV1(value: unknown):
  asserts value is DistributedG6ExperienceProvenanceV1 {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value),
    'distributed-g6-provenance-invalid');
  const candidate = value as Record<string, unknown>;
  assert(candidate.version === DISTRIBUTED_G6_PROVENANCE_VERSION_V1
    && (candidate.producer === 'trusted-r1-rebuild-v1'
      || candidate.producer === 'continuous-capture-v1')
    && typeof candidate.producerIdentitySha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.producerIdentitySha256)
    && typeof candidate.sourceId === 'string' && candidate.sourceId.length > 0
    && typeof candidate.sourceEventsSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.sourceEventsSha256)
    && typeof candidate.commitmentSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.commitmentSha256),
    'distributed-g6-provenance-invalid');
  assert(distributedG6ProvenanceCommitmentV1(candidate as unknown as Pick<
    DistributedG6ExperienceProvenanceV1,
    'version' | 'producer' | 'producerIdentitySha256' | 'sourceId' | 'sourceEventsSha256'>)
    === candidate.commitmentSha256, 'distributed-g6-provenance-commitment-mismatch');
}
export interface DistributedExperiencePointerV2 extends ExperiencePointer {
  readonly runtimeVersion: 'KairosV5DistributedPhysicalRuntimeV1';
}
export interface RestoredExperience { readonly pointerPath: string; readonly snapshotPath: string;
  readonly habitPath: string | null; readonly pointer: ExperiencePointer;
  /** Untrusted until the V5Runtime constructor checks the distributed V2 contract. */
  readonly snapshot: unknown;
  readonly habit: ControlHabitWeightsV1; }
export interface RestoredDistributedExperienceV2 extends RestoredExperience {
  readonly pointer: DistributedExperiencePointerV2;
  readonly snapshot: MemorySnapshot;
}

export interface ExperienceBundleMetadataV1 {
  readonly actions: number; readonly eventCount: number; readonly writes: number;
  readonly distributedG6Provenance?: DistributedG6ExperienceProvenanceV1;
}

function assertDistributedMemorySnapshotV3(value: unknown): asserts value is MemorySnapshot {
  assert(typeof value === 'object' && value !== null
    && (value as { readonly version?: unknown }).version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3
    && (value as { readonly hierarchy?: unknown }).hierarchy === DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  'legacy-experience-snapshot-is-audit-only');
}

export async function saveExperienceBundleV1(directory: string,
  snapshot: unknown,
  metadata: ExperienceBundleMetadataV1, habit: ControlHabitWeightsV1): Promise<DistributedExperiencePointerV2> {
  assertDistributedMemorySnapshotV3(snapshot);
  assert(Number.isSafeInteger(metadata.actions) && metadata.actions >= 0, 'invalid-experience-actions');
  assert(Number.isSafeInteger(metadata.eventCount) && metadata.eventCount >= 0
    && metadata.eventCount === snapshot.seenEventIds.length, 'experience-event-count-mismatch');
  assert(Number.isSafeInteger(metadata.writes) && metadata.writes >= 0
    && metadata.writes === snapshot.writes, 'experience-write-count-mismatch');
  if (metadata.distributedG6Provenance !== undefined)
    validateDistributedG6ProvenanceV1(metadata.distributedG6Provenance);
  const suffix = metadata.eventCount.toString().padStart(4, '0');
  const filename = `experience-${suffix}.json`, habitFilename = `control-habit-${suffix}.json`;
  const habitCheckpoint = habit.exportCheckpoint();
  await saveJson(resolve(directory, filename), snapshot);
  await saveJson(resolve(directory, habitFilename), habitCheckpoint);
  const pointer: DistributedExperiencePointerV2 = { runtimeVersion: 'KairosV5DistributedPhysicalRuntimeV1',
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename, sha256: sha(snapshot),
    habitFilename, habitSha256: sha(habitCheckpoint), ...metadata };
  // CURRENT is committed last, so it never names only one half of a bundle.
  await saveJson(resolve(directory, 'EXPERIENCE_LATEST.json'), pointer);
  return pointer;
}

export function assertNewExperienceOutput(pointerPath: string | null, outputDirectory: string): void {
  if (pointerPath === null) return;
  const path = relative(dirname(pointerPath), resolve(outputDirectory));
  assert(isAbsolute(path) || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    'experience-source-directory-is-read-only');
}

/** Only a checkpoint written by this physical-control runtime can be resumed explicitly. */
export async function restoreExperience(compute: Compute, pointerPath: string | null):
Promise<RestoredDistributedExperienceV2 | null> {
  if (pointerPath === null) return null;
  assert(isAbsolute(pointerPath), 'experience-pointer-must-be-absolute');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ExperiencePointer;
  assert(pointer.runtimeVersion === 'KairosV5DistributedPhysicalRuntimeV1',
    'legacy-experience-pointer-is-audit-only');
  assert(pointer.sourceContextVersion === PUBLIC_LAYOUT_SEMANTICS, 'incompatible-experience-context-semantics');
  assert(typeof pointer.filename === 'string' && basename(pointer.filename) === pointer.filename
    && /^experience-\d+\.json$/.test(pointer.filename), 'invalid-experience-snapshot-filename');
  const snapshotPath = resolve(dirname(pointerPath), pointer.filename);
  const snapshot: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
  assertDistributedMemorySnapshotV3(snapshot);
  assert(sha(snapshot) === pointer.sha256, 'experience-snapshot-invalid');
  assert(snapshot.writes === pointer.writes && snapshot.seenEventIds.length === pointer.eventCount,
    'experience-pointer-count-mismatch');
  const hasHabitFilename = Object.hasOwn(pointer, 'habitFilename');
  const hasHabitSha256 = Object.hasOwn(pointer, 'habitSha256');
  assert(hasHabitFilename === hasHabitSha256, 'experience-pointer-incomplete-habit-reference');
  if (Object.hasOwn(pointer, 'distributedG6Provenance'))
    validateDistributedG6ProvenanceV1(pointer.distributedG6Provenance);
  let habitPath: string | null = null, habit = new ControlHabitWeightsV1();
  if (hasHabitFilename) {
    assert(typeof pointer.habitFilename === 'string' && basename(pointer.habitFilename) === pointer.habitFilename
      && /^control-habit-\d+\.json$/.test(pointer.habitFilename), 'invalid-control-habit-filename');
    assert(typeof pointer.habitSha256 === 'string' && /^[a-f0-9]{64}$/.test(pointer.habitSha256),
      'invalid-control-habit-sha256');
    habitPath = resolve(dirname(pointerPath), pointer.habitFilename);
    const checkpoint = JSON.parse(await readFile(habitPath, 'utf8')) as ControlHabitCheckpointV1;
    assert(sha(checkpoint) === pointer.habitSha256, 'control-habit-checkpoint-invalid');
    habit = ControlHabitWeightsV1.restore(checkpoint);
  }
  await compute.call('restore', snapshot);
  return { pointerPath, snapshotPath, habitPath,
    pointer: pointer as DistributedExperiencePointerV2, snapshot, habit };
}

export class V5Runtime implements PhysicalReasoningPortV2, PhysicalControlEnvironmentV2 {
  readonly compute: Compute;
  readonly attention: AttentionMonitor;
  readonly controller: PhysicalControlManagerV2;
  readonly #habit: ControlHabitWeightsV1;
  #recent: unknown[] = [];
  #actions = 0; #events = 0; #newEvents = 0; #writes = 0; #buffered = 0; #representationRejections = 0;
  #map: string | null = null;
  #lastSnapshot: MemorySnapshot | null = null;
  #pendingPassive: RealEvent[] = [];
  #learnedChanges: { start: number; end: number }[] = [];
  #habitObservationTime = 0;
  #periodicHabitSavePending = false;
  readonly #beforeObserve?: (completedEvents: number, event: RealEvent) => void;
  constructor(readonly body: MinecraftBody, readonly config: Configuration, readonly evidence: string,
    readonly record: (kind: string, value: unknown) => void, dependencies: { compute?: Compute;
      beforeObserve?: (completedEvents: number, event: RealEvent) => void; restoredExperience?: RestoredExperience | null;
      habit?: ControlHabitWeightsV1;
      controlOptions?: { readonly requirePredictionProgress?: boolean } } = {}) {
    this.compute = dependencies.compute ?? new Compute(); this.#beforeObserve = dependencies.beforeObserve;
    this.#habit = dependencies.restoredExperience?.habit ?? dependencies.habit ?? new ControlHabitWeightsV1();
    if (dependencies.restoredExperience) {
      assertNewExperienceOutput(dependencies.restoredExperience.pointerPath, evidence);
      const { snapshot, pointer } = dependencies.restoredExperience;
      assert(pointer.runtimeVersion === 'KairosV5DistributedPhysicalRuntimeV1',
        'legacy-experience-pointer-is-audit-only');
      assertDistributedMemorySnapshotV3(snapshot);
      this.#actions = pointer.actions;
      this.#events = snapshot.seenEventIds.length; this.#writes = snapshot.writes;
      this.#buffered = Math.min(snapshot.seenEventIds.length, 128);
      this.#map = snapshot.seenEventIds.length >= 128 ? sha(snapshot.r1.projection) : null;
      this.#lastSnapshot = snapshot;
      this.#habitObservationTime = snapshot.activeSeconds;
    }
    let controller: PhysicalControlManagerV2 | null = null;
    this.attention = new AttentionMonitor(this.compute, record, notice => controller?.interrupt(notice),
      event => { this.#pendingPassive.push(event); this.record('passive-event-queued', event); }, body.session.id);
    this.controller = controller = new PhysicalControlManagerV2(this, this, config.control, this.#habit,
      dependencies.controlOptions);
    body.on('frame', frame => this.attention.accept(frame));
  }
  get actions(): number { return this.#actions; }
  get actionCount(): number { return this.#actions; }
  get actionBudget(): number { return this.config.actionBudget; }
  get writes(): number { return this.#writes; }
  get eventCount(): number { return this.#events; }
  get newEventCount(): number { return this.#newEvents; }
  get snapshotForDisplay(): MemorySnapshot | null {
    return this.#lastSnapshot ? structuredClone(this.#lastSnapshot) : null;
  }
  /** The controller and runtime share this exact instance; display uses only exportCheckpoint(). */
  get habitWeights(): ControlHabitWeightsV1 { return this.#habit; }
  get habitCheckpointForDisplay(): ControlHabitCheckpointV1 { return this.#habit.exportCheckpoint(); }
  async commitHabitOutcome(outcome: TrustedRealActionOutcomeV1): Promise<void> {
    const result = this.#habit.applyTrustedRealActionOutcome(outcome);
    this.record('control-habit-real-outcome', { outcome, result });
    if (this.#periodicHabitSavePending) { this.#periodicHabitSavePending = false; await this.save(); }
  }
  get controlFieldForDisplay(): PhysicalControlSnapshotV2 | null {
    const snapshot = this.controller.snapshot;
    return snapshot ? structuredClone(snapshot) : null;
  }
  display(): unknown {
    const attention = this.attention.controller.snapshot();
    return structuredClone({ publicObservation: this.body.latest(), physicalEvents: this.#events,
      sessionPhysicalEvents: this.#newEvents,
      depositedEvents: this.#writes, initializationBuffered: this.#buffered, remainingActions: this.config.actionBudget - this.#actions,
      representationRejections: this.#representationRejections,
      physicalMap: this.#map, attention, controlField: this.controller.snapshot,
      controlHabits: this.#habit.exportCheckpoint(), recentRealEvents: this.#recent });
  }
  async observe(): Promise<Observation> {
    this.body.check(); this.attention.check(); const observation = this.body.latest();
    this.#advanceHabitTo(observation.activeSeconds); return structuredClone(observation);
  }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    const observation = await this.body.waitForObservationAfter(sequence);
    this.#advanceHabitTo(observation.activeSeconds); return observation;
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] { return this.body.listActionOffers(observation); }
  describeActionRequirement(actionCue: ActionCue, observation: Observation) {
    return this.body.describeActionRequirement(actionCue, observation);
  }
  async status(): Promise<{ ready: boolean; bufferedEvents: number; writes: number }> {
    return this.compute.call('status');
  }
  async #preparePhysical(observation: Observation): Promise<void> {
    await this.#settleThrough(observation); this.#advanceHabitTo(observation.activeSeconds);
    await this.compute.call('advance', observation.activeSeconds);
  }
  async recallByEffect(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): Promise<readonly EffectRecallCandidateV1[]> {
    await this.#preparePhysical(observation);
    return this.compute.call('recallByEffect', goal, evaluation, observation);
  }
  async recallAtomicEffect(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): Promise<readonly EffectRecallCandidateV1[]> {
    await this.#preparePhysical(observation);
    return this.compute.call('recallAtomicEffect', goal, evaluation, observation);
  }
  async recallContinuousPattern(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): Promise<readonly ContinuousPatternRecallV2[]> {
    await this.#preparePhysical(observation);
    return this.compute.call('recallContinuousPattern', goal, evaluation, observation);
  }
  async compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<ConditionApplicabilityV1> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('compareConditions', candidate, state);
  }
  async compareCurrentFactors(relationId: string, observation: Observation): Promise<ConditionApplicabilityV1> {
    await this.#preparePhysical(observation);
    return this.compute.call('compareCurrentFactors', relationId, observation);
  }
  async compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[], source: { readonly r1Active: boolean; readonly r2Active: boolean }) {
    await this.#preparePhysical(observation);
    return this.compute.call<readonly import('./control/contracts.js').ProjectedParentRelationApplicabilityV1[]>(
      'compareProjectedParentRelations', relationIds, observation, states, source);
  }
  async predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1): Promise<BranchPredictionV1> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('predictCandidate', candidate, state, goal, evaluation);
  }
  async recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    Promise<readonly OpaqueFactorTransitionTraceV1[]> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('recallFactorTransition', factorIds, state);
  }
  async predictContinuation(patternId: string, exactActionCue: ActionCue,
    observation: Observation): Promise<ContinuationPredictionV2> {
    await this.#preparePhysical(observation);
    return this.compute.call('predictContinuation', patternId, exactActionCue, observation);
  }
  async recordDistributedMatchedIntervention(evidence: DistributedR2AInterventionPairV2): Promise<void> {
    await this.compute.call('recordDistributedMatchedIntervention', evidence);
    this.#lastSnapshot = await this.compute.call<MemorySnapshot>('snapshot');
    this.record('distributed-matched-physical-intervention-recorded', evidence);
  }
  async executeOffer(offer: ActionOfferV1, observationScope: ActionObservationScopeV1): Promise<{ executed: boolean; observation: Observation; eventId: string | null;
    refusal?: 'action-budget-exhausted' | 'offer-stale' | 'target-unavailable' }> {
    if (this.#actions >= this.config.actionBudget) return { executed: false, observation: this.body.latest(), eventId: null,
      refusal: 'action-budget-exhausted' };
    this.body.check(); this.attention.check(); await this.#settleThrough(this.body.latest());
    const current = this.body.latest();
    const rebound = this.body.listActionOffers(current).find(value => cueIdentity(value.cue) === cueIdentity(offer.cue)
      && (offer.action.targetId === undefined || value.action.targetId === offer.action.targetId));
    if (!rebound) return { executed: false, observation: structuredClone(current), eventId: null,
      refusal: offer.action.targetId && !current.objects.some(value => value.id === offer.action.targetId)
        ? 'target-unavailable' : 'offer-stale' };
    this.attention.bindActionTarget(rebound.action.targetId ?? 'self');
    const execution = await this.body.execute(rebound.action, observationScope);
    if (execution.result.executed) this.#actions++;
    let eventId: string | null = null;
    if (execution.event) {
      this.attention.sealThrough(execution.event.frames.at(-1)!);
      const first = execution.event.frames[0]!, last = execution.event.frames.at(-1)!;
      const attended = this.attention.notices.filter(notice => notice.sequence > first.sequence
        && notice.sequence <= last.sequence).map(notice => notice.subjectId);
      const scopedEvent: RealEvent = { ...execution.event,
        trackedIds: actionObservationTrackedIdsV1(rebound.action.targetId, observationScope, attended,
          execution.event.frames) };
      const event: RealEvent = { ...scopedEvent,
        hierarchyContinuity: realEventHierarchyContinuityV1(scopedEvent, this.body.session.id) };
      await this.#flushPassive(first, true);
      const written = await this.#commitEvent(event); eventId = event.id;
      const changes = eventRows(event).changes.flat().map(change => ({ ...change,
        observationSequence: event.frames[change.observationIndex]!.sequence,
        activeSeconds: event.frames[change.observationIndex]!.activeSeconds }));
      this.#recent.push({ eventId, action: rebound.action, startSequence: first.sequence, endSequence: last.sequence,
        publicChanges: changes, learning: written }); this.#recent = this.#recent.slice(-8);
    }
    this.body.check(); this.attention.check();
    return { executed: execution.result.executed, observation: structuredClone(this.body.latest()), eventId,
      ...(execution.result.executed ? {} : { refusal: execution.result.status === 'no-target'
        || execution.result.status === 'out-of-reach' ? 'target-unavailable' as const : 'offer-stale' as const }) };
  }
  #passiveSlice(event: RealEvent, start: number, end: number): RealEvent {
    if (start === 0 && end === event.frames.length - 1) return event;
    const frames = event.frames.slice(start, end + 1);
    const unclassified: RealEvent = { ...event,
      id: `${event.id}:frames:${frames[0]!.sequence}-${frames.at(-1)!.sequence}`, frames,
      hierarchyContinuity: undefined };
    const segment: RealEvent = { ...unclassified,
      hierarchyContinuity: realEventHierarchyContinuityV1(unclassified, this.body.session.id) };
    this.record('passive-event-segment', { sourceEventId: event.id, sourceSha256: sha(event), segmentId: segment.id,
      retainedOriginalSequences: frames.map(frame => frame.sequence) }); return segment;
  }
  #uncoveredPassive(event: RealEvent): RealEvent[] {
    const segments: RealEvent[] = []; let start: number | null = null;
    for (let index = 1; index < event.frames.length; index++) {
      const sequence = event.frames[index]!.sequence;
      const covered = this.#learnedChanges.some(range => range.start < sequence && sequence <= range.end);
      if (!covered && start === null) start = index - 1;
      if (covered && start !== null) { segments.push(this.#passiveSlice(event, start, index - 1)); start = null; }
    }
    if (start !== null) segments.push(this.#passiveSlice(event, start, event.frames.length - 1));
    return segments;
  }
  async #settleThrough(observation: Observation): Promise<void> {
    this.attention.sealThrough(observation); await this.#flushPassive(observation, true);
  }
  async #flushPassive(observation: Observation, splitAtCutoff = false): Promise<void> {
    const pending = this.#pendingPassive; this.#pendingPassive = []; const eligible: RealEvent[] = [];
    for (const event of pending) {
      validateEvent(event);
      if (event.frames.at(-1)!.sequence <= observation.sequence && event.frames.at(-1)!.activeSeconds <= observation.activeSeconds) eligible.push(event);
      else {
        const boundary = splitAtCutoff ? event.frames.findIndex(frame => frame.sequence === observation.sequence) : -1;
        if (boundary > 0) { eligible.push(this.#passiveSlice(event, 0, boundary));
          this.#pendingPassive.push(this.#passiveSlice(event, boundary, event.frames.length - 1)); }
        else this.#pendingPassive.push(event);
      }
    }
    eligible.sort((left, right) => left.frames.at(-1)!.activeSeconds - right.frames.at(-1)!.activeSeconds);
    for (const event of eligible) for (const segment of this.#uncoveredPassive(event)) {
      const changes = eventRows(segment).changes.flat();
      if (!changes.some(change => change.before !== change.after)) continue;
      const written = await this.#commitEvent(segment);
      this.#recent.push({ eventId: segment.id, provenance: 'real-passive', changes: changes.slice(-12), learning: written });
      this.#recent = this.#recent.slice(-8);
    }
  }
  async #commitEvent(event: RealEvent): Promise<MemoryObservationReceipt> {
    const start = event.frames[0]!.sequence, end = event.frames.at(-1)!.sequence;
    assert(!this.#learnedChanges.some(range => range.start < end && start < range.end), 'real-event-change-already-owned');
    const eventTime = event.frames.at(-1)!.activeSeconds; this.#advanceHabitTo(eventTime);
    this.#beforeObserve?.(this.#newEvents, event); this.record('real-event', event);
    const written = await this.compute.call<MemoryObservationReceipt>('observe', event);
    if (written.status === 'real-event-not-representable') this.#representationRejections++;
    this.#learnedChanges.push({ start, end }); this.#events++; this.#newEvents++; this.#writes = written.writes;
    this.#buffered = written.buffered; this.#map = written.mapSha256;
    this.record('real-event-committed', { eventId: event.id, provenance: event.provenance,
      observationWindow: [start, end], eventCount: this.#events, learning: written });
    if (this.#newEvents % 32 === 0) {
      // An executed action's progress signal is computed by the controller after executeOffer returns.
      // Commit CURRENT only after that real result has updated the shared habit instance.
      if (event.provenance === 'executed-real-body') this.#periodicHabitSavePending = true;
      else await this.save();
    }
    return written;
  }
  #advanceHabitTo(activeSeconds: number): void {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= 0, 'invalid-control-habit-observation-time');
    // A sealed passive window can be committed after a newer public observation. Its elapsed
    // time was already accounted for; never recover the habit twice or move its clock backward.
    if (activeSeconds <= this.#habitObservationTime) return;
    this.#habit.advanceActiveTime(activeSeconds - this.#habitObservationTime); this.#habitObservationTime = activeSeconds;
  }
  async save(): Promise<void> {
    const snapshot = await this.compute.call<MemorySnapshot>('snapshot'); this.#lastSnapshot = snapshot;
    await saveExperienceBundleV1(this.evidence, snapshot, { actions: this.#actions,
      eventCount: this.#events, writes: this.#writes }, this.#habit);
  }
  async initializeFromRealExploration(): Promise<PhysicalControlResultV2> { return this.controller.initializeFromRealExploration(); }
  async exploreUntil(stopCondition: (observation: Observation) => boolean): Promise<PhysicalControlResultV2> {
    return this.controller.exploreUntil(stopCondition);
  }
  async runGoal(goal: GroundedGoalV1): Promise<PhysicalControlResultV2> { return this.controller.runGoal(goal); }
  async close(): Promise<void> {
    try {
      const observation = this.body.latest();
      await this.#settleThrough(observation);
      await this.compute.call('closeContinuity', { version: 'R2EventBoundaryV1',
        completion: 'censored', reason: 'session-ended' });
      // The final checkpoint must include passive facts sealed at shutdown and
      // the explicit R2 session boundary while the memory worker is still live.
      await this.save();
    } finally {
      try { await this.body.close(); }
      finally { await this.compute.close(); }
    }
  }
}
