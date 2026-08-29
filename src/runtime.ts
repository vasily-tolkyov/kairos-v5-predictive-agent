import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Action, DesiredChange, Observation, Prediction, RealEvent } from './contracts.js';
import type { Configuration } from './services.js';
import { MinecraftBody } from './body.js';
import { Compute } from './compute.js';
import { AnalysisCore, type AnalysisTools, type AnalysisHooks } from './analysis.js';
import { PublicObjectAliases } from './analysis-actions.js';
import { AttentionMonitor } from './attention/monitor.js';
import { cueFor, eventRows, validateEvent } from './events.js';
import { assert, saveJson, sha } from './util.js';
import type { MemorySnapshot } from './memory.js';
import { PUBLIC_LAYOUT_SEMANTICS } from './public-context.js';

export interface ExperiencePointer {
  readonly sourceContextVersion: typeof PUBLIC_LAYOUT_SEMANTICS;
  readonly filename: string; readonly sha256: string;
  readonly actions: number; readonly eventCount: number; readonly writes: number;
}
export interface RestoredExperience { readonly pointerPath: string; readonly snapshotPath: string;
  readonly pointer: ExperiencePointer; readonly snapshot: MemorySnapshot; }

export function assertNewExperienceOutput(pointerPath: string | null, outputDirectory: string): void {
  if (pointerPath === null) return;
  const path = relative(dirname(pointerPath), resolve(outputDirectory));
  assert(isAbsolute(path) || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    'experience-source-directory-is-read-only');
}

/** Read one explicit source, restore the existing worker before any new body frame. No fallback. */
export async function restoreExperience(compute: Compute, pointerPath: string | null): Promise<RestoredExperience | null> {
  if (pointerPath === null) return null;
  assert(isAbsolute(pointerPath), 'experience-pointer-must-be-absolute');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ExperiencePointer;
  assert(pointer.sourceContextVersion === PUBLIC_LAYOUT_SEMANTICS, 'incompatible-experience-context-semantics');
  assert(typeof pointer.filename === 'string' && basename(pointer.filename) === pointer.filename
    && /^experience-\d+\.json$/.test(pointer.filename), 'invalid-experience-snapshot-filename');
  const snapshotPath = resolve(dirname(pointerPath), pointer.filename);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as MemorySnapshot;
  assert(sha(snapshot) === pointer.sha256, 'experience-snapshot-hash-mismatch');
  assert(snapshot.version === 'KairosV5Memory', 'V5-rejects-legacy-experience');
  assert(Number.isFinite(snapshot.activeSeconds) && snapshot.activeSeconds >= 0, 'invalid-experience-time-offset');
  assert(snapshot.writes === pointer.writes && snapshot.seenEventIds.length === pointer.eventCount,
    'experience-pointer-count-mismatch');
  const compatible = (context: string) => context.startsWith(`${PUBLIC_LAYOUT_SEMANTICS}:`);
  assert(snapshot.pendingInitialization.every(event => event.frames.every(frame => compatible(frame.contextId)))
    && snapshot.annotations.every(annotation => compatible(annotation.contextId)), 'incompatible-stored-context-id');
  await compute.call('restore', snapshot);
  return { pointerPath, snapshotPath, pointer, snapshot };
}

