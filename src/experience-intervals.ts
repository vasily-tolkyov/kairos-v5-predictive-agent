import type { ActionCue, Observation, RealEvent, RealFrameClockV1 } from './contracts.js';
import { validateEvent } from './events.js';
import { assert, sha } from './util.js';

export interface ExperienceIntervalBoundary {
  readonly sequence: number;
  readonly frameDigest: string;
  readonly physicalClock: RealFrameClockV1 | null;
}
interface IntervalSource {
  /** Every row belongs to this SAME original window and calibration group. */
  readonly parentWindowId: string;
  readonly parentEventDigest: string;
  /** Indices into the caller's original event.frames; no copied sensation. */
  readonly beforeFrameIndex: number;
  readonly afterFrameIndex: number;
}
export type IntervalMotor =
  | { readonly state: 'held'; readonly basis: 'measured-motor-receipt'; readonly signal: {
      readonly kind: ActionCue['kind']; readonly parameters: ActionCue['parameters'] } }
  | { readonly state: 'off'; readonly basis: 'measured-motor-receipt' | 'observed-passive' };
export type SourceExperienceInterval = IntervalSource & (
  | { readonly kind: 'dynamics'; readonly deltaTicks: number; readonly deltaSeconds: number;
      readonly motor: IntervalMotor }
  | { readonly kind: 'assimilation-only'; readonly deltaTicks: 0; readonly deltaSeconds: 0 }
  | { readonly kind: 'untrainable'; readonly deltaTicks: number | null; readonly deltaSeconds: number | null;
      readonly reason: 'missing-physical-clock' | 'partial-physical-clock' | 'unknown-motor-edges' | 'motor-edge-inside-interval' });
export interface SourceExperienceIntervals {
  readonly version: 'SourceExperienceIntervals1';
  readonly parentWindowId: string;
  readonly parentEventDigest: string;
  readonly sourceFrameCount: number;
  readonly clockStatus: 'verified' | 'missing' | 'partial';
  readonly transitions: readonly SourceExperienceInterval[];
  readonly boundary: ExperienceIntervalBoundary;
  /** Extraction never observes another event or performs a learning update. */
  readonly learningWrites: 0;
  readonly newIndependentCalibrationWindows: 0;
}

function clockOf(frame: Observation): RealFrameClockV1 | null {
  const clock = frame.physicalClock;
  if (clock === undefined) return null;
  assert(clock.version === 'RealFrameClockV1'
    && Number.isSafeInteger(clock.physicsTick) && clock.physicsTick >= 0
    && clock.secondsPerTick === .05
    && Number.isFinite(clock.monotonicMs) && clock.monotonicMs >= 0
    && (clock.sample === 'physics' || clock.sample === 'terminal'), 'invalid-experience-physical-clock');
  return clock;
}

/** Split one original real window into adjacent measured intervals. This is a
 * source-preserving view, not an event generator or a new learning owner.
 * The caller must batch any later fitting/calibration by parentWindowId.
 * Missing legacy clocks never acquire duration from sequence or activeSeconds.
 * Pass a preceding boundary only when asserting continuous shared-frame input;
 * an explicit reset starts a new chain by omitting that boundary. */
