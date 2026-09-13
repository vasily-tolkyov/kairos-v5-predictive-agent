import type { ActionCue, Observation, PublicValue, XYZ } from './contracts.js';
import { worldToBody } from './perception.js';
import { canonical, sha } from './util.js';
import { freezeEvidenceData } from './immutable-evidence.js';

/** An encoding basis, not learned physics or a native capability claim. No
 * theta, learner, calibration counter, goal or action selector lives here. */
export const EXPERIENCE_LIVE_LAW = 'continuous-receptors-v1:32x16:tau=.05,.5,5:hash2' as const;
export const LIVE_RECEPTORS = 32, LIVE_ACTIVATIONS = 16;
const TAU = Array.from({ length: LIVE_ACTIVATIONS }, (_, i) => [.05, .5, 5][i % 3]!);
type Channels = Readonly<Record<string, PublicValue>>;
export interface LiveFrameKeyV1 { readonly epoch: string; readonly sequence: number; readonly sensorySha256: string }
export interface LivePhysicalClockV1 {
  readonly provenance: 'body-physics'; readonly physicsTick: number; readonly secondsPerTick: number;
}
export type LiveMotorSignalV1 =
  | { readonly state: 'unknown'; readonly provenance: 'unknown'; readonly cue: null }
  | { readonly state: 'off'; readonly provenance: 'body-transition' | 'verified-passive'; readonly cue: null }
  | { readonly state: 'held' | 'impulse'; readonly provenance: 'body-transition'; readonly cue: ActionCue };
export type LiveElapsedV1 = { readonly kind: 'measured'; readonly seconds: number }
  | { readonly kind: 'unknown'; readonly reason: 'initial' | 'missing-clock' | 'clock-change' | 'gap' | 'restart' | 'branch-unknown' };
export interface LiveRealFrameV1 {
  readonly provenance: 'observed-real'; readonly epoch: string; readonly observation: Observation;
  /** Null in legacy frames. activeSeconds and requested ticks never fill it. */
  readonly physicalClock: LivePhysicalClockV1 | null;
  /** Signal applying after this sample, not a claim about the prior interval. */
  readonly motor: LiveMotorSignalV1;
  /** Must be joined to actual edges by the caller. Missing or mixed exposure
   * stays unknown; the after-sample signal never substitutes for it. */
  readonly intervalMotor?: LiveMotorSignalV1;
  /** Delivery time is allowed for callers' instrumentation, never encoded. */
  readonly receivedMonotonicMs?: number;
}
export interface ObservedCueMemoryV1 {
  readonly fingerprint: string; readonly provenance: 'remembered-real-cue';
  readonly lastSeen: LiveFrameKeyV1; readonly properties: Channels;
  readonly relativeAtObservation: XYZ;
  readonly agePhysicalSeconds: number | null;
  readonly association: 'unambiguous-at-observation' | 'ambiguous-at-observation' | 'unverified' | 'unanchored-restart';
  readonly visibleNow: false; readonly currentPosition: null; readonly persistence: 'unverified';
}
export interface LiveStateV1 {
  readonly version: 'ExperienceLiveStateV1'; readonly law: typeof EXPERIENCE_LIVE_LAW;
  readonly origin: 'real' | 'imagined'; readonly revision: number;
  readonly frame: LiveFrameKeyV1 | null; readonly physicalClock: LivePhysicalClockV1 | null;
  readonly elapsed: LiveElapsedV1; readonly motor: LiveMotorSignalV1;
  readonly intervalMotor: LiveMotorSignalV1;
  readonly continuity: 'unanchored' | 'continuous' | 'gap' | 'timing-unknown';
  readonly projection: readonly number[]; readonly h: readonly number[];
  /** Original public conditions remain available for independent domain tests.
   * Hash collisions and h values themselves confer no predictive support. */
  readonly channels: Channels; readonly memories: readonly ObservedCueMemoryV1[];
}
export interface ExperienceLiveOptions {
  readonly frameCapacity: number; readonly cueCapacity: number;
  readonly maximumChannels: number; readonly maximumSnapshotBytes: number;
}
interface FrameEntry { readonly key: LiveFrameKeyV1; readonly envelopeSha256: string; readonly state: LiveStateV1 }
export interface ExperienceLiveSnapshotV1 {
  readonly version: 'ExperienceLiveSnapshotV1'; readonly law: typeof EXPERIENCE_LIVE_LAW;
  readonly options: ExperienceLiveOptions; readonly current: LiveStateV1;
  readonly frames: readonly FrameEntry[];
  readonly acceptedFrames: number; readonly gapCount: number; readonly unknownDurationFrames: number;
}
export interface LiveAcceptanceV1 {
  readonly disposition: 'advanced' | 'duplicate' | 'gap'; readonly stateRevision: number;
  readonly lastConsumed: LiveFrameKeyV1; readonly thetaWrites: 0;
}
const UNKNOWN_MOTOR: LiveMotorSignalV1 = { state: 'unknown', provenance: 'unknown', cue: null };
const DEFAULTS: ExperienceLiveOptions = { frameCapacity: 64, cueCapacity: 8,
  maximumChannels: 2048, maximumSnapshotBytes: 1_048_576 };
