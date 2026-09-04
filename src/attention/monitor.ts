import type { Observation, Prediction, PublicChange, RealEvent } from '../contracts.js';
import type { Compute } from '../compute.js';
import { eventRows, realEventHierarchyContinuityV1 } from '../events.js';
import { assert } from '../util.js';
import { AttentionController } from './attention-controller.js';
import type { AttentionCandidate } from './types.js';
import { randomUUID } from 'node:crypto';

export interface AttentionNotice { readonly kind: 'prediction-violation' | 'unknown-change'; readonly subjectId: string;
  readonly sequence: number; readonly forecastCompletedBeforeSequence: number | null; readonly evidence: unknown; }
interface Forecast { readonly prediction: Prediction; readonly subjectId: string; readonly completedSequence: number; readonly originSequence: number; }
function consistentChange(expected: PublicChange, actual: PublicChange): boolean {
  if (expected.subject !== actual.subject || expected.property !== actual.property) return false;
  if (typeof expected.before === 'number' && typeof expected.after === 'number' && typeof actual.before === 'number' && typeof actual.after === 'number')
    return Math.sign(expected.after - expected.before) === Math.sign(actual.after - actual.before);
  return expected.after === actual.after;
}
export function comparePublicPrediction(prediction: Prediction | null, actual: readonly PublicChange[]): 'within-envelope' | 'prediction-violation' | 'unknown-change' {
  if (!prediction || prediction.support < .5 || prediction.samples.length < 8) return 'unknown-change';
  const expected = prediction.samples.flatMap(sample => sample.readout.flatMap(read => read.changes));
  if (expected.length === 0) return 'unknown-change';
  const supported = expected.filter(change => prediction.samples.filter(sample => sample.readout.some(read => read.changes.some(c => consistentChange(change, c)))).length / prediction.samples.length >= .6);
  if (supported.length === 0) return 'unknown-change';
  const changedExpected = supported.filter(change => change.before !== change.after);
  if (changedExpected.length > 0 && !changedExpected.some(e => actual.some(a => consistentChange(e, a)))) return 'prediction-violation';
  if (actual.some(a => !supported.some(e => consistentChange(e, a)))) return 'prediction-violation';
  return 'within-envelope';
}
export class AttentionMonitor {
  readonly controller = new AttentionController({ next: () => .5 });
  #window: Observation[] = [];
  #forecast: Forecast | null = null;
  #busy = false;
  #lastSequence = 0;
  #fault: Error | null = null;
  readonly notices: AttentionNotice[] = [];
  #pendingNoveltySubjects = new Set<string>();
  constructor(readonly compute: Compute, readonly record: (kind: string, value: unknown) => void,
    readonly wake: (notice: AttentionNotice) => void, readonly capture: (event: RealEvent) => void = () => {},
    readonly sessionId: string = randomUUID()) {}
  check(): void { if (this.#fault) throw this.#fault; }
  bindActionTarget(subject: string): void { this.controller.bindActionTarget(subject); }
  /**
   * Surface a first-seen afferent allocation to the next real attention
   * window.  The allocation itself is committed by physical memory; this
   * method only carries its transient salience and never writes memory.
   */
  noteNovelty(subjectIds: readonly string[]): void {
    for (const subjectId of subjectIds) this.#pendingNoveltySubjects.add(subjectId);
  }
  accept(frame: Observation): void {
    this.#lastSequence = frame.sequence; this.#window.push(frame);
    if (this.#window.length < 21) return;
    const frames = this.#window; this.#window = [frame];
    this.#processWindow(frames);
  }
  /** Close only already received real observations through the caller's fixed cutoff. */
  sealThrough(observation: Observation): void {
    this.check();
    if (this.#window.length < 2 || observation.sequence <= this.#window[0]!.sequence) return;
    const end = this.#window.findIndex(frame => frame.sequence === observation.sequence);
    assert(end >= 0, 'attention-cutoff-not-received');
    assert(this.#window[end]!.activeSeconds === observation.activeSeconds, 'attention-cutoff-time-mismatch');
    const frames = this.#window.slice(0, end + 1);
    this.#window = this.#window.slice(end); // Keep the real baseline and every newer frame.
    this.#processWindow(frames);
    this.check();
  }
  #processWindow(frames: readonly Observation[]): void {
    const frame = frames.at(-1)!;
    try {
      const trackedIds = ['self', ...new Set(frames.flatMap(f => f.objects.map(o => o.id)))];
      const eventWithoutContinuity: RealEvent = { version: 'RealEventV5', id: `${this.sessionId}:monitor-${frame.sequence}`, cue: { kind: 'passive', parameters: {}, targetRole: null },
        frames, trackedIds, bodyResult: null, provenance: 'observed-passive', complete: true };
      const event: RealEvent = { ...eventWithoutContinuity,
        hierarchyContinuity: realEventHierarchyContinuityV1(eventWithoutContinuity, this.sessionId) };
      const series = eventRows(event), changes = series.changes.flat().filter(c => c.before !== c.after);
      const beforeAttention = this.controller.snapshot();
      const noticesBefore = this.notices.length;
      const classified = new Map<string, { readonly classification: ReturnType<typeof comparePublicPrediction>;
        readonly changes: readonly PublicChange[]; readonly forecast: Forecast | null }>();
      const candidates: AttentionCandidate[] = trackedIds.map(subjectId => {
        const role = series.roles[subjectId]; const subjectChanges = changes.filter(change => change.subject === role);
        // The baseline frame was already public; only its following changes are compared.
        const forecast = this.#forecast?.subjectId === subjectId && this.#forecast.completedSequence <= frames[0]!.sequence ? this.#forecast : null;
        const classification = comparePublicPrediction(forecast?.prediction ?? null, subjectChanges);
        classified.set(subjectId, { classification, changes: subjectChanges, forecast });
        const magnitude = Math.min(2, subjectChanges.reduce((sum, c) => sum + (typeof c.before === 'number' && typeof c.after === 'number'
          ? Math.abs(c.after - c.before) : 1), 0));
        if (classification === 'prediction-violation') this.#notice({ kind: classification, subjectId, sequence: frame.sequence,
          forecastCompletedBeforeSequence: forecast!.completedSequence, evidence: { changes: subjectChanges, prediction: forecast!.prediction } });
        const novelty = this.#pendingNoveltySubjects.has(subjectId) ? 1 : 0;
        return { targetId: subjectId, safe: true, changeMagnitude: magnitude, changeDerivative: 0,
          predictionDeviation: classification === 'prediction-violation' ? 2 : classification === 'within-envelope' ? 0 : null,
          goalRelevance: 0, novelty, actionTargetBinding: this.controller.snapshot().boundActionTargetId === subjectId ? 1 : 0 };
      });
      // A novelty pulse is transient just like the attention-window inputs.
      // If no matching subject was present, leave it pending for the next
      // complete public window instead of silently dropping the signal.
      const representedNovelty = trackedIds.some(subjectId => this.#pendingNoveltySubjects.has(subjectId));
      if (representedNovelty) {
        for (const subjectId of trackedIds) this.#pendingNoveltySubjects.delete(subjectId);
      }
      const snapshot = this.controller.update(frame.sequence, candidates);
      const unknownNoticed = new Set<string>();
      const noticeUnknown = (subjectId: string | null): void => {
        if (!subjectId || unknownNoticed.has(subjectId)) return;
        const value = classified.get(subjectId);
        if (!value || value.classification !== 'unknown-change' || value.changes.length === 0) return;
        unknownNoticed.add(subjectId);
        this.#notice({ kind: 'unknown-change', subjectId, sequence: frame.sequence,
          forecastCompletedBeforeSequence: value.forecast?.completedSequence ?? null,
          evidence: value.changes });
      };
      // Selecting a focus and waking analysis about a change are distinct.  A
      // real unknown change on the object already in focus must still wake the
      // control loop even though no focus preemption occurred.
      noticeUnknown(beforeAttention.focusTargetId);
      const newlyFocused = snapshot.focusTargetId !== beforeAttention.focusTargetId
        && (beforeAttention.focusTargetId === null
          || snapshot.preemptionCount > beforeAttention.preemptionCount);
      if (newlyFocused) noticeUnknown(snapshot.focusTargetId);
      this.record('attention', { sequence: frame.sequence, snapshot, changes });
      // Never pair a late result with changes that had already begun, or reuse it for later windows.
      if (this.#forecast) {
        this.record('forecast-timing', { originSequence: this.#forecast.originSequence,
          completedSequence: this.#forecast.completedSequence, firstComparedSequence: frames[0]!.sequence + 1,
          windowEndSequence: frame.sequence, late: this.#forecast.completedSequence > frames[0]!.sequence });
        this.#forecast = null;
      }
      if (this.notices.length > noticesBefore && changes.length > 0) {
        const attended = [...new Set(this.notices.slice(noticesBefore).map(notice => notice.subjectId))];
        this.capture({ ...event, trackedIds: [...new Set(['self', ...attended])] });
      }
      // At most one current-focus prediction. Raw-frame acquisition never awaits it.
      if (!this.#busy && snapshot.focusTargetId) {
        const focus = snapshot.focusTargetId;
        const prefix = { ...event, trackedIds: [focus] };
        this.#busy = true;
        void this.compute.call<Prediction>('predict', prefix.cue, frame, { prefix }).then(prediction => {
          const complete = this.#lastSequence;
          this.#forecast = { prediction, subjectId: focus, completedSequence: complete, originSequence: frame.sequence };
          this.record('focus-forecast', { originSequence: frame.sequence, completedSequence: complete, subjectId: focus, prediction });
        }).catch(error => { this.#fault = error; }).finally(() => { this.#busy = false; });
      }
    } catch (error) { this.#fault = error as Error; }
  }
  #notice(notice: AttentionNotice): void {
    if (this.notices.some(value => value.kind === notice.kind && value.subjectId === notice.subjectId
      && value.sequence === notice.sequence)) return;
    this.notices.push(notice); this.record('attention-wake', notice); this.wake(notice);
  }
}