export function extractExperienceIntervals(event: RealEvent,
  options: { readonly previousBoundary?: ExperienceIntervalBoundary } = {}): SourceExperienceIntervals {
  validateEvent(event);
  assert(typeof event.id === 'string' && event.id.length > 0, 'invalid-experience-parent-window-id');
  assert(event.frames.every(frame => frame.predictionSupport === undefined
    && frame.predictionContext === undefined && frame.predictionBounds === undefined), 'imagined-experience-interval');
  if (event.provenance === 'observed-passive') assert(event.bodyResult === null && event.cue.kind === 'passive',
    'motor-window-labelled-as-passive-interval');
  const first = event.frames[0]!, last = event.frames.at(-1)!;
  const clocks = event.frames.map(clockOf);
  for (const frame of event.frames) {
    const signal = frame.motorSignal;
    if (signal === undefined) continue;
    assert(signal.version === 'BodyMotorSignalV1' && signal.scope === 'instrumented-held-controls'
      && ['held', 'off', 'unknown'].includes(signal.state), 'invalid-experience-sampled-motor');
    assert(signal.state === 'held' ? signal.cue !== null && signal.cue.targetRole === null
      && typeof signal.cue.kind === 'string' && signal.cue.parameters !== null
      && typeof signal.cue.parameters === 'object'
      && Object.values(signal.cue.parameters).every(value => typeof value === 'number' ? Number.isFinite(value)
        : typeof value === 'string' || typeof value === 'boolean') : signal.cue === null,
    'invalid-experience-sampled-motor');
  }
  let previousKnown: RealFrameClockV1 | null = null;
  for (let index = 0; index < clocks.length; index++) {
    const clock = clocks[index];
    if (!clock) continue;
    if (previousKnown) assert(clock.physicsTick >= previousKnown.physicsTick
      && clock.monotonicMs >= previousKnown.monotonicMs, 'backward-experience-physical-clock');
    const adjacent = index > 0 ? clocks[index - 1] : null;
    if (adjacent) {
      const ticks = clock.physicsTick - adjacent.physicsTick;
      assert(clock.sample === 'terminal' ? ticks === 0 : ticks > 0, 'conflicting-experience-frame-clock');
    }
    previousKnown = clock;
  }
  const preceding = options.previousBoundary;
  if (preceding) {
    assert(Number.isSafeInteger(preceding.sequence) && preceding.sequence >= 0
      && /^[a-f0-9]{64}$/.test(preceding.frameDigest), 'invalid-experience-shared-boundary');
    assert(first.sequence === preceding.sequence, 'experience-shared-frame-gap-or-backward-sequence');
    assert(sha(first) === preceding.frameDigest, 'conflicting-experience-shared-frame');
    assert(sha(clocks[0] ?? null) === sha(preceding.physicalClock), 'conflicting-experience-shared-clock');
  }
  const present = clocks.filter(Boolean).length;
  const clockStatus = present === clocks.length ? 'verified' : present === 0 ? 'missing' : 'partial';
  const receipt = event.bodyResult?.motorReceipt;
  // Receipts certify their motor edges, not all intermediate frame timestamps.
  // Cross-check any provided frame clocks even if another frame is legacy.
  if (receipt) for (const edge of [receipt.requestedAt, receipt.pressedAt, receipt.releasedAt]) {
    const index = event.frames.findIndex(frame => frame.sequence === edge.observationSequence), clock = clocks[index];
    assert(index >= 0, 'experience-motor-edge-outside-window');
    if (clock) assert(clock.physicsTick === edge.physicsTick && clock.monotonicMs <= edge.monotonicMs,
      'experience-motor-edge-clock-conflict');
  }
  const parentEventDigest = sha(event), source = { parentWindowId: event.id, parentEventDigest };
  // A later interruption determines actualTicks only after earlier intervals.
  // Do not leak that final whole-window duration into an earlier motor input.
  // The original request/receipt remain in the parent source; this signal is
  // the active actuator plus non-duration parameters, with duration on the row.
  const heldSignal = receipt && receipt.actualTicks > 0 ? { kind: event.cue.kind,
    parameters: Object.fromEntries(Object.entries(event.cue.parameters)
      .filter(([name]) => name !== receipt.durationParameter)) } : null;
  const transitions: SourceExperienceInterval[] = [];
  for (let index = 1; index < event.frames.length; index++) {
    const row = { ...source, beforeFrameIndex: index - 1, afterFrameIndex: index };
    if (clockStatus !== 'verified') {
      transitions.push({ ...row, kind: 'untrainable', deltaTicks: null, deltaSeconds: null,
        reason: clockStatus === 'missing' ? 'missing-physical-clock' : 'partial-physical-clock' });
      continue;
    }
    const before = clocks[index - 1]!, after = clocks[index]!;
    const deltaTicks = after.physicsTick - before.physicsTick, deltaSeconds = deltaTicks * after.secondsPerTick;
    if (deltaTicks === 0) {
      transitions.push({ ...row, kind: 'assimilation-only', deltaTicks: 0, deltaSeconds: 0 }); continue;
    }
    let motor: IntervalMotor | null = null;
    if (event.provenance === 'observed-passive') motor = { state: 'off', basis: 'observed-passive' };
    else if (receipt) {
      // The interval is (beforeTick, afterTick]. A release callback runs after
      // the frame at releasedAt.physicsTick, so that LAST interval is held.
      const pressed = receipt.pressedAt.physicsTick, released = receipt.releasedAt.physicsTick;
      if (after.physicsTick <= pressed || before.physicsTick >= released)
        motor = { state: 'off', basis: 'measured-motor-receipt' };
      else if (before.physicsTick >= pressed && after.physicsTick <= released && heldSignal)
        motor = { state: 'held', basis: 'measured-motor-receipt', signal: heldSignal };
    }
    // Capture precedes the release callback. A measured known signal at the
    // AFTER frame must therefore agree with this interval, including its last
    // held tick. Unknown signals do not overrule a complete measured receipt.
    const sampled = event.frames[index]!.motorSignal;
    if (motor && sampled && sampled.state !== 'unknown') {
      assert(sampled.state === motor.state, 'experience-sampled-motor-conflict');
      if (sampled.state === 'held' && motor.state === 'held') assert(sha({ kind: sampled.cue.kind,
        parameters: Object.fromEntries(Object.entries(sampled.cue.parameters)
          .filter(([name]) => name !== receipt?.durationParameter)) }) === sha(motor.signal),
      'experience-sampled-motor-conflict');
    }
    transitions.push(motor ? { ...row, kind: 'dynamics', deltaTicks, deltaSeconds, motor }
      : { ...row, kind: 'untrainable', deltaTicks, deltaSeconds,
        reason: receipt ? 'motor-edge-inside-interval' : 'unknown-motor-edges' });
  }
  return { version: 'SourceExperienceIntervals1', ...source, sourceFrameCount: event.frames.length,
    clockStatus, transitions, boundary: { sequence: last.sequence, frameDigest: sha(last),
      physicalClock: clocks.at(-1) ? { ...clocks.at(-1)! } : null },
    learningWrites: 0, newIndependentCalibrationWindows: 0 };
}