function compactPrediction(prediction: Prediction): unknown {
  const outcomes = new Map<string, { change: unknown; sampleCount: number }>();
  for (const sample of prediction.samples) {
    const distinct = new Map(sample.readout.flatMap(read => read.changes).map(change =>
      [sha({ subject: change.subject, property: change.property, before: change.before, after: change.after }), change]));
    for (const [key, change] of distinct) {
      const entry = outcomes.get(key) ?? { change, sampleCount: 0 };
      entry.sampleCount++; outcomes.set(key, entry);
    }
  }
  const rawEvidence = prediction.evidence as { evidence?: unknown } | null;
  return { kind: prediction.kind, support: prediction.support, calibratedProbability: false, unknown: prediction.unknown,
    evidence: rawEvidence?.evidence ?? rawEvidence, sampleCount: prediction.samples.length,
    outcomes: [...outcomes.values()].slice(0, 16), omittedOutcomeCount: Math.max(0, outcomes.size - 16),
    traceReferences: [...new Set(prediction.samples.map(sample => `${sample.pageId}/${sample.traceId}`))] };
}
export class V5Runtime implements AnalysisTools {
  readonly compute: Compute;
  readonly analysis: AnalysisCore;
  readonly attention: AttentionMonitor;
  readonly aliases = new PublicObjectAliases();
  #recent: unknown[] = [];
  #lastPrediction: unknown = null;
  #lastRecall: unknown = null;
  #actions = 0;
  #events = 0;
  #newEvents = 0;
  #writes = 0;
  #buffered = 0;
  #map: string | null = null;
  #lastSnapshot: MemorySnapshot | null = null;
  #pendingPassive: RealEvent[] = [];
  // Each interval owns changes (start, end], not the baseline frame itself.
  #learnedChanges: { start: number; end: number }[] = [];
  readonly #beforeObserve?: (completedEvents: number, event: RealEvent) => void;
  constructor(readonly body: MinecraftBody, readonly config: Configuration, readonly evidence: string,
    readonly record: (kind: string, value: unknown) => void, dependencies: { compute?: Compute; analysisHooks?: AnalysisHooks;
      beforeObserve?: (completedEvents: number, event: RealEvent) => void; restoredExperience?: RestoredExperience | null } = {}) {
    this.compute = dependencies.compute ?? new Compute();
    this.#beforeObserve = dependencies.beforeObserve;
    if (dependencies.restoredExperience) {
      assertNewExperienceOutput(dependencies.restoredExperience.pointerPath, evidence);
      const { snapshot } = dependencies.restoredExperience;
      this.#events = snapshot.seenEventIds.length; this.#writes = snapshot.writes;
      this.#buffered = snapshot.pendingInitialization.length;
      this.#map = snapshot.eventMap ? sha(snapshot.eventMap) : null; this.#lastSnapshot = snapshot;
    }
    this.attention = new AttentionMonitor(this.compute, record, notice => {
      // Preserve the real producer's complete evidence and subject/time; do not fabricate a forecast here.
      this.analysis?.wake({ ...notice, subjectId: this.aliases.alias(notice.subjectId), publicSubjectId: notice.subjectId });
    }, event => { this.#pendingPassive.push(event); this.record('passive-event-queued', event); }, body.session?.id);
    this.analysis = new AnalysisCore(config.analysis, this, record, dependencies.analysisHooks);
    body.on('frame', frame => this.attention.accept(frame));
    body.on('fault', error => this.analysis.fail(error));
  }
  get actions(): number { return this.#actions; }
  get writes(): number { return this.#writes; }
  get eventCount(): number { return this.#events; }
  get newEventCount(): number { return this.#newEvents; }
  get snapshotForDisplay(): MemorySnapshot | null { return this.#lastSnapshot; }
  context(): unknown { return { publicObservation: this.aliases.present(this.body.latest()), physicalEvents: this.#events,
    sessionPhysicalEvents: this.#newEvents, depositedEvents: this.#writes, initializationBuffered: this.#buffered, remainingActions: this.config.actionBudget - this.#actions,
    focus: this.attention.controller.snapshot().focusTargetId ? this.aliases.alias(this.attention.controller.snapshot().focusTargetId!) : null }; }
  display(): unknown { return { ...this.context() as object, lastPrediction: this.#lastPrediction, lastRecall: this.#lastRecall,
    analysisCalls: this.analysis.calls, physicalMap: this.#map, attention: this.attention.controller.snapshot(),
    workspace: this.analysis.workspace.active ? this.analysis.workspace.snapshot() : null, recentRealEvents: this.#recent }; }
  async observe(): Promise<unknown> {
    this.body.check(); this.attention.check();
    return { publicObservation: this.aliases.present(this.body.latest()) };
  }
  async recall(desired: DesiredChange, offset: number): Promise<unknown> {
    this.body.check(); this.attention.check();
    const observation = this.body.latest();
    await this.#settleThrough(observation);
    await this.compute.call('advance', observation.activeSeconds);
    const recalled = await this.compute.call<Record<string, unknown>>('recall', desired, observation, offset);
    this.#lastRecall = { ...recalled, observationSequence: observation.sequence, activeSeconds: observation.activeSeconds };
    return this.#lastRecall;
  }
  async predict(action: Action, assumptions: readonly string[]): Promise<unknown> {
    this.body.check(); this.attention.check(); const observation = this.body.latest();
    const bound = this.aliases.resolveAction(action, observation);
    await this.#settleThrough(observation);
    await this.compute.call('advance', observation.activeSeconds);
    const prediction = await this.compute.call<Prediction>('predict', cueFor(bound, observation), observation);
    // The read-only invariant is verified by tests; do not serialize the whole core on this hot path.
    this.record('action-prediction', { action, observationSequence: observation.sequence, activeSeconds: observation.activeSeconds, prediction });
    this.#lastPrediction = { ...compactPrediction(prediction) as object,
      observationSequence: observation.sequence, activeSeconds: observation.activeSeconds };
    return { ...this.#lastPrediction as object,
      assumptions: { status: '未模拟的假设', values: assumptions, usedByPhysicalPrediction: false } };
  }
  async execute(actions: readonly Action[]): Promise<unknown> {
    const results: unknown[] = [];
    // This is the last body receipt's clock, not the (possibly newer) trailing public read.
    let observationSequence: number | null = null, activeSeconds: number | null = null;
    const material = () => ({ results, observationSequence, activeSeconds });
    await this.#settleThrough(this.body.latest());
    for (const action of actions) {
      if (this.#actions >= this.config.actionBudget) return { ...material(), stop: 'budget-exhausted', notAnImpossibilityClaim: true };
      this.body.check(); this.attention.check();
      const bound = this.aliases.resolveAction(action, this.body.latest());
      this.attention.bindActionTarget(bound.targetId ?? 'self');
      const beforeNotices = this.attention.notices.length;
      const execution = await this.body.execute(bound);
      observationSequence = execution.result.endSequence; activeSeconds = null;
      if (execution.result.executed) this.#actions++;
      if (execution.event) {
        // Close the producer before this event advances memory; sorting delivered events alone is insufficient.
        this.attention.sealThrough(execution.event.frames.at(-1)!);
        // Events delivered during an await may still precede this action. Commit them first.
        // A crossing passive window keeps its real prefix and tail; the active event owns the overlap.
        await this.#flushPassive(execution.event.frames[0]!, true);
        const written = await this.#commitEvent(execution.event);
        const first = execution.event.frames[0]!, last = execution.event.frames.at(-1)!;
        activeSeconds = last.activeSeconds;
        const changes = eventRows(execution.event).changes.flat().map(change => ({ ...change,
          observationSequence: execution.event!.frames[change.observationIndex]!.sequence,
          activeSeconds: execution.event!.frames[change.observationIndex]!.activeSeconds }));
        const summary = { eventId: execution.event.id, action, executed: execution.result.executed, status: execution.result.status,
          startSequence: execution.result.startSequence, endSequence: execution.result.endSequence,
          startActiveSeconds: first.activeSeconds, endActiveSeconds: last.activeSeconds, observationWindow:
          [execution.result.startSequence, execution.result.endSequence],
          // Store the ordered public process once. Workspace previews/pages limit prompt size, not evidence.
          publicChanges: changes,
          learning: written };
        this.#recent.push(summary); this.#recent = this.#recent.slice(-8); results.push(summary);
      } else results.push({ ...execution.result, action });
      this.body.check(); this.attention.check();
      if (this.attention.notices.length > beforeNotices) return { ...material(), interrupted: true,
        remainingActionsNotExecuted: actions.length - results.length, reason: this.attention.notices.at(-1)?.kind,
        publicObservation: this.aliases.present(this.body.latest()) };
    }
    return { ...material(), interrupted: false, publicObservation: this.aliases.present(this.body.latest()) };
  }
  #passiveSlice(event: RealEvent, start: number, end: number): RealEvent {
    if (start === 0 && end === event.frames.length - 1) return event;
    const frames = event.frames.slice(start, end + 1);
    const segment = { ...event, id: `${event.id}:frames:${frames[0]!.sequence}-${frames.at(-1)!.sequence}`, frames };
    this.record('passive-event-segment', { sourceEventId: event.id, sourceSha256: sha(event), segmentId: segment.id,
      retainedOriginalSequences: frames.map(frame => frame.sequence) });
    return segment;
  }
  #uncoveredPassive(event: RealEvent): RealEvent[] {
    const segments: RealEvent[] = []; let start: number | null = null;
    for (let i = 1; i < event.frames.length; i++) {
      const sequence = event.frames[i]!.sequence;
      const covered = this.#learnedChanges.some(range => range.start < sequence && sequence <= range.end);
      if (!covered && start === null) start = i - 1;
      if (covered && start !== null) { segments.push(this.#passiveSlice(event, start, i - 1)); start = null; }
    }
    if (start !== null) segments.push(this.#passiveSlice(event, start, event.frames.length - 1));
    if (segments.length === 0) this.record('passive-event-already-owned', { eventId: event.id,
      observationWindow: [event.frames[0]!.sequence, event.frames.at(-1)!.sequence] });
    return segments;
  }
  async #settleThrough(observation: Observation): Promise<void> {
    this.attention.sealThrough(observation);
    await this.#flushPassive(observation, true);
  }
  async #flushPassive(observation: Observation, splitAtCutoff = false): Promise<void> {
    const pending = this.#pendingPassive; this.#pendingPassive = [];
    const eligible: RealEvent[] = [];
    for (const event of pending) {
      validateEvent(event);
      if (event.frames.at(-1)!.sequence <= observation.sequence && event.frames.at(-1)!.activeSeconds <= observation.activeSeconds) eligible.push(event);
      else {
        const boundary = splitAtCutoff ? event.frames.findIndex(frame => frame.sequence === observation.sequence) : -1;
        if (boundary > 0) {
          assert(event.frames[boundary]!.activeSeconds === observation.activeSeconds, 'passive-active-boundary-time-mismatch');
          eligible.push(this.#passiveSlice(event, 0, boundary));
          this.#pendingPassive.push(this.#passiveSlice(event, boundary, event.frames.length - 1));
        } else this.#pendingPassive.push(event);
      }
    }
    eligible.sort((a, b) => a.frames.at(-1)!.activeSeconds - b.frames.at(-1)!.activeSeconds);
    // New arrivals go to the live queue, not this captured query/action cutoff.
    for (const event of eligible) for (const segment of this.#uncoveredPassive(event)) {
      const changes = eventRows(segment).changes.flat();
      if (!changes.some(change => change.before !== change.after)) {
        this.record('passive-event-no-change', { eventId: segment.id,
          observationWindow: [segment.frames[0]!.sequence, segment.frames.at(-1)!.sequence] });
        continue;
      }
      const written = await this.#commitEvent(segment);
      this.#recent.push({ eventId: segment.id, provenance: 'real-passive', changes: changes.slice(-12), learning: written });
      this.#recent = this.#recent.slice(-8);
    }
  }
  async #commitEvent(event: RealEvent): Promise<{ writes: number; buffered: number; mapSha256: string | null }> {
    const start = event.frames[0]!.sequence, end = event.frames.at(-1)!.sequence;
    assert(!this.#learnedChanges.some(range => range.start < end && start < range.end), 'real-event-change-already-owned');
    this.#beforeObserve?.(this.#newEvents, event);
    this.record(event.provenance === 'observed-passive' ? 'real-passive-event' : 'real-event', event);
    const written = await this.compute.call<{ writes: number; buffered: number; mapSha256: string | null }>('observe', event);
    this.#learnedChanges.push({ start, end });
    this.#events++; this.#newEvents++; this.#writes = written.writes; this.#buffered = written.buffered; this.#map = written.mapSha256;
    this.record('real-event-committed', { eventId: event.id, provenance: event.provenance, observationWindow: [start, end],
      actualEndTime: event.frames.at(-1)!.activeSeconds, eventCount: this.#events, sessionEventCount: this.#newEvents, learning: written });
    if (this.#newEvents % 32 === 0) await this.save();
    return written;
  }
  async save(): Promise<void> {
    const snapshot = await this.compute.call<MemorySnapshot>('snapshot');
    this.#lastSnapshot = snapshot;
    await saveJson(resolve(this.evidence, `experience-${this.#events.toString().padStart(4, '0')}.json`), snapshot);
    await saveJson(resolve(this.evidence, 'EXPERIENCE_LATEST.json'), { filename: `experience-${this.#events.toString().padStart(4, '0')}.json`,
      sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, sha256: sha(snapshot), actions: this.#actions, eventCount: this.#events, writes: this.#writes });
    await this.saveWorkspace();
  }
  async saveWorkspace(): Promise<void> {
    if (this.analysis.workspace.active) await saveJson(resolve(this.evidence, 'WORKSPACE_LATEST.json'), {
      workspace: this.analysis.workspace.snapshot(), aliases: this.aliases.snapshot(), crashActionResume: false });
  }
  async runGoal(goal: string): Promise<{ status: string; report: string }> {
    this.aliases.reset();
    const result = await this.analysis.run(goal); this.record('model-finish', result);
    const finalObservation = this.body.latest();
    await this.#settleThrough(finalObservation); await this.save(); return result;
  }
  async close(): Promise<void> { this.analysis.agent.abort(); await this.body.close(); await this.compute.close(); }
}