function fail(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
const copy = <T>(value: T): T => immutable(structuredClone(value));
// Runtime provenance survives readonly references, never serialized copies.
// A matching version string/digest alone cannot mint an observed history.
const ACTUAL_STATES = new WeakSet<object>();
const BRANCH_STATES = new WeakSet<object>();
const ACTUAL_OWNER = new WeakMap<object, object>();
const SEALED_OBSERVATIONS = new WeakMap<Observation, string>();
/** Register only after full validation and recursive freezing. A caller's
 * mutable object never receives a reusable digest cache entry. */
export function sealRealObservation(observation: Observation): string {
  const registered = SEALED_OBSERVATIONS.get(observation); if (registered) return registered;
  validateObservation(observation, false);
  freezeEvidenceData(observation);
  const digest = sha(observation); SEALED_OBSERVATIONS.set(observation, digest); return digest;
}
export function actualObservationDigest(observation: Observation): string {
  return SEALED_OBSERVATIONS.get(observation) ?? sha(observation);
}
export function isActualLiveState(value: unknown): value is LiveStateV1 {
  return value !== null && typeof value === 'object' && ACTUAL_STATES.has(value);
}
export function isExperienceLiveState(value: unknown): value is LiveStateV1 {
  return isActualLiveState(value) || value !== null && typeof value === 'object' && BRANCH_STATES.has(value);
}
export function areConsecutiveActualStates(before: LiveStateV1, after: LiveStateV1): boolean {
  return isActualLiveState(before) && isActualLiveState(after) && ACTUAL_OWNER.get(after) === ACTUAL_OWNER.get(before)
    && after.revision === before.revision + 1 && after.frame?.epoch === before.frame?.epoch
    && after.frame!.sequence === before.frame!.sequence + 1;
}
function validateChannels(channels: Channels, maximum = 2048): void {
  fail(channels && typeof channels === 'object' && !Array.isArray(channels), 'invalid-live-channels');
  const rows = Object.entries(channels); fail(rows.length <= maximum, 'live-channel-capacity-exceeded');
  for (const [key, value] of rows) {
    fail(key.length > 0 && key.length <= 256, 'invalid-live-channel-name');
    fail(value === null || typeof value === 'boolean' || finite(value)
      || typeof value === 'string' && value.length <= 256, 'invalid-live-channel-value');
  }
}
function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return hash;
}
/** No mutable receptor dictionary: later and reordered channels use the same
 * bounded projection. Retain raw conditions separately when testing support. */
export function projectLiveChannels(channels: Channels, maximumChannels = 2048): readonly number[] {
  validateChannels(channels, maximumChannels);
  const projected = Array<number>(LIVE_RECEPTORS).fill(0), entries = Object.entries(channels).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const add = (key: string, value: number) => {
    for (const seed of [2166136261, 2246822519]) {
      const digest = hash32(key, seed), site = digest % LIVE_RECEPTORS;
      projected[site]! += (digest & 0x80000000 ? -1 : 1) * value;
    }
  };
  for (const [name, value] of entries) {
    add('present:' + name, .25);
    if (typeof value === 'number') add('number:' + name, value / (1 + Math.abs(value)));
    else if (typeof value === 'boolean') add('boolean:' + name, value ? 1 : -1);
    else add(canonical(['category', name, value]), 1);
  }
  const scale = Math.sqrt(Math.max(1, entries.length));
  return immutable(projected.map(value => Math.tanh(value / scale)));
}
const WEIGHTS = Array.from({ length: LIVE_ACTIVATIONS }, (_, i) => Array.from({ length: LIVE_RECEPTORS }, (_, j) =>
  ((hash32(`${EXPERIENCE_LIVE_LAW}/${i}/${j}`, 2166136261) % 2001) / 1000 - 1) / Math.sqrt(LIVE_RECEPTORS)));
