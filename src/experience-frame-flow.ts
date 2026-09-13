import { randomUUID } from 'node:crypto';
import type { BodyMotorSignalV1, MotorEdgeV1, Observation, PhysicalTelemetryBatchV1, RealEvent } from './contracts.js';
import { extractExperienceIntervals } from './experience-intervals.js';
import { ExperienceLiveState, sealRealObservation, actualObservationDigest,
  type ExperienceLiveSnapshotV1, type LiveMotorSignalV1, type LiveStateV1 } from './experience-live-state.js';
import { assert, sha } from './util.js';

const UNKNOWN: LiveMotorSignalV1 = { state: 'unknown', provenance: 'unknown', cue: null };
const signal = (value?: BodyMotorSignalV1): LiveMotorSignalV1 => {
  if (value === undefined) return UNKNOWN;
  assert(value && value.version === 'BodyMotorSignalV1' && value.scope === 'instrumented-held-controls'
    && ['unknown', 'off', 'held'].includes(value.state), 'invalid-live-source-motor');
  if (value.state !== 'held') {
    assert(value.cue === null, 'invalid-live-source-motor');
    return value.state === 'unknown' ? UNKNOWN : { state: 'off', provenance: 'body-transition', cue: null };
  }
  assert(value.cue && value.cue.targetRole === null, 'invalid-live-source-motor');
  return { state: 'held', provenance: 'body-transition', cue: { ...value.cue, targetRole: null,
    parameters: Object.fromEntries(Object.entries(value.cue.parameters).filter(([key]) => !['ticks', 'holdTicks'].includes(key))) } };
};
const equalMotor = (a: LiveMotorSignalV1, b: LiveMotorSignalV1) => sha({ state: a.state, cue: a.cue }) === sha({ state: b.state, cue: b.cue });

/** One real-frame owner. Window packaging and frozen theta do not stop z.
 * Raw frames are referenced only during delivery; the bounded live ring keeps
 * frozen feature states, never a second copy of RGBD or invented old states. */
