import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Action, ActionCue, Observation, Prediction, RealEvent } from './contracts.js';
import type { Configuration } from './services.js';
import { MinecraftBody } from './body.js';
import { Compute } from './compute.js';
import { AttentionMonitor } from './attention/monitor.js';
import { eventRows, cueIdentity, validateEvent } from './events.js';
import { assert, saveJson, sha } from './util.js';
import type { MemoryObservationReceipt, MemorySnapshot } from './memory.js';
import { PUBLIC_LAYOUT_SEMANTICS } from './public-context.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalReasoningPortV1 } from './control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2, type PhysicalControlResultV2,
  type PhysicalControlSnapshotV2 } from './control/controller.js';
import { ControlHabitWeightsV1, type ControlHabitCheckpointV1, type TrustedRealActionOutcomeV1 } from './control/habit.js';

export interface ExperiencePointer {
  readonly runtimeVersion: 'KairosV5PhysicalControlRuntimeV1';
  readonly sourceContextVersion: typeof PUBLIC_LAYOUT_SEMANTICS;
  readonly filename: string; readonly sha256: string;
  /** Optional so every legacy V1 pointer remains a valid zero-habit checkpoint. */
  readonly habitFilename?: string; readonly habitSha256?: string;
  readonly actions: number; readonly eventCount: number; readonly writes: number;
}
export interface RestoredExperience { readonly pointerPath: string; readonly snapshotPath: string;
  readonly habitPath: string | null; readonly pointer: ExperiencePointer; readonly snapshot: MemorySnapshot;
  readonly habit: ControlHabitWeightsV1; }

export interface ExperienceBundleMetadataV1 {
  readonly actions: number; readonly eventCount: number; readonly writes: number;
}

export async function saveExperienceBundleV1(directory: string, snapshot: MemorySnapshot,
  metadata: ExperienceBundleMetadataV1, habit: ControlHabitWeightsV1): Promise<ExperiencePointer> {
  assert(Number.isSafeInteger(metadata.actions) && metadata.actions >= 0, 'invalid-experience-actions');
  assert(Number.isSafeInteger(metadata.eventCount) && metadata.eventCount >= 0
    && metadata.eventCount === snapshot.seenEventIds.length, 'experience-event-count-mismatch');
  assert(Number.isSafeInteger(metadata.writes) && metadata.writes >= 0
    && metadata.writes === snapshot.writes, 'experience-write-count-mismatch');
  const suffix = metadata.eventCount.toString().padStart(4, '0');
  const filename = `experience-${suffix}.json`, habitFilename = `control-habit-${suffix}.json`;
  const habitCheckpoint = habit.exportCheckpoint();
  await saveJson(resolve(directory, filename), snapshot);
  await saveJson(resolve(directory, habitFilename), habitCheckpoint);
  const pointer: ExperiencePointer = { runtimeVersion: 'KairosV5PhysicalControlRuntimeV1',
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
export async function restoreExperience(compute: Compute, pointerPath: string | null): Promise<RestoredExperience | null> {
  if (pointerPath === null) return null;
  assert(isAbsolute(pointerPath), 'experience-pointer-must-be-absolute');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ExperiencePointer;
  assert(pointer.runtimeVersion === 'KairosV5PhysicalControlRuntimeV1', 'incompatible-experience-pointer-rejected');
  assert(pointer.sourceContextVersion === PUBLIC_LAYOUT_SEMANTICS, 'incompatible-experience-context-semantics');
  assert(typeof pointer.filename === 'string' && basename(pointer.filename) === pointer.filename
    && /^experience-\d+\.json$/.test(pointer.filename), 'invalid-experience-snapshot-filename');
  const snapshotPath = resolve(dirname(pointerPath), pointer.filename);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as MemorySnapshot;
  assert(sha(snapshot) === pointer.sha256 && snapshot.version === 'KairosV5MemoryV4', 'experience-snapshot-invalid');
  assert(snapshot.writes === pointer.writes && snapshot.seenEventIds.length === pointer.eventCount,
    'experience-pointer-count-mismatch');
  const hasHabitFilename = Object.hasOwn(pointer, 'habitFilename');
  const hasHabitSha256 = Object.hasOwn(pointer, 'habitSha256');
  assert(hasHabitFilename === hasHabitSha256, 'experience-pointer-incomplete-habit-reference');
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
  return { pointerPath, snapshotPath, habitPath, pointer, snapshot, habit };
}

export class V5Runtime implements PhysicalReasoningPortV1, PhysicalControlEnvironmentV2 {
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
      habit?: ControlHabitWeightsV1 } = {}) {
    this.compute = dependencies.compute ?? new Compute(); this.#beforeObserve = dependencies.beforeObserve;
    this.#habit = dependencies.restoredExperience?.habit ?? dependencies.habit ?? new ControlHabitWeightsV1();
    if (dependencies.restoredExperience) {
      assertNewExperienceOutput(dependencies.restoredExperience.pointerPath, evidence);
      const { snapshot, pointer } = dependencies.restoredExperience;
      this.#actions = pointer.actions;
      this.#events = snapshot.seenEventIds.length; this.#writes = snapshot.writes;
      this.#buffered = snapshot.pendingInitialization.length; this.#map = snapshot.eventMap ? sha(snapshot.eventMap) : null;
      this.#lastSnapshot = snapshot;
      this.#habitObservationTime = snapshot.activeSeconds;
    }
    let controller: PhysicalControlManagerV2 | null = null;
    this.attention = new AttentionMonitor(this.compute, record, notice => controller?.interrupt(notice),
      event => { this.#pendingPassive.push(event); this.record('passive-event-queued', event); }, body.session.id);
    this.controller = controller = new PhysicalControlManagerV2(this, this, config.control, this.#habit);
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
  async compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<ConditionApplicabilityV1> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('compareConditions', candidate, state);
  }
  async predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1): Promise<BranchPredictionV1> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('predictCandidate', candidate, state, goal);
  }
  async recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    Promise<readonly OpaqueFactorTransitionTraceV1[]> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('recallFactorTransition', factorIds, state);
  }
  async executeOffer(offer: ActionOfferV1): Promise<{ executed: boolean; observation: Observation; eventId: string | null;
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
    const execution = await this.body.execute(rebound.action);
    if (execution.result.executed) this.#actions++;
    let eventId: string | null = null;
    if (execution.event) {
      this.attention.sealThrough(execution.event.frames.at(-1)!);
      await this.#flushPassive(execution.event.frames[0]!, true);
      const written = await this.#commitEvent(execution.event); eventId = execution.event.id;
      const first = execution.event.frames[0]!, last = execution.event.frames.at(-1)!;
      const changes = eventRows(execution.event).changes.flat().map(change => ({ ...change,
        observationSequence: execution.event!.frames[change.observationIndex]!.sequence,
        activeSeconds: execution.event!.frames[change.observationIndex]!.activeSeconds }));
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
    const segment = { ...event, id: `${event.id}:frames:${frames[0]!.sequence}-${frames.at(-1)!.sequence}`, frames };
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
  async close(): Promise<void> { await this.body.close(); await this.compute.close(); }
}