function activation(projected: readonly number[], previous: readonly number[], elapsed: LiveElapsedV1,
  reset: boolean): readonly number[] {
  return immutable(WEIGHTS.map((weights, i) => {
    // The fixed, contractive recurrence is a history basis, not learned effects.
    const drive = weights.reduce((sum, weight, j) => sum + weight * projected[j]!, 0)
      + (reset ? 0 : .125 * previous[i]! + .125 * previous[(i + 1) % LIVE_ACTIVATIONS]!);
    const target = Math.tanh(drive);
    if (reset || elapsed.kind === 'unknown') return target;
    const alpha = Math.exp(-elapsed.seconds / TAU[i]!);
    return alpha * previous[i]! + (1 - alpha) * target;
  }));
}
function validateClock(clock: LivePhysicalClockV1 | null): void {
  if (clock === null) return;
  fail(clock?.provenance === 'body-physics' && Number.isSafeInteger(clock.physicsTick) && clock.physicsTick >= 0
    && finite(clock.secondsPerTick) && clock.secondsPerTick > 0 && clock.secondsPerTick <= 1, 'invalid-live-physical-clock');
}
function validateMotor(motor: LiveMotorSignalV1): void {
  fail(motor && ['off', 'held', 'impulse', 'unknown'].includes(motor.state), 'invalid-live-motor');
  if (motor.state === 'unknown') { fail(motor.provenance === 'unknown' && motor.cue === null, 'invalid-live-motor'); return; }
  if (motor.state === 'off') {
    fail(['body-transition', 'verified-passive'].includes(motor.provenance) && motor.cue === null, 'invalid-live-motor'); return;
  }
  const cue = motor.cue;
  fail(motor.provenance === 'body-transition' && cue && typeof cue.kind === 'string' && cue.kind.length <= 32
    && cue.targetRole === null, 'live-motor-requires-anonymous-body-evidence');
  validateChannels(cue.parameters, 16);
}
function validateObservation(observation: Observation, imagined: boolean): void {
  fail(observation && Number.isSafeInteger(observation.sequence) && observation.sequence >= 0
    && finite(observation.activeSeconds) && observation.activeSeconds >= 0, 'invalid-live-observation');
  fail(Array.isArray(observation.objects) && observation.objects.length <= 512, 'invalid-live-visible-objects');
  fail(observation.self && observation.self.position.length === 3 && observation.self.position.every(finite)
    && finite(observation.self.yaw) && finite(observation.self.pitch), 'invalid-live-body-measurement');
  validateChannels(observation.self.properties);
  for (const object of observation.objects) {
    fail(typeof object.id === 'string' && object.id.length <= 256 && object.relativePosition.length === 3
      && object.relativePosition.every(finite), 'invalid-live-visible-object');
    validateChannels(object.properties);
  }
  fail(new Set(observation.objects.map(object => object.id)).size === observation.objects.length, 'duplicate-live-visible-object');
  if (imagined) fail(Array.isArray(observation.predictionSupport)
    && observation.predictionSupport.every(value => typeof value === 'string' && value.length <= 512), 'branch-requires-explicit-imagined-support');
  else fail(observation.predictionSupport === undefined && observation.predictionBounds === undefined
    && observation.predictionContext === undefined, 'imagined-frame-cannot-enter-live-state');
  const clock = observation.physicalClock;
  if (clock) fail(!imagined && clock.version === 'RealFrameClockV1' && Number.isSafeInteger(clock.physicsTick)
    && clock.physicsTick >= 0 && clock.secondsPerTick === .05 && finite(clock.monotonicMs) && clock.monotonicMs >= 0
    && ['physics', 'terminal'].includes(clock.sample), 'invalid-live-observation-clock');
  const signal = observation.motorSignal;
  if (signal) {
    fail(!imagined && signal.version === 'BodyMotorSignalV1' && signal.scope === 'instrumented-held-controls', 'invalid-live-observation-motor');
    validateMotor(signal.state === 'held' ? { state: 'held', provenance: 'body-transition', cue: signal.cue }
      : signal.state === 'off' ? { state: 'off', provenance: 'body-transition', cue: signal.cue }
        : { state: signal.state, provenance: 'unknown', cue: signal.cue });
  }
  if (observation.sensation) {
    const view = observation.sensation;
    fail(Number.isSafeInteger(view.width) && Number.isSafeInteger(view.height) && view.width > 0 && view.height > 0
      && view.samples.length === view.width * view.height * 4 && view.samples.length <= 262144
      && view.samples.every(finite) && finite(view.range) && view.range > 0, 'invalid-live-visual-sensation');
    fail(!imagined, 'imagined-pixels-cannot-enter-live-branch');
  }
}
function sensoryChannels(observation: Observation): Record<string, PublicValue> {
  // Interval propagation through recurrent state is not implemented in this
  // component. A non-point imagined field is masked, never silently narrowed.
  const known = (field: string) => !observation.predictionSupport || observation.predictionSupport.includes(field)
    && (!observation.predictionBounds?.[field]
      || observation.predictionBounds[field]![0] === observation.predictionBounds[field]![1]);
  const out: Record<string, PublicValue> = {};
  if (known('self/pitch')) out['sense/pitch'] = observation.self.pitch;
  for (const [key, value] of Object.entries(observation.self.properties))
    if (!key.startsWith('velocity') && known('self/properties.' + key)) out['sense/self/' + key] = value;
  const velocityKeys = ['velocityX', 'velocityY', 'velocityZ'];
  if (known('self/yaw') && velocityKeys.every(key => Object.hasOwn(observation.self.properties, key)
    && known('self/properties.' + key))) worldToBody(velocityKeys.map(key => Number(observation.self.properties[key])), observation.self.yaw)
      .forEach((value, i) => out['sense/velocity/' + i] = value);
  const gaze = known('targetId') ? observation.objects.find(object => object.id === observation.targetId) : undefined;
  out['sense/gaze-known'] = known('targetId');
  if (known('targetId')) out['sense/gaze-measured'] = Boolean(gaze);
  if (gaze) {
    if (known('self/yaw') && [0, 1, 2].every(i => known(`object:${gaze.id}/relativePosition.${i}`)))
      worldToBody(gaze.relativePosition, observation.self.yaw).forEach((value, i) => out['sense/gaze-relative/' + i] = value);
    for (const [key, value] of Object.entries(gaze.properties))
      if (!['confidence', 'ambiguity'].includes(key) && known(`object:${gaze.id}/properties.${key}`)) out['sense/gaze/' + key] = value;
  }
  const view = observation.sensation;
  if (view) {
    // Fixed peripheral sample work; body signals and every public scalar above
    // retain a path. This is not an adaptive attention mechanism.
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
      const px = Math.min(view.width - 1, Math.floor((x + .5) * view.width / 3));
      const py = Math.min(view.height - 1, Math.floor((y + .5) * view.height / 2)), offset = (py * view.width + px) * 4;
      for (let c = 0; c < 4; c++) out[`sense/periphery/${y}/${x}/${c}`] = c === 3 && view.samples[offset + c]! < 0
        ? view.range : view.samples[offset + c]!;
    }
  }
  return out;
}
function conditionedChannels(observation: Observation, elapsed: LiveElapsedV1, motor: LiveMotorSignalV1,
  memories: readonly ObservedCueMemoryV1[], intervalMotor: LiveMotorSignalV1): Channels {
  const out = sensoryChannels(observation);
  out['time/known'] = elapsed.kind === 'measured';
  if (elapsed.kind === 'measured') out['time/dt'] = elapsed.seconds;
  out['motor/known'] = motor.state !== 'unknown';
  if (motor.state !== 'unknown') out['motor/state'] = motor.state;
  if (motor.state === 'held' || motor.state === 'impulse') {
    out['motor/kind'] = motor.cue.kind;
    for (const [key, value] of Object.entries(motor.cue.parameters))
      if (!['ticks', 'holdTicks'].includes(key)) out['motor/parameter/' + key] = value;
  }
  out['motor/interval-known'] = intervalMotor.state !== 'unknown';
  if (intervalMotor.state !== 'unknown') out['motor/interval-state'] = intervalMotor.state;
  if (intervalMotor.state === 'held' || intervalMotor.state === 'impulse') {
    out['motor/interval-kind'] = intervalMotor.cue.kind;
    for (const [key, value] of Object.entries(intervalMotor.cue.parameters))
      if (!['ticks', 'holdTicks'].includes(key)) out['motor/interval-parameter/' + key] = value;
  }
  memories.forEach((memory, index) => {
    const prefix = `memory/${index}/`;
    out[prefix + 'source'] = memory.provenance; out[prefix + 'association'] = memory.association;
    out[prefix + 'persistence-known'] = false; out[prefix + 'current-position-known'] = false;
    out[prefix + 'age-known'] = memory.agePhysicalSeconds !== null;
    if (memory.agePhysicalSeconds !== null) out[prefix + 'age'] = memory.agePhysicalSeconds;
    for (const [key, value] of Object.entries(memory.properties)) out[prefix + 'observed/' + key] = value;
  });
  return out;
}
function agedMemories(memories: readonly ObservedCueMemoryV1[], elapsed: LiveElapsedV1): ObservedCueMemoryV1[] {
  return memories.map(memory => ({ ...memory, agePhysicalSeconds: elapsed.kind === 'measured'
    && memory.agePhysicalSeconds !== null ? memory.agePhysicalSeconds + elapsed.seconds : null }));
}
function observeCue(observation: Observation, key: LiveFrameKeyV1, previous: readonly ObservedCueMemoryV1[], capacity: number): readonly ObservedCueMemoryV1[] {
  const cue = observation.objects.find(object => object.id === observation.targetId);
  if (!cue || capacity === 0) return previous;
  const track = observation.perception?.tracks.find(value => value.id === cue.id);
  // A measurement may be ambiguous; preserve that fact, never assert identity.
  if (track && !track.visible) return previous;
  const properties = Object.fromEntries(Object.entries(cue.properties).filter(([name]) => !['confidence', 'ambiguity'].includes(name)));
  const relative = worldToBody(cue.relativePosition, observation.self.yaw) as unknown as XYZ;
  const fingerprint = sha({ properties, relative });
  const memory: ObservedCueMemoryV1 = { fingerprint, provenance: 'remembered-real-cue', lastSeen: key,
    properties, relativeAtObservation: relative, agePhysicalSeconds: 0,
    association: !track ? 'unverified' : track.ambiguity >= .5 || track.confidence < .5
      ? 'ambiguous-at-observation' : 'unambiguous-at-observation',
    visibleNow: false, currentPosition: null, persistence: 'unverified' };
  // Equal sensory cues are one remembered measurement pattern, not a claim
  // that equal-looking objects are identical. IDs never select a receptor.
  return [memory, ...previous.filter(value => value.fingerprint !== fingerprint)].slice(0, capacity);
}
function blank(): LiveStateV1 {
  return copy<LiveStateV1>({ version: 'ExperienceLiveStateV1', law: EXPERIENCE_LIVE_LAW, origin: 'real', revision: 0,
    frame: null, physicalClock: null, elapsed: { kind: 'unknown', reason: 'initial' }, motor: UNKNOWN_MOTOR,
    intervalMotor: UNKNOWN_MOTOR,
    continuity: 'unanchored', projection: Array(LIVE_RECEPTORS).fill(0), h: Array(LIVE_ACTIVATIONS).fill(0),
    channels: {}, memories: [] });
}
function optionsFor(options: Partial<ExperienceLiveOptions>): ExperienceLiveOptions {
  const result = { ...DEFAULTS, ...options };
  for (const [key, min, max] of [['frameCapacity', 1, 512], ['cueCapacity', 0, 32],
    ['maximumChannels', 64, 4096], ['maximumSnapshotBytes', 4096, 16_777_216]] as const)
    fail(Number.isSafeInteger(result[key]) && result[key] >= min && result[key] <= max, 'invalid-live-capacity:' + key);
  return copy(result);
}
function assertState(state: LiveStateV1, options: ExperienceLiveOptions): void {
  fail(state?.version === 'ExperienceLiveStateV1' && state.law === EXPERIENCE_LIVE_LAW
    && ['real', 'imagined'].includes(state.origin), 'invalid-live-state-version');
  fail(Number.isSafeInteger(state.revision) && state.revision >= 0 && state.projection.length === LIVE_RECEPTORS
    && state.h.length === LIVE_ACTIVATIONS && [...state.projection, ...state.h].every(value => finite(value) && Math.abs(value) <= 1), 'invalid-live-activation');
  fail(state.memories.length <= options.cueCapacity, 'live-memory-capacity-exceeded');
  fail(['unanchored', 'continuous', 'gap', 'timing-unknown'].includes(state.continuity), 'invalid-live-continuity');
  fail(state.elapsed?.kind === 'measured' && finite(state.elapsed.seconds) && state.elapsed.seconds >= 0 && state.elapsed.seconds <= 100
    || state.elapsed?.kind === 'unknown' && ['initial', 'missing-clock', 'clock-change', 'gap', 'restart', 'branch-unknown']
      .includes(state.elapsed.reason), 'invalid-live-elapsed');
  const keyValid = (key: LiveFrameKeyV1) => typeof key?.epoch === 'string' && key.epoch.length > 0 && key.epoch.length <= 256
    && Number.isSafeInteger(key.sequence) && key.sequence >= 0 && /^[a-f0-9]{64}$/.test(key.sensorySha256);
  if (state.frame !== null) fail(keyValid(state.frame), 'invalid-live-frame-key');
  validateChannels(state.channels, options.maximumChannels); validateClock(state.physicalClock); validateMotor(state.motor);
  validateMotor(state.intervalMotor);
  for (const memory of state.memories) {
    fail(memory.provenance === 'remembered-real-cue' && memory.visibleNow === false && memory.currentPosition === null
      && memory.persistence === 'unverified' && (memory.agePhysicalSeconds === null || finite(memory.agePhysicalSeconds)
      && memory.agePhysicalSeconds >= 0) && memory.relativeAtObservation.length === 3
      && memory.relativeAtObservation.every(finite), 'invalid-live-memory-provenance');
    fail(keyValid(memory.lastSeen) && /^[a-f0-9]{64}$/.test(memory.fingerprint)
      && ['unambiguous-at-observation', 'ambiguous-at-observation', 'unverified', 'unanchored-restart'].includes(memory.association),
    'invalid-live-memory-source');
    validateChannels(memory.properties, options.maximumChannels);
  }
}