export class ExperienceFrameFlow {
  #live: ExperienceLiveState;
  #epoch = randomUUID();
  #last: Observation | null = null;
  #afterSample: LiveMotorSignalV1 = UNKNOWN;
  #telemetryGaps = 0; #missingTraceWindows = 0; #missingBoundaries = 0; #deliveredOrder = 0;
  #lastEdgeSequence = 0;
  constructor(live = new ExperienceLiveState({ frameCapacity: 512, maximumSnapshotBytes: 16_777_216 })) { this.#live = live; }
  get live(): ExperienceLiveState { return this.#live; }
  get stats() { const state = this.#live.current(); return { version: 'ExperienceFrameFlow1' as const,
    acceptedFrames: state.revision, lastSequence: state.frame?.sequence ?? null,
    telemetryGaps: this.#telemetryGaps, missingTraceWindows: this.#missingTraceWindows,
    unavailableTelemetryBoundaries: this.#missingBoundaries,
    liveStatePayloadBytes: this.#live.snapshotPayloadBytes,
    liveStatePayloadLimitBytes: this.#live.options.maximumSnapshotBytes,
    retainedFrameStates: Math.min(state.revision, this.#live.options.frameCapacity),
    deliveredThroughOrder: this.#deliveredOrder, continuity: state.continuity }; }
  stateAt(observation: Observation): LiveStateV1 | undefined {
    return this.#live.stateAt({ epoch: this.#epoch, sequence: observation.sequence, sensorySha256: sealRealObservation(observation) }) ?? undefined;
  }
  #ingest(frames: readonly Observation[], batch: PhysicalTelemetryBatchV1 | undefined,
    onFrame: (frame: Observation) => void): void {
    const pending = new Map<number, Observation>();
    const add = (frame: Observation) => {
      const previous = pending.get(frame.sequence);
      assert(!previous || actualObservationDigest(previous) === actualObservationDigest(frame), 'live-delivery-shared-frame-conflict'); pending.set(frame.sequence, frame);
    };
    const edges: MotorEdgeV1[] = [];
    if (batch) {
      assert(batch.version === 'PhysicalTelemetryBatchV1' && batch.deliveredThroughOrder >= this.#deliveredOrder
        && batch.receivedThroughOrder >= batch.deliveredThroughOrder,
        'live-telemetry-delivery-went-backward');
      let order = this.#deliveredOrder;
      for (const record of batch.records) {
        assert(Number.isSafeInteger(record.order) && record.order > order && record.order <= batch.deliveredThroughOrder
          && Number.isFinite(record.receivedMonotonicMs) && record.receivedMonotonicMs >= 0, 'invalid-live-record-order');
        order = record.order;
        if (record.kind === 'motor-edge') {
          const edge = record.edge;
          assert(edge.version === 'MotorEdgeV1' && Number.isSafeInteger(edge.edgeSequence) && edge.edgeSequence > this.#lastEdgeSequence
            && ['press', 'release', 'unmeasured'].includes(edge.kind)
            && [true, false, null].includes(edge.succeeded)
            && Number.isSafeInteger(edge.clock.observationSequence) && edge.clock.observationSequence >= 0
            && Number.isSafeInteger(edge.clock.physicsTick) && edge.clock.physicsTick >= 0
            && Number.isFinite(edge.clock.activeSeconds) && edge.clock.activeSeconds >= 0
            && Number.isFinite(edge.clock.monotonicMs) && edge.clock.monotonicMs >= 0, 'invalid-live-motor-edge');
          signal(edge.signal); this.#lastEdgeSequence = edge.edgeSequence;
          assert(edge.succeeded !== true || edge.kind === 'press' && edge.signal.state === 'held'
            || edge.kind === 'release' && edge.signal.state === 'off', 'live-motor-edge-kind-conflict');
        }
      }
      this.#deliveredOrder = batch.deliveredThroughOrder;
      if (batch.gap) { this.#telemetryGaps++; this.#afterSample = UNKNOWN; }
      if (batch.boundaryMissing) this.#missingBoundaries++;
      for (const record of batch.records) if (record.kind === 'frame') add(record.observation); else edges.push(record.edge);
    }
    for (const frame of frames) add(frame);
    edges.sort((a, b) => a.edgeSequence - b.edgeSequence);
    for (const frame of [...pending.values()].sort((a, b) => a.sequence - b.sequence)) {
      if (this.#last && frame.sequence <= this.#last.sequence) {
        // Old ring entries may be retired. Missing means unavailable, never
        // permission to replay an old frame through the current activation.
        this.stateAt(frame); continue;
      }
      let interval = this.#afterSample;
      const beforeClock = this.#last?.physicalClock;
      for (const edge of edges.filter(edge => edge.clock.observationSequence < frame.sequence
        && (!this.#last || edge.clock.observationSequence >= this.#last.sequence))) {
        const boundary = beforeClock && this.#last && edge.clock.observationSequence === this.#last.sequence;
        if (boundary && frame.physicalClock) assert(edge.clock.physicsTick === beforeClock.physicsTick
          && edge.clock.activeSeconds === this.#last!.activeSeconds && edge.clock.monotonicMs >= beforeClock.monotonicMs
          && edge.clock.monotonicMs <= frame.physicalClock.monotonicMs, 'live-motor-edge-outside-measured-interval');
        interval = boundary && edge.succeeded === true ? signal(edge.signal) : UNKNOWN;
      }
      const sampled = signal(frame.motorSignal);
      const clock = frame.physicalClock;
      if (clock !== undefined) {
        assert(clock && clock.version === 'RealFrameClockV1' && clock.secondsPerTick === .05
          && Number.isSafeInteger(clock.physicsTick) && clock.physicsTick >= 0
          && Number.isFinite(clock.monotonicMs) && clock.monotonicMs >= 0
          && ['physics', 'terminal'].includes(clock.sample), 'invalid-live-source-clock');
        if (beforeClock && this.#last) {
          const ticks = clock.physicsTick - beforeClock.physicsTick, samples = frame.sequence - this.#last.sequence;
          assert(clock.monotonicMs >= beforeClock.monotonicMs && ticks >= 0 && ticks <= samples
            && (samples !== 1 || ticks === Number(clock.sample === 'physics')), 'invalid-live-source-clock-order');
        }
      }
      if (!beforeClock || !clock || !this.#last || frame.sequence !== this.#last.sequence + 1
        || clock.physicsTick - beforeClock.physicsTick !== 1 || !equalMotor(interval, sampled)) interval = UNKNOWN;
      // Later whole-window receipts supply interval learning labels only.
      // They never backfill a live state that had no corresponding edge yet.
      this.#live.accept({ provenance: 'observed-real', epoch: this.#epoch, observation: frame,
        physicalClock: clock ? { provenance: 'body-physics', physicsTick: clock.physicsTick,
          secondsPerTick: clock.secondsPerTick } : null, motor: sampled, intervalMotor: interval });
      this.#last = frame; this.#afterSample = sampled; onFrame(frame);
    }
  }
  boundary(observation: Observation, batch?: PhysicalTelemetryBatchV1, onFrame: (frame: Observation) => void = () => {}): LiveStateV1 {
    this.#ingest([observation], batch, onFrame);
    const state = this.stateAt(observation); assert(state, 'live-prediction-boundary-state-unavailable'); return state;
  }
  window(event: RealEvent, batch?: PhysicalTelemetryBatchV1, onFrame: (frame: Observation) => void = () => {}) {
    const intervals = extractExperienceIntervals(event);
    this.#ingest(event.frames, batch, onFrame);
    const states = event.frames.map(frame => this.stateAt(frame));
    if (states.some(state => !state)) { this.#missingTraceWindows++; return undefined; }
    return { version: 'ExperienceWindowLiveTraceV1' as const, parentWindowId: event.id,
      parentEventDigest: intervals.parentEventDigest, states: states as LiveStateV1[] };
  }
  snapshot(): ExperienceLiveSnapshotV1 { return this.#live.snapshot(); }
  static restore(snapshot: ExperienceLiveSnapshotV1, sameWorld: boolean): ExperienceFrameFlow {
    return new ExperienceFrameFlow(ExperienceLiveState.restore(snapshot, sameWorld ? 'same-world-restart' : 'transfer'));
  }
}