/** Bounded actual history. Its output is a feature/state component only; it
 * predicts no effects, grants no support and never changes learned theta. */
export class ExperienceLiveState {
  readonly options: ExperienceLiveOptions;
  #current = blank(); #frames: FrameEntry[] = [];
  #entryBytes = new WeakMap<FrameEntry, number>(); #framesBytes = 0;
  #owner = Object.freeze({});
  #payloadBytes = 0;
  #accepted = 0; #gaps = 0; #unknown = 0;
  constructor(options: Partial<ExperienceLiveOptions> = {}) {
    this.options = optionsFor(options); this.#payloadBytes = Buffer.byteLength(canonical(this.#snapshot())); Object.freeze(this);
  }
  /** Exact exported canonical JSON payload bytes, not process memory/RSS. */
  get snapshotPayloadBytes(): number { return this.#payloadBytes; }
  current(): LiveStateV1 { return this.#current; }
  stateAt(key: LiveFrameKeyV1): LiveStateV1 | null {
    const entry = this.#frames.find(value => value.key.epoch === key.epoch && value.key.sequence === key.sequence);
    if (!entry) return null;
    fail(entry.key.sensorySha256 === key.sensorySha256, 'live-frame-digest-conflict'); return entry.state;
  }
  accept(frame: LiveRealFrameV1): LiveAcceptanceV1 {
    fail(frame?.provenance === 'observed-real' && typeof frame.epoch === 'string' && frame.epoch.length > 0
      && frame.epoch.length <= 256, 'live-state-requires-real-provenance');
    validateClock(frame.physicalClock); validateMotor(frame.motor);
    if (frame.intervalMotor !== undefined) validateMotor(frame.intervalMotor);
    if (frame.receivedMonotonicMs !== undefined) fail(finite(frame.receivedMonotonicMs) && frame.receivedMonotonicMs >= 0, 'invalid-live-delivery-time');
    const sensorySha256 = sealRealObservation(frame.observation);
    const key: LiveFrameKeyV1 = copy({ epoch: frame.epoch, sequence: frame.observation.sequence, sensorySha256 });
    const envelopeSha256 = sha({ key, physicalClock: frame.physicalClock, motor: frame.motor,
      intervalMotor: frame.intervalMotor ?? UNKNOWN_MOTOR });
    const previous = this.#current, duplicate = this.#frames.find(value => value.key.epoch === key.epoch && value.key.sequence === key.sequence);
    if (duplicate) {
      fail(duplicate.envelopeSha256 === envelopeSha256, 'live-frame-digest-conflict');
      return { disposition: 'duplicate', stateRevision: previous.revision, lastConsumed: previous.frame!, thetaWrites: 0 };
    }
    fail(!previous.frame || previous.frame.epoch === key.epoch, 'live-epoch-change-requires-explicit-restart');
    fail(!previous.frame || key.sequence > previous.frame.sequence, 'live-frame-out-of-order-or-retired');
    const gap = !!previous.frame && key.sequence !== previous.frame.sequence + 1;
    if (previous.frame && previous.physicalClock && frame.physicalClock) {
      const ticks = frame.physicalClock.physicsTick - previous.physicalClock.physicsTick;
      fail(Number.isSafeInteger(ticks) && ticks >= 0 && ticks <= key.sequence - previous.frame.sequence, 'invalid-live-clock-order');
    }
    let elapsed: LiveElapsedV1;
    if (gap) elapsed = { kind: 'unknown', reason: 'gap' };
    else if (!previous.frame) elapsed = { kind: 'unknown', reason: 'initial' };
    else if (!previous.physicalClock || !frame.physicalClock) elapsed = { kind: 'unknown', reason: 'missing-clock' };
    else {
      const ticks = frame.physicalClock.physicsTick - previous.physicalClock.physicsTick;
      elapsed = frame.physicalClock.secondsPerTick === previous.physicalClock.secondsPerTick
        ? { kind: 'measured', seconds: ticks * frame.physicalClock.secondsPerTick }
        : { kind: 'unknown', reason: 'clock-change' };
    }
    const intervalMotor = !previous.frame || gap ? UNKNOWN_MOTOR : frame.intervalMotor ?? UNKNOWN_MOTOR;
    const memories = observeCue(frame.observation, key, agedMemories(gap ? [] : previous.memories, elapsed), this.options.cueCapacity);
    const channels = conditionedChannels(frame.observation, elapsed, frame.motor, memories, intervalMotor);
    const projection = projectLiveChannels(channels, this.options.maximumChannels);
    const next: LiveStateV1 = copy({ version: 'ExperienceLiveStateV1', law: EXPERIENCE_LIVE_LAW, origin: 'real',
      revision: previous.revision + 1, frame: key, physicalClock: frame.physicalClock, elapsed, motor: frame.motor, intervalMotor,
      continuity: gap ? 'gap' : !previous.frame ? 'unanchored' : elapsed.kind === 'unknown' ? 'timing-unknown' : 'continuous',
      projection, h: activation(projection, previous.h, elapsed, gap || !previous.frame || elapsed.kind === 'unknown'),
      channels, memories });
    const entry = immutable({ key, envelopeSha256, state: next });
    const entryBytes = Buffer.byteLength(canonical(entry));
    const retired = this.#frames.length === this.options.frameCapacity ? this.#frames[0] : undefined;
    const framesBytes = this.#framesBytes + entryBytes - (retired ? this.#entryBytes.get(retired)! : 0);
    const entries = [...this.#frames, entry].slice(-this.options.frameCapacity);
    const accepted = this.#accepted + 1, gaps = this.#gaps + Number(gap), unknown = this.#unknown + Number(elapsed.kind === 'unknown');
    assertState(next, this.options);
    // Exact canonical JSON payload bytes: serialize only the new immutable
    // state/entry plus the small outer shell. Retained frames are never walked.
    const shell = { ...this.#snapshot(next, [], accepted, gaps, unknown), current: null };
    const bytes = Buffer.byteLength(canonical(shell)) - 4 + Buffer.byteLength(canonical(next))
      + framesBytes + Math.max(0, entries.length - 1);
    fail(bytes <= this.options.maximumSnapshotBytes, 'live-snapshot-byte-capacity-exceeded');
    // Validate fully before publishing state. A rejected packet changes nothing.
    ACTUAL_STATES.add(next); ACTUAL_OWNER.set(next, this.#owner);
    this.#entryBytes.set(entry, entryBytes); this.#framesBytes = framesBytes; this.#payloadBytes = bytes;
    this.#current = next; this.#frames = entries; this.#accepted = accepted;
    this.#gaps = gaps; this.#unknown = unknown;
    return { disposition: gap ? 'gap' : 'advanced', stateRevision: next.revision, lastConsumed: key, thetaWrites: 0 };
  }
  #snapshot(current = this.#current, frames = this.#frames, acceptedFrames = this.#accepted,
    gapCount = this.#gaps, unknownDurationFrames = this.#unknown): ExperienceLiveSnapshotV1 {
    return { version: 'ExperienceLiveSnapshotV1', law: EXPERIENCE_LIVE_LAW, options: this.options,
      current, frames, acceptedFrames, gapCount, unknownDurationFrames };
  }
  snapshot(): ExperienceLiveSnapshotV1 { return copy(this.#snapshot()); }
  fork(): ExperienceLiveBranch { return new ExperienceLiveBranch(this.#current, this.options); }
  static restore(snapshot: ExperienceLiveSnapshotV1, mode: 'same-world-restart' | 'transfer'): ExperienceLiveState {
    fail(snapshot?.version === 'ExperienceLiveSnapshotV1' && snapshot.law === EXPERIENCE_LIVE_LAW, 'invalid-live-snapshot-version');
    fail(mode === 'same-world-restart' || mode === 'transfer', 'invalid-live-restore-mode');
    const live = new ExperienceLiveState(snapshot.options);
    fail(snapshot.frames.length <= live.options.frameCapacity && Buffer.byteLength(canonical(snapshot)) <= live.options.maximumSnapshotBytes,
      'invalid-live-snapshot-capacity');
    for (const value of [snapshot.acceptedFrames, snapshot.gapCount, snapshot.unknownDurationFrames])
      fail(Number.isSafeInteger(value) && value >= 0, 'invalid-live-snapshot-counter');
    assertState(snapshot.current, live.options);
    fail(snapshot.current.origin === 'real', 'imagined-state-cannot-restore-real-history');
    fail(snapshot.acceptedFrames >= snapshot.frames.length && snapshot.gapCount <= snapshot.acceptedFrames
      && snapshot.unknownDurationFrames <= snapshot.acceptedFrames && snapshot.current.revision === snapshot.acceptedFrames,
    'inconsistent-live-snapshot-counter');
    for (const [index, entry] of snapshot.frames.entries()) {
      assertState(entry.state, live.options);
      fail(entry.state.origin === 'real' && /^[a-f0-9]{64}$/.test(entry.envelopeSha256)
        && canonical(entry.key) === canonical(entry.state.frame), 'invalid-live-snapshot-frame');
      if (index) fail(entry.key.epoch === snapshot.frames[index - 1]!.key.epoch
        && entry.key.sequence > snapshot.frames[index - 1]!.key.sequence, 'invalid-live-snapshot-order');
    }
    fail(snapshot.frames.length ? canonical(snapshot.frames.at(-1)!.state) === canonical(snapshot.current)
      : snapshot.current.frame === null && snapshot.acceptedFrames === 0, 'inconsistent-live-snapshot-head');
    if (mode === 'same-world-restart') {
      live.#current = copy({ ...blank(), elapsed: { kind: 'unknown', reason: 'restart' },
        memories: snapshot.current.memories.map(memory => ({ ...memory, agePhysicalSeconds: null,
          association: 'unanchored-restart' as const })) });
    }
    live.#payloadBytes = Buffer.byteLength(canonical(live.#snapshot()));
    // Both modes start a new epoch and reset h, clocks, current motor, frame
    // ownership and counters. Transfer also discards all observed cue memories.
    return live;
  }
}

/** A private state branch only. The caller must supply a prediction from its
 * learned readout; this component cannot invent or train an action outcome. */
export class ExperienceLiveBranch {
  #state: LiveStateV1; readonly options: ExperienceLiveOptions;
  constructor(state: LiveStateV1, options: ExperienceLiveOptions) {
    this.options = optionsFor(options); assertState(state, this.options);
    this.#state = copy({ ...state, origin: 'imagined' }); BRANCH_STATES.add(this.#state); Object.freeze(this);
  }
  current(): LiveStateV1 { return this.#state; }
  fork(): ExperienceLiveBranch { return new ExperienceLiveBranch(this.#state, this.options); }
  advance(prediction: Observation, elapsed: LiveElapsedV1, intervalMotor: LiveMotorSignalV1,
    motorAfterSample: LiveMotorSignalV1 = intervalMotor): LiveStateV1 {
    validateObservation(prediction, true); validateMotor(intervalMotor); validateMotor(motorAfterSample);
    fail(elapsed.kind === 'unknown' && elapsed.reason === 'branch-unknown'
      || elapsed.kind === 'measured' && finite(elapsed.seconds) && elapsed.seconds >= 0 && elapsed.seconds <= 100,
    'invalid-branch-physical-duration');
    const memories = agedMemories(this.#state.memories, elapsed);
    const channels = conditionedChannels(prediction, elapsed, motorAfterSample, memories, intervalMotor);
    const projection = projectLiveChannels(channels, this.options.maximumChannels);
    const state: LiveStateV1 = copy({ ...this.#state, revision: this.#state.revision + 1,
      physicalClock: null, elapsed, motor: motorAfterSample, intervalMotor,
      continuity: elapsed.kind === 'unknown' ? 'timing-unknown' : this.#state.continuity,
      projection, h: activation(projection, this.#state.h, elapsed, elapsed.kind === 'unknown'), channels, memories });
    assertState(state, this.options);
    fail(Buffer.byteLength(canonical(state)) <= this.options.maximumSnapshotBytes, 'live-branch-byte-capacity-exceeded');
    BRANCH_STATES.add(state); this.#state = state; return this.current();
  }
}
