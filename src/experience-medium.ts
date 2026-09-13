import type { ActionCue, Observation, PublicObject, PublicValue, RealEvent, XYZ } from './contracts.js';
import { measuredMotorCueV1, validateEvent } from './events.js';
import { actualEventDigest } from './experience-sealed-evidence.js';
import { bodyToWorld, worldToBody } from './perception.js';
import { sha } from './util.js';
import { ContextualReadout, type ContextualReadoutSnapshot, type ContextualWindowRow } from './contextual-readout.js';
import { ExperienceLedger } from './experience-ledger.js';
import { addRanges, hull, pointRange, rotateRanges, scaleRange, type NumericRange, type NumericRanges } from './numeric-ranges.js';
import { EXPERIENCE_LIVE_LAW, ExperienceLiveBranch, type LiveStateV1 } from './experience-live-state.js';
import { CONTINUOUS_READOUT, continuousReadoutField, continuousReadoutInput, measuredPairTargets,
  validateExperienceLiveTrace, validateLivePredictionState, type ExperienceWindowLiveTraceV1 } from './experience-timed-readout.js';
import type { IntervalMotor, SourceExperienceIntervals } from './experience-intervals.js';
export type { ExperienceWindowLiveTraceV1 } from './experience-timed-readout.js';

type State = Record<string, PublicValue>;
const INPUTS = 32, HIDDEN = 16, SIZE = 1 + INPUTS + HIDDEN;
export const motorIdentity = (cue: ActionCue) => sha({ kind: cue.kind, parameters: cue.parameters });
// Passive packets have no requested duration. Their retrospective packaging
// length cannot select a horizon-specific endpoint circuit.
export const continuousEndpointIdentity = (cue: ActionCue) => `continuous-v1/endpoint/${motorIdentity(cue.kind === 'passive'
  ? { ...cue, parameters: {} } : cue)}`;
export const continuousIntervalIdentity = (motor: IntervalMotor) => `continuous-v1/interval/${sha(motor.state === 'held'
  ? { state: 'held', ...motor.signal } : { state: 'off' })}`;
interface Head {
  key: string; numeric: boolean; values: PublicValue[]; readout: number[][]; covariance: number[][];
  observations: number; correct: number; error: number; integral: boolean;
  numericQuality: { correct: number; error: number }[];
  categoryReadout: number[][]; categoryCorrect: number; regressionCorrect: number;
  numericMeans: number[];
}
interface MotionEstimate { mean: number[]; covariance: number[][]; information: number[][]; variance: number;
  observations: number; correct: number; error: number;
  calibration?: { windowId: string; error: number; residual: number }[] }
interface Network { inputs: string[]; ranges: [number, number][]; weights: number[][]; bias: number[]; heads: Head[];
  observations: number; motion?: MotionEstimate; encoding?: typeof EXPERIENCE_LIVE_LAW }
type PredictionHead = Omit<Head, 'covariance'>;
type WindowReadout = Pick<Network, 'inputs' | 'ranges' | 'weights' | 'bias' | 'encoding'>
  & { heads: PredictionHead[]; motion?: Pick<MotionEstimate, 'mean'> };
function windowReadout(network?: Network): WindowReadout | undefined {
  if (!network) return undefined;
  // The pre-window prediction needs readout parameters, not the much larger
  // fitting covariance matrices. Keep an independent copy of every value
  // that decoding actually reads; live fitting matrices remain untouched.
  return structuredClone({ inputs: network.inputs, ranges: network.ranges,
    weights: network.weights, bias: network.bias,
    ...(network.encoding ? { encoding: network.encoding } : {}),
    heads: network.heads.map(({ covariance: _covariance, ...head }) => head),
    ...(network.motion ? { motion: { mean: network.motion.mean } } : {}) });
}
export interface ExperienceMediumSnapshot {
  version: 'KairosExperienceMediumV9' | 'KairosExperienceMediumV10' | 'KairosExperienceMediumV11' | 'KairosExperienceMediumV12'; seed: number; random: number;
  networks: [string, Network][]; events: [string, string][]; writes: number;
  /** Verified zero-duration motor exposures retained by the ledger, not training writes. */
  untrainedMotorWindows?: number;
  /** Source-retained live windows with no fully verified physical clock. */
  untrainedLiveWindows?: number;
  contexts?: ContextualReadoutSnapshot;
  ledger?: { capacity: number; retired: string; streams?: [string, number][] };
  semantics?: typeof CONTINUOUS_READOUT;
}
export interface ExperiencePrediction {
  observation: Observation | null; accepted: boolean; reason: string | null;
  activationMargin: number; prequentialAccuracy: number; observedSamples: number; settled: boolean;
  supportedFields: readonly string[];
  /** Untrusted learned outputs for selecting a physical probe, never evidence. */
  hypothesizedFields?: readonly string[];
  /** Identity-free predicted gaze measurement, compared to the later gaze. */
  predictedGazeRole?: string;
  /** Private next state. Timed motor-on/off rollout is not yet implemented. */
  state?: LiveStateV1;
  timing?: { semantics: 'window-endpoint-v1';
    returnPhysicalTicks: { range: NumericRange | null; supported: boolean };
    intervalRolloutSupported: false };
}
export interface ExperienceIntervalReadout {
  readonly semantics: 'teacher-forced-one-interval-v1';
  readonly deltaSeconds: number; readonly wholeWindowSupported: false; readonly thetaWrites: 0;
  readonly outputs: readonly { field: string; value: PublicValue; absolute: boolean;
    range: NumericRange | null; supported: boolean; independentCalibrationWindows: number }[];
}
/** Audit/search identity only. These object IDs and world coordinates NEVER
 * parameterize a learned circuit or its receptor layout. */
export function experienceState(observation: Observation): State {
  const state: State = {}, put = (path: string[], value: PublicValue) => { state[JSON.stringify(path)] = value; };
  put(['targetId'], observation.targetId);
  observation.self.position.forEach((v, i) => put(['self', 'position', String(i)], v));
  put(['self', 'yaw'], observation.self.yaw); put(['self', 'pitch'], observation.self.pitch);
  for (const [k, v] of Object.entries(observation.self.properties)) put(['self', 'properties', k], v);
  for (const object of observation.objects) {
    put(['object', object.id, 'type'], object.type);
    object.relativePosition.forEach((v, i) => put(['object', object.id, 'relativePosition', String(i)], v));
    for (const [k, v] of Object.entries(object.properties)) put(['object', object.id, 'properties', k], v);
  }
  return Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
export function experienceInputs(observation: Observation, object?: PublicObject): State {
  const known = (key: string) => !observation.predictionSupport || observation.predictionSupport.includes(key);
  const state: State = {};
  if (known('self/pitch')) state.pitch = observation.self.pitch;
  for (const [k, v] of Object.entries(observation.self.properties)) {
    if (!k.startsWith('velocity') && known(`self/properties.${k}`)) state[`self/${k}`] = v;
  }
  const velocity = ['velocityX', 'velocityY', 'velocityZ'].map(k => Number(observation.self.properties[k] ?? 0));
  if (known('self/yaw') && ['velocityX', 'velocityY', 'velocityZ'].every(k =>
    !Object.hasOwn(observation.self.properties, k) || known(`self/properties.${k}`)))
    worldToBody(velocity, observation.self.yaw).forEach((v, i) => state[`velocity/${i}`] = v);
  const view = observation.sensation;
  if (view) {
    const center = (Math.floor(view.height / 2) * view.width + Math.floor(view.width / 2)) * 4;
    const depth = view.samples[center + 3]!;
    state['view/gaze'] = depth < 0 ? view.range : depth;
    // A provisional surface can contain visually different parts. Preserve
    // the actual foveal sample alongside the group hypothesis: averaging a
    // large neighboring patch must not erase the appearance at the actuator.
    // RGB and depth come from the same ray, with no material identity/effect.
    for (let channel = 0; channel < 3; channel++) state[`view/fovea/${channel}`] = view.samples[center + channel]!;
  }
  if (view) for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    let total = 0, count = 0;
    for (let y = Math.floor(row * view.height / 2); y < Math.floor((row + 1) * view.height / 2); y++)
      for (let x = Math.floor(col * view.width / 3); x < Math.floor((col + 1) * view.width / 3); x++) {
        const d = view.samples[(y * view.width + x) * 4 + 3]!;
        total += d < 0 ? view.range : d; count++;
      }
    state[`view/${row}/${col}`] = total / Math.max(1, count);
  }
  if (!view && observation.predictionContext) Object.assign(state, observation.predictionContext);
  // The same physical motor may have different body/scene consequences on
  // different visible surfaces. Target appearance and geometry are current
  // sensory context; neither engine identity nor a named material effect is
  // supplied. Unknown predicted gaze or object channels remain absent.
  if (known('targetId')) {
    const gaze = observation.objects.find(value => value.id === observation.targetId);
    if (gaze) {
      if (known('self/yaw') && [0, 1, 2].every(i => known(`object:${gaze.id}/relativePosition.${i}`)))
        worldToBody(gaze.relativePosition, observation.self.yaw).forEach((v, i) => state[`gaze/relative/${i}`] = v);
      for (const [k, v] of Object.entries(gaze.properties))
        if (!['confidence', 'ambiguity'].includes(k) && known(`object:${gaze.id}/properties.${k}`)) state[`gaze/property/${k}`] = v;
    }
  }
  if (object) {
    if (known('self/yaw') && [0, 1, 2].every(i => known(`object:${object.id}/relativePosition.${i}`)))
      worldToBody(object.relativePosition, observation.self.yaw).forEach((v, i) => state[`relative/${i}`] = v);
    for (const [k, v] of Object.entries(object.properties))
      if (!['confidence', 'ambiguity'].includes(k) && known(`object:${object.id}/properties.${k}`)) state[`object/${k}`] = v;
    if (known('targetId')) state.target = object.id === observation.targetId;
  }
  return state;
}
const inputState = experienceInputs;
/** Carry uncertainty through the same receptor transforms as actual sensing. */
export function experienceInputBounds(observation: Observation, object?: PublicObject): NumericRanges {
  const output: Record<string, NumericRange> = {}, bounds = observation.predictionBounds;
  if (!bounds) return output;
  const copy = (input: string, field: string) => { if (bounds[field]) output[input] = bounds[field]; };
  copy('pitch', 'self/pitch');
  for (const property of Object.keys(observation.self.properties)) if (!property.startsWith('velocity'))
    copy(`self/${property}`, `self/properties.${property}`);
  for (const channel of Object.keys(observation.predictionContext ?? {})) copy(channel, 'context/' + channel);
  const yaw = bounds['self/yaw'] ?? pointRange(observation.self.yaw);
  const rotate = (prefix: string, fields: string[], values: readonly number[]) => {
    const transformed = rotateRanges(fields.map((field, i) => bounds[field] ?? pointRange(values[i]!)), yaw, true);
    transformed.forEach((range, i) => { if (range) output[`${prefix}/${i}`] = range; });
  };
  const velocity = ['velocityX', 'velocityY', 'velocityZ'];
  rotate('velocity', velocity.map(key => 'self/properties.' + key), velocity.map(key => Number(observation.self.properties[key] ?? 0)));
  const gaze = observation.objects.find(value => value.id === observation.targetId);
  for (const [prefix, subject] of [['gaze', gaze], ['object', object]] as const) if (subject) {
    rotate(prefix === 'gaze' ? 'gaze/relative' : 'relative', [0, 1, 2].map(i => `object:${subject.id}/relativePosition.${i}`), subject.relativePosition);
    for (const key of Object.keys(subject.properties)) copy(prefix === 'gaze' ? `gaze/property/${key}` : `object/${key}`,
      `object:${subject.id}/properties.${key}`);
  }
  return output;
}
const tolerance = (value: number) => .025 + .075 * Math.max(1, Math.abs(value));
function updatedCovariance(matrix: number[][], product: number[], denominator: number): number[][] {
  const result = matrix.map(row => [...row]); let trace = 0;
  for (let i = 0; i < result.length; i++) for (let j = i; j < result.length; j++) {
    const value = ((matrix[i]![j]! + matrix[j]![i]!) / 2 - product[i]! * product[j]! / denominator) / .995;
    result[i]![j] = result[j]![i] = value;
    if (i === j) trace += value;
  }
  // Forgetting otherwise expands unexcited directions exponentially until
  // roundoff destroys positive covariance. Uniform scaling preserves its
  // geometry and bounds numerical gain; it supplies no measured evidence.
  if (!Number.isFinite(trace) || trace <= 0) throw new Error('unstable-experience-covariance');
  if (trace > 1e6) for (const row of result) for (let j = 0; j < row.length; j++) row[j]! *= 1e6 / trace;
  return result;
}
function inverseInformation(matrix: number[][]): number[][] | null {
  const [a, b, c] = matrix[0]!, [, d, e] = matrix[1]!, [, , f] = matrix[2]!;
  const A = d! * f! - e! * e!, B = c! * e! - b! * f!, C = b! * e! - c! * d!;
  const D = a! * f! - c! * c!, E = b! * c! - a! * e!, F = a! * d! - b! * b!;
  const determinant = a! * A + b! * B + c! * C;
  if (!(determinant > 1e-10 * a! * d! * f!)) return null;
  return [[A, B, C], [B, D, E], [C, E, F]].map(row => row.map(v => v / determinant));
}
function features(state: State): [string, number][] {
  return Object.entries(state).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('invalid-public-receptor-value');
      return [k, v / 4];
    }
    if (typeof v === 'boolean') return [k, v ? 1 : -1];
    return [JSON.stringify([k, v]), 1];
  });
}

/** Simulated rate neurons with plastic readout conductances. Motor signals
 * select a circuit; self-relative measurements drive continuous receptors and
 * tanh populations. Recursive least-squares plasticity learns each output from
 * actual windows. Missing objects mask only their unobserved channels. No
 * supplied effects, solution sequences, world IDs or semantic object classes
 * parameterize these circuits. Contextual samples are measured transitions. */
export class ExperienceMedium {
  #seed: number; #random: number; #networks = new Map<string, Network>();
  #ledger = new ExperienceLedger(); #contexts = new ContextualReadout(); #writes = 0;
  #untrainedMotorWindows = 0;
  #untrainedLiveWindows = 0;
  #continuous = false;
  #attentionPredictions = new WeakMap<Observation, Map<string, ExperiencePrediction>>();
  #attentionBase = new WeakMap<Observation, Map<string, number>>();
  constructor(seed = 1) {
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error('invalid-experience-seed');
    this.#seed = seed; this.#random = seed;
  }
  get writes(): number { return this.#writes; }
  #uniform(): number { let x = this.#random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.#random = x >>> 0; return this.#random / 4294967296; }
  #network(id: string, encoding?: typeof EXPERIENCE_LIVE_LAW): Network {
    let network = this.#networks.get(id);
    if (!network) {
      network = encoding ? { encoding, inputs: [], ranges: [], weights: Array.from({ length: HIDDEN }, () => Array(INPUTS).fill(0)),
        bias: Array(HIDDEN).fill(0), heads: [], observations: 0 } : { inputs: [], ranges: [], weights: Array.from({ length: HIDDEN }, () =>
        Array.from({ length: INPUTS }, () => (this.#uniform() - .5) * 2)),
      bias: Array.from({ length: HIDDEN }, () => this.#uniform() - .5), heads: [], observations: 0 };
      this.#networks.set(id, network);
    }
    if (network.encoding !== encoding) throw new Error('experience-readout-semantic-collision');
    return network;
  }
  #field(network: Pick<Network, 'inputs' | 'ranges' | 'weights' | 'bias' | 'encoding'>, state: State, learn = false): number[] {
    if (network.encoding) return continuousReadoutField(state);
    const field = Array(INPUTS).fill(0) as number[];
    for (const [name, value] of features(state)) {
      let site = network.inputs.indexOf(name);
      if (site < 0 && learn) {
        // The compact continuous circuit keeps its original receptors. New
        // sparse measurements still enter the contextual circuit in full.
        if (network.inputs.length >= INPUTS) continue;
        site = network.inputs.length; network.inputs.push(name);
        network.ranges.push([value, value]);
      }
      if (site >= 0) {
        field[site] = value;
        if (learn) { network.ranges[site]![0] = Math.min(network.ranges[site]![0], value);
          network.ranges[site]![1] = Math.max(network.ranges[site]![1], value); }
      }
    }
    const hidden = network.weights.map((row, i) => {
      const drive = row.reduce((sum, v, j) => sum + v * field[j]!, network.bias[i]!);
      return Math.tanh(drive);
    });
    return [1, ...field, ...hidden];
  }
  #read(head: PredictionHead, field: number[], bounds?: readonly NumericRange[]) {
    const category = !head.numeric && head.categoryCorrect >= head.regressionCorrect - .02;
    const readout = category ? head.categoryReadout : head.readout;
    const scores = readout.map(row => row.reduce((sum, w, i) => sum + w * field[i]!, 0));
    if (head.numeric) scores.push(...head.numericMeans);
    const ranked = scores.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value);
    const index = head.numeric ? [2, 3, 0, 1].sort((a, b) =>
      head.numericQuality[a]!.error - head.numericQuality[b]!.error)[0]! : ranked[0]!.i;
    const intervals = readout.map(row => row.reduce<[number, number]>((sum, w, i) => {
      const [a, b] = bounds?.[i] ?? [field[i]!, field[i]!];
      return [sum[0] + Math.min(w * a, w * b), sum[1] + Math.max(w * a, w * b)];
    }, [0, 0]));
    if (head.numeric) intervals.push(...head.numericMeans.map(value => [value, value] as [number, number]));
    const margin = head.numeric ? 1 : intervals[index]![0] - Math.max(0,
      ...intervals.filter((_, i) => i !== index).map(value => value[1]));
    const quality = head.numeric ? head.numericQuality[index]!.correct : category ? head.categoryCorrect : head.regressionCorrect;
    const uncertainty = intervals[index]![1] - intervals[index]![0];
    return { value: head.numeric ? scores[index]! : head.values[index]!, absolute: head.numeric && index % 2 === 1, margin,
      range: head.numeric ? intervals[index]! as NumericRange : undefined,
      supported: head.observations >= 8 && quality >= .8
        && (head.numeric ? uncertainty <= .05 : margin > 1e-8) };
  }
  #learnMotion(network: Network, normal: readonly number[], displacement: number, sensorResidual: number,
    windowId: string, rows: ContextualWindowRow[], state: State, prior?: Pick<MotionEstimate, 'mean'>): boolean {
    const estimate = network.motion ??= { mean: [0, 0, 0], covariance: [[1000, 0, 0], [0, 1000, 0], [0, 0, 1000]],
      information: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], variance: 0, observations: 0, correct: 0, error: 0 };
    // n·motion = measured plane displacement. Different views add independent
    // constraints; one plane never supplies its unobservable tangent motion.
    const error = displacement - normal.reduce((sum, v, i) => sum + v * estimate.mean[i]!, 0);
    const residual = prior ? Math.max(sensorResidual,
      Math.abs(displacement - normal.reduce((sum, v, i) => sum + v * prior.mean[i]!, 0))) : null;
    // A plane's two normal signs encode the same measured constraint.
    const sign = normal.find(v => Math.abs(v) > 1e-10)! < 0 ? -1 : 1;
    rows.push({ input: { ...state, ...Object.fromEntries(normal.map((v, i) => ['plane/normal/' + i, v * sign])) },
      targets: [['plane/motion', 0, displacement * sign]],
      ...(residual === null ? {} : { externalErrors: { 'plane/motion': Math.min(20, residual / tolerance(displacement)) } }) });
    if (residual !== null) {
      const calibration = estimate.calibration ??= [], existing = calibration.find(row => row.windowId === windowId);
      if (existing) { existing.error = Math.max(existing.error, residual / tolerance(displacement));
        existing.residual = Math.max(existing.residual, residual); }
      else calibration.push({ windowId, error: residual / tolerance(displacement), residual });
      if (calibration.length > 32) calibration.shift();
    }
    const correct = residual !== null && residual <= tolerance(displacement);
    estimate.correct += .15 * (Number(correct) - estimate.correct);
    estimate.error += .15 * (Math.abs(error) - estimate.error); estimate.observations++;
    estimate.variance += .15 * (Math.max(error * error, sensorResidual * sensorResidual) - estimate.variance);
    estimate.information = estimate.information.map((row, i) => row.map((v, j) => .995 * v + normal[i]! * normal[j]!));
    const product = estimate.covariance.map(row => row.reduce((sum, v, i) => sum + v * normal[i]!, 0));
    const denominator = .995 + product.reduce((sum, v, i) => sum + v * normal[i]!, 0);
    estimate.mean = estimate.mean.map((v, i) => v + product[i]! / denominator * error);
    estimate.covariance = updatedCovariance(estimate.covariance, product, denominator);
    return correct;
  }
  #learn(network: Network, state: State, targets: [string, PublicValue, PublicValue][],
    rows: ContextualWindowRow[], prior?: WindowReadout): boolean[] {
    const priorField = prior ? this.#field(prior, state) : undefined;
    const field = this.#field(network, state, true), results: boolean[] = []; network.observations++;
    const externalErrors: Record<string, number> = {};
    for (const [name, before, after] of targets) {
      const numeric = typeof before === 'number' && typeof after === 'number';
      const target = numeric ? after - before : after;
      // Decode with the window-start receptors and category vocabulary. A new
      // after-label cannot become a candidate before its forecast is scored.
      const priorHead = prior?.heads.find(value => value.key === name);
      const priorPrediction = priorHead && priorHead.numeric === numeric ? this.#read(priorHead, priorField!) : null;
      let head = network.heads.find(value => value.key === name);
      if (!head) {
        head = { key: name, numeric, values: numeric ? [] : [after],
          readout: Array.from({ length: numeric ? 2 : 1 }, () => Array(SIZE).fill(0)),
          covariance: Array.from({ length: SIZE }, (_, i) => Array.from({ length: SIZE }, (_, j) => i !== j ? 0
            : i === 0 ? 10000 : i <= INPUTS ? 100 : 1)),
          observations: 0, correct: 0, error: 0, integral: numeric,
          numericQuality: numeric ? Array.from({ length: 4 }, () => ({ correct: 0, error: 0 })) : [],
          numericMeans: numeric ? [0, 0] : [],
          categoryReadout: numeric ? [] : [Array(SIZE).fill(0)], categoryCorrect: 0, regressionCorrect: 0 };
        network.heads.push(head);
      }
      if (head.numeric !== numeric) continue;
      if (!numeric && !head.values.some(value => Object.is(value, after))) {
        head.values.push(after); head.readout.push(Array(SIZE).fill(0));
        head.categoryReadout.push(Array(SIZE).fill(0));
      }
      const numericResult = priorPrediction ? Number(priorPrediction.value) + (priorPrediction.absolute ? 0 : Number(before)) : Number(before);
      const error = numeric ? Math.abs(numericResult - Number(after)) : Number(!priorPrediction || priorPrediction.value !== after);
      const decodedError = numeric && priorHead?.integral && Number.isInteger(before) && Number.isInteger(after)
        ? Math.abs(Math.round(numericResult) - Number(after)) : error;
      const correct = priorPrediction !== null && decodedError <= (numeric ? tolerance(Number(target)) : 0);
      if (priorPrediction) externalErrors[name] = numeric ? Math.min(20, decodedError / tolerance(Number(target)))
        : correct ? 0 : 2;
      results.push(correct); head.observations++;
      head.correct += .15 * (Number(correct) - head.correct); head.error += .15 * (error - head.error);
      head.integral &&= Number.isInteger(before) && Number.isInteger(after);
      if (numeric) [...head.readout.map(row => row.reduce((sum, w, i) => sum + w * field[i]!, 0)), ...head.numericMeans]
        .forEach((prediction, index) => {
        const value = prediction + (index % 2 === 0 ? Number(before) : 0);
        const error = Math.abs((head.integral ? Math.round(value) : value) - Number(after));
        const quality = head.numericQuality[index]!;
        quality.error += .15 * (error - quality.error);
        quality.correct += .15 * (Number(head.observations > 1 && error <= tolerance(Number(target))) - quality.correct);
      });
      if (numeric) [Number(target), Number(after)].forEach((value, i) => {
        head.numericMeans[i]! += (value - head.numericMeans[i]!) / Math.min(32, head.observations);
      });
      if (!numeric) {
        // Categories require a decision boundary, not a least-squares fit of
        // arbitrary one-hot magnitudes. Prefer direct receptors; nonlinear
        // populations can correct responses that are not linearly separable.
        const scores = head.categoryReadout.map(row => row.reduce((sum, w, i) => sum + w * field[i]!, 0));
        const desired = head.values.findIndex(value => Object.is(value, after));
        const classify = (rows: number[][]) => rows.map((row, i) => ({ i,
          score: row.reduce((sum, w, j) => sum + w * field[j]!, 0) })).sort((a, b) => b.score - a.score)[0]!.i;
        head.categoryCorrect += .15 * (Number(head.observations > 1 && classify(head.categoryReadout) === desired) - head.categoryCorrect);
        head.regressionCorrect += .15 * (Number(head.observations > 1 && classify(head.readout) === desired) - head.regressionCorrect);
        const wrong = scores.map((score, i) => ({ score, i })).filter(value => value.i !== desired)
          .sort((a, b) => b.score - a.score)[0];
        const loss = Math.max(0, 1 - scores[desired]! + (wrong?.score ?? 0));
        const factors = field.map((_, i) => i <= INPUTS ? 1 : .1);
        const norm = field.reduce((sum, value, i) => sum + value * value * factors[i]!, 0);
        const gain = loss / ((wrong ? 2 : 1) * norm + 1e-9);
        for (let i = 0; i < SIZE; i++) {
          head.categoryReadout[desired]![i]! += gain * field[i]! * factors[i]!;
          if (wrong) head.categoryReadout[wrong.i]![i]! -= gain * field[i]! * factors[i]!;
        }
      }
      const px = head.covariance.map(row => row.reduce((sum, value, i) => sum + value * field[i]!, 0));
      const denominator = .995 + field.reduce((sum, value, i) => sum + value * px[i]!, 0);
      if (!Number.isFinite(denominator) || denominator <= 0) throw new Error('unstable-experience-conductance');
      const gain = px.map(value => value / denominator);
      head.readout.forEach((row, index) => {
        const desired = numeric ? Number(index === 0 ? target : after) : Number(Object.is(head.values[index], after));
        const residual = desired - row.reduce((sum, w, i) => sum + w * field[i]!, 0);
        for (let i = 0; i < SIZE; i++) row[i]! += gain[i]! * residual;
      });
      head.covariance = updatedCovariance(head.covariance, px, denominator);
    }
    rows.push({ input: state, targets, externalErrors });
    return results;
  }
  #observeContinuous(event: RealEvent, digest: string, trace: ExperienceWindowLiveTraceV1, intervals: SourceExperienceIntervals) {
    if (intervals.clockStatus !== 'verified') {
      this.#continuous = true;
      this.#ledger.commit(event.id, digest); this.#untrainedLiveWindows++;
      return { learned: false, correctBeforeUpdate: null, writes: this.#writes, measuredChannels: 0, maskedObjects: 0,
        skipped: 'no-verified-live-clock' as const };
    }
    const first = event.frames[0]!, last = event.frames.at(-1)!;
    const endpointPhysicalTicks = last.physicalClock!.physicsTick - first.physicalClock!.physicsTick;
    if (endpointPhysicalTicks === 0 && event.provenance === 'observed-passive') {
      // A terminal sample may carry a real change with no physics interval.
      // z already assimilated that measurement; passive dynamics get no row.
      this.#continuous = true; this.#ledger.commit(event.id, digest); this.#untrainedLiveWindows++;
      return { learned: false, correctBeforeUpdate: null, writes: this.#writes, measuredChannels: 0, maskedObjects: 0,
        skipped: 'no-positive-physical-interval' as const,
        continuous: { semantics: CONTINUOUS_READOUT, endpointIndependentWindows: 0, intervalRows: 0,
          assimilationRows: intervals.transitions.filter(row => row.kind === 'assimilation-only').length,
          untrainableRows: 0, newIndependentIntervalWindows: 0, intervalRolloutSupported: false as const,
          endpointPhysicalTicks, zeroTimeEndpoint: true } };
    }
    if (typeof event.attentionId === 'string' && !first.objects.some(object => object.id === event.attentionId))
      throw new Error('attention-subject-not-observed-before-action');
    type Job = { id: string; input: State; targets: [string, PublicValue, PublicValue][]; endpoint: boolean };
    const jobs: Job[] = [];
    let maskedObjects = 0, intervalRows = 0;
    const addPair = (before: Observation, after: Observation, state: LiveStateV1, motor: string,
      endpoint: boolean, extra: State = {}) => {
      const targets = measuredPairTargets(before, after, endpoint ? event.attentionId : undefined);
      maskedObjects += targets.maskedObjects;
      const beforeInputs = inputState(before), afterInputs = inputState(after);
      for (const [name, value] of Object.entries(beforeInputs)) if (name.startsWith('view/') && afterInputs[name] !== undefined)
        targets.self.push([`context/${name}`, value, afterInputs[name]!]);
      if (endpoint) targets.self.push(['return/physicalTicks', 0,
        after.physicalClock!.physicsTick - before.physicalClock!.physicsTick]);
      jobs.push({ id: `${motor}/self`, input: continuousReadoutInput(state, beforeInputs, extra), targets: targets.self, endpoint });
      for (const row of targets.objects) jobs.push({ id: `${motor}/object`,
        input: continuousReadoutInput(state, inputState(before, row.object), extra), targets: row.targets, endpoint });
    };
    // The original requested motor is knowable at prediction time. Actual
    // interruption/settling duration appears only as an after-label.
    // Receipt-free discrete actions can change an observed endpoint at zero
    // physics dt (for example a measured camera update). Retain that endpoint
    // measurement; it certifies no physical interval and uses no future-dt key.
    addPair(first, last, trace.states[0]!, continuousEndpointIdentity(event.cue), true);
    for (const row of intervals.transitions) if (row.kind === 'dynamics') {
      intervalRows++;
      addPair(event.frames[row.beforeFrameIndex]!, event.frames[row.afterFrameIndex]!, trace.states[row.beforeFrameIndex]!,
        continuousIntervalIdentity(row.motor), false, { 'interval/dt': row.deltaSeconds, 'interval/motor': row.motor.state });
    }
    // Prepare every affected readout BEFORE fitting any row. An interval is
    // teacher-forced by a real earlier z; it is not another independent window
    // and cannot calibrate the direct endpoint circuit or a future rollout.
    const prior = new Map([...new Set(jobs.map(job => job.id))].map(id => [id, windowReadout(this.#networks.get(id))]));
    const rows = new Map<string, ContextualWindowRow[]>(), endpointCorrect: boolean[] = [];
    this.#continuous = true;
    let measuredChannels = 0;
    for (const job of jobs) {
      const group = rows.get(job.id) ?? []; rows.set(job.id, group);
      const correct = this.#learn(this.#network(job.id, EXPERIENCE_LIVE_LAW), job.input, job.targets, group, prior.get(job.id));
      measuredChannels += correct.length; if (job.endpoint) endpointCorrect.push(...correct);
    }
    for (const [id, group] of rows) this.#contexts.observeWindow(id, event.id, group);
    this.#ledger.commit(event.id, digest); this.#writes++;
    this.#attentionPredictions = new WeakMap(); this.#attentionBase = new WeakMap();
    return { learned: true, correctBeforeUpdate: endpointCorrect.length ? endpointCorrect.every(Boolean) : null,
      writes: this.#writes, measuredChannels, maskedObjects,
      continuous: { semantics: CONTINUOUS_READOUT, endpointIndependentWindows: 1, intervalRows,
        assimilationRows: intervals.transitions.filter(row => row.kind === 'assimilation-only').length,
        untrainableRows: intervals.transitions.filter(row => row.kind === 'untrainable').length,
        newIndependentIntervalWindows: 0, intervalRolloutSupported: false as const,
        endpointPhysicalTicks, zeroTimeEndpoint: endpointPhysicalTicks === 0 } };
  }
  observe(event: RealEvent, options: { liveTrace?: ExperienceWindowLiveTraceV1 } = {}): {
    learned: boolean; correctBeforeUpdate: boolean | null; writes: number; measuredChannels: number; maskedObjects: number;
    skipped?: 'duplicate' | 'retired-or-collision' | 'no-measured-motor-interval' | 'no-verified-live-clock' | 'no-positive-physical-interval';
    continuous?: { semantics: typeof CONTINUOUS_READOUT; endpointIndependentWindows: number; intervalRows: number;
      assimilationRows: number; untrainableRows: number; newIndependentIntervalWindows: number; intervalRolloutSupported: false;
      endpointPhysicalTicks?: number; zeroTimeEndpoint?: boolean } } {
    validateEvent(event);
    for (const frame of event.frames) {
      if (frame.predictionSupport !== undefined || frame.predictionContext !== undefined || frame.predictionBounds !== undefined)
        throw new Error('imagined-observation-in-real-window');
      if (frame.sensation && Object.hasOwn(frame.self.properties, 'oxygen')) {
        const owned = frame.bodySensation?.oxygen;
        if (frame.bodySensation?.version !== 'OwnedBodySignals1' || !owned || !Number.isFinite(owned.rawAir)
          || owned.value !== Math.max(0, Math.round(owned.rawAir / 15)) || owned.value !== frame.self.properties.oxygen)
          throw new Error('unowned-native-body-channel-requires-original-event-reencoding');
      }
      const values = [...frame.self.position, frame.self.yaw, frame.self.pitch, ...Object.values(frame.self.properties),
        ...frame.objects.flatMap(object => [...object.relativePosition, ...Object.values(object.properties)])];
      if (values.some(value => typeof value === 'number' ? !Number.isFinite(value)
        : value !== null && !['string', 'boolean'].includes(typeof value))) throw new Error('invalid-public-receptor-value');
      if (frame.perception && (frame.perception.version !== 'AttentivePerception8'
        || frame.perception.tracks.some(track => !Array.isArray(track.motionEvidence) || track.motionEvidence.length !== 3)))
        throw new Error('reprocess-obsolete-perception-from-original-sensation');
      if (frame.perception?.tracks.some(track => track.surface && (track.surface.normal.length !== 3
        || track.surface.point.length !== 3 || [...track.surface.normal, ...track.surface.point].some(v => !Number.isFinite(v))
        || Math.abs(Math.hypot(...track.surface.normal) - 1) > .01
        || !Number.isFinite(track.surface.residual ?? 0) || (track.surface.residual ?? 0) < 0))) throw new Error('invalid-measured-surface');
    }
    if (event.provenance === 'observed-passive' && (event.bodyResult !== null || event.cue.kind !== 'passive')
      || event.bodyResult && (event.bodyResult.startSequence !== event.frames[0]!.sequence
        || event.bodyResult.endSequence !== event.frames.at(-1)!.sequence)) throw new Error('experience-feedback-window-mismatch');
    const liveIntervals = options.liveTrace ? validateExperienceLiveTrace(event, options.liveTrace) : undefined;
    const digest = actualEventDigest(event), previous = this.#ledger.check(event.id, digest);
    if (previous !== 'new') {
      return { learned: false, correctBeforeUpdate: null, writes: this.#writes, measuredChannels: 0, maskedObjects: 0, skipped: previous };
    }
    // This zero-exposure refusal applies BEFORE either semantic path. The
    // terminal frame still belongs to actual z and the source ledger, but a
    // requested hold with no measured physical hold cannot train motor theta.
    const measuredCue = measuredMotorCueV1(event);
    if (measuredCue === null) {
      if (options.liveTrace) this.#continuous = true;
      this.#ledger.commit(event.id, digest);
      this.#untrainedMotorWindows++;
      return { learned: false, correctBeforeUpdate: null, writes: this.#writes,
        measuredChannels: 0, maskedObjects: 0, skipped: 'no-measured-motor-interval',
        ...(liveIntervals ? { continuous: { semantics: CONTINUOUS_READOUT, endpointIndependentWindows: 0, intervalRows: 0,
          assimilationRows: liveIntervals.transitions.filter(row => row.kind === 'assimilation-only').length,
          untrainableRows: liveIntervals.transitions.filter(row => row.kind === 'untrainable').length,
          newIndependentIntervalWindows: 0, intervalRolloutSupported: false as const } } : {}) };
    }
    // Continuous endpoints use the knowable request, never the hindsight
    // measured duration. Receipt-free legacy windows keep their old semantics.
    if (options.liveTrace) return this.#observeContinuous(event, digest, options.liveTrace, liveIntervals!);
    const first = event.frames[0]!, last = event.frames.at(-1)!, motor = motorIdentity(measuredCue);
    if (typeof event.attentionId === 'string' && !first.objects.some(object => object.id === event.attentionId))
      throw new Error('attention-subject-not-observed-before-action');
    this.#attentionPredictions = new WeakMap(); this.#attentionBase = new WeakMap();
    const focus = new Set([event.attentionId !== undefined ? event.attentionId : first.perception?.attendedId, first.targetId,
      ...(!first.perception ? first.objects.map(object => object.id) : [])]);
    const displacement = worldToBody(last.self.position.map((v, i) => v - first.self.position[i]!), first.self.yaw);
    const targets: [string, PublicValue, PublicValue][] = displacement.map((v, i) => [`motion/${i}`, 0, v]);
    targets.push(['yaw', 0, Math.atan2(Math.sin(last.self.yaw - first.self.yaw), Math.cos(last.self.yaw - first.self.yaw))],
      ['pitch', first.self.pitch, last.self.pitch]);
    for (const [name, before] of Object.entries(first.self.properties)) {
      const after = last.self.properties[name]; if (after !== undefined) targets.push([`property/${name}`, before, after]);
    }
    const beforeInputs = inputState(first), afterInputs = inputState(last);
    for (const [name, before] of Object.entries(beforeInputs))
      if (name.startsWith('view/') && afterInputs[name] !== undefined) targets.push([`context/${name}`, before, afterInputs[name]!]);
    // A later visible surface need not be the same tracked object. Learn its
    // actual retinal measurement separately from object correspondence; a
    // disappearance neither proves destruction nor prevents a new appearance.
    if (last.perception) {
      const gaze = last.objects.find(object => object.id === last.targetId);
      targets.push(['appearance/visible', false, Boolean(gaze)]);
      if (gaze) {
        targets.push(['appearance/type', null, gaze.type]);
        worldToBody(gaze.relativePosition, last.self.yaw).forEach((value, axis) =>
          targets.push([`appearance/position/${axis}`, 0, value]));
        for (const [key, value] of Object.entries(gaze.properties)) if (!['confidence', 'ambiguity'].includes(key))
          targets.push([`appearance/property/${key}`, typeof value === 'number' ? 0 : null, value]);
      }
    }
    // Only the two affected motor circuits are copied. All rows still fit the
    // live networks, but none can calibrate against another row in this window.
    const priorSelf = windowReadout(this.#networks.get(`${motor}/self`));
    const priorObject = windowReadout(this.#networks.get(`${motor}/object`));
    const selfRows: ContextualWindowRow[] = [], objectRows: ContextualWindowRow[] = [], planeRows: ContextualWindowRow[] = [];
    const correct = this.#learn(this.#network(`${motor}/self`), inputState(first), targets, selfRows, priorSelf);
    let maskedObjects = 0;
    for (const object of first.objects.filter(object => focus.has(object.id))) {
      const after = last.objects.find(value => value.id === object.id);
      if (!after) {
        // Missing after an action is an observed failure to acquire a later
        // measurement. It is not evidence of destruction or zero motion.
        correct.push(...this.#learn(this.#network(`${motor}/object`), inputState(first, object),
          [['measurement', true, false]], objectRows, priorObject));
        maskedObjects++; continue;
      }
      const movement = worldToBody(after.relativePosition.map((v, i) => v - object.relativePosition[i]!
        + last.self.position[i]! - first.self.position[i]!), first.self.yaw);
      const beforeTrack = first.perception?.tracks.find(track => track.id === object.id);
      const afterTrack = last.perception?.tracks.find(track => track.id === object.id);
      const measured: [string, PublicValue, PublicValue][] = movement.flatMap((v, i) =>
        (!beforeTrack || beforeTrack.motionEvidence[i]) && (!afterTrack || afterTrack.motionEvidence[i])
          && (!beforeTrack || !afterTrack || beforeTrack.anchorEpoch === afterTrack.anchorEpoch)
          ? [[`motion/${i}`, 0, v] as [string, PublicValue, PublicValue]] : []);
      measured.push(['gaze', object.id === first.targetId, after.id === last.targetId]);
      measured.push(['measurement', true, !beforeTrack || !afterTrack || beforeTrack.anchorEpoch === afterTrack.anchorEpoch]);
      for (const [name, before] of Object.entries(object.properties)) {
        if (['confidence', 'ambiguity'].includes(name)) continue;
        if (after.properties[name] !== undefined) measured.push([`property/${name}`, before, after.properties[name]!]);
      }
      correct.push(...this.#learn(this.#network(`${motor}/object`), inputState(first, object), measured, objectRows, priorObject));
      const objectNetwork = this.#network(`${motor}/object`), plane = beforeTrack?.surface, nextPlane = afterTrack?.surface;
      if (plane && nextPlane && beforeTrack!.anchorEpoch === afterTrack!.anchorEpoch
        && Math.abs(plane.normal.reduce((sum, v, i) => sum + v * nextPlane.normal[i]!, 0)) > .999) {
        const delta = nextPlane.point.map((v, i) => v - plane.point[i]! + last.self.position[i]! - first.self.position[i]!);
        correct.push(this.#learnMotion(objectNetwork, worldToBody(plane.normal, first.self.yaw),
          plane.normal.reduce((sum, v, i) => sum + v * delta[i]!, 0), (plane.residual ?? 0) + (nextPlane.residual ?? 0),
          event.id, planeRows, inputState(first, object), priorObject?.motion));
      }
    }
    this.#contexts.observeWindow(`${motor}/self`, event.id, selfRows);
    if (objectRows.length) this.#contexts.observeWindow(`${motor}/object`, event.id, objectRows);
    if (planeRows.length) this.#contexts.observeWindow(`${motor}/plane`, event.id, planeRows);
    this.#ledger.commit(event.id, digest); this.#writes++;
    return { learned: true, correctBeforeUpdate: correct.length ? correct.every(Boolean) : null,
      writes: this.#writes, measuredChannels: correct.length, maskedObjects };
  }
  /** Independent audit/readout of one known interval from a real starting z.
   * No future real state is supplied and no rollout/return support is minted. */
  readInterval(observation: Observation, options: { state: LiveStateV1; motor: IntervalMotor;
    deltaSeconds: number }): ExperienceIntervalReadout {
    validateLivePredictionState(options.state, observation);
    if (options.state.origin !== 'real' || !Number.isFinite(options.deltaSeconds)
      || options.deltaSeconds <= 0 || options.deltaSeconds > 100) throw new Error('interval-readout-requires-real-start-and-bounded-duration');
    const motor = options.motor;
    if (!motor || !['held', 'off'].includes(motor.state) || motor.state === 'held'
      && (motor.basis !== 'measured-motor-receipt' || ['ticks', 'holdTicks'].some(key => Object.hasOwn(motor.signal.parameters, key))))
      throw new Error('interval-readout-requires-duration-free-motor');
    const namespace = continuousIntervalIdentity(motor), outputs: ExperienceIntervalReadout['outputs'][number][] = [];
    const read = (subject: string, object?: PublicObject) => {
      const id = `${namespace}/${object ? 'object' : 'self'}`, network = this.#networks.get(id); if (!network) return;
      const input = continuousReadoutInput(options.state, inputState(observation, object),
        { 'interval/dt': options.deltaSeconds, 'interval/motor': motor.state });
      const field = this.#field(network, input);
      for (const head of network.heads) {
        const local = this.#contexts.read(id, head.key, input), global = this.#read(head, field);
        const value = local?.supported ? { value: local.value, absolute: local.absolute,
          range: local.bounds?.[local.absolute ? 'absolute' : 'delta'], supported: true } : global;
        if (!local?.supported) value.supported &&= local?.externalSupported === true;
        if (!local || local.externalCalibrated >= 8 && local.externalAccuracy < .8 && !local.supported) value.supported = false;
        if (value.range && !local?.supported && local?.externalErrorRadius != null)
          value.range = [value.range[0] - local.externalErrorRadius, value.range[1] + local.externalErrorRadius];
        if (value.range && local?.bounds) value.range = hull([value.range, local.bounds[value.absolute ? 'absolute' : 'delta']]);
        if (this.#contexts.counterexample(id, head.key, input, value.value, value.absolute)) value.supported = false;
        outputs.push({ field: `${subject}/${head.key}`, value: value.value, absolute: value.absolute,
          range: value.range ?? null, supported: value.supported, independentCalibrationWindows: local?.externalCalibrated ?? 0 });
      }
    };
    read('self'); for (const object of observation.objects) read(`object:${object.id}`, object);
    return structuredClone({ semantics: 'teacher-forced-one-interval-v1', deltaSeconds: options.deltaSeconds,
      wholeWindowSupported: false, thetaWrites: 0, outputs });
  }
  predict(cue: ActionCue | null, observation: Observation,
    options: { probe?: boolean; requestedFields?: readonly string[]; state?: LiveStateV1 } = {}): ExperiencePrediction {
    const unknown = (reason: string): ExperiencePrediction => ({ observation: null, accepted: false, reason,
      activationMargin: 0, prequentialAccuracy: 0, observedSamples: 0, settled: false, supportedFields: [] });
    if (!cue) return unknown('unobserved-action');
    if (options.state) validateLivePredictionState(options.state, observation);
    const motor = options.state ? continuousEndpointIdentity(cue) : motorIdentity(cue), network = this.#networks.get(`${motor}/self`);
    if (!network) return unknown('unobserved-action');
    const conditioned = (object?: PublicObject) => options.state
      ? continuousReadoutInput(options.state, inputState(observation, object)) : inputState(observation, object);
    const { sensation: _sensation, perception: _perception, hotbarSensation: _hotbar, bodySensation: _body,
      physicalClock: _physicalClock, motorSignal: _motorSignal, ...measured } = observation;
    const result = structuredClone(measured) as any, support: string[] = []; result.objects = [];
    const predictedBounds: Record<string, NumericRange> = {}; result.predictionBounds = predictedBounds;
    const priorRange = (field: string, value: number) => observation.predictionBounds?.[field] ?? pointRange(value);
    const requested = (subject: string): string[] => (options.requestedFields ?? []).flatMap(field => {
      const slash = field.indexOf('/'), owner = field.slice(0, slash), observable = field.slice(slash + 1);
      if (subject === 'self' && owner === 'gaze') {
        if (observable.startsWith('properties.')) return ['appearance/property/' + observable.slice(11)];
        if (observable.startsWith('relative')) return [0, 1, 2].map(axis => 'appearance/position/' + axis);
        return ['appearance/' + observable];
      }
      if (owner !== subject) return [];
      if (observable.startsWith('properties.')) return ['property/' + observable.slice(11)];
      if (observable.startsWith('position.') || observable.startsWith('relative')) return ['motion/0', 'motion/1', 'motion/2'];
      return [observable === 'visible' ? 'measurement' : observable];
    });
    const read = (model: Network, state: State, id: string, stateBounds: NumericRanges, subject: string) => {
      if (options.probe) {
        const recalled = this.#contexts.recall(id, state, requested(subject));
        return new Map(model.heads.flatMap(head => {
          const target = recalled?.targets[head.key]; if (!target) return [];
          const [before, after] = target, numeric = typeof before === 'number' && typeof after === 'number';
          if (head.key.startsWith('appearance/')) {
            // A recalled after-image is not an action effect. Transfer the
            // measured change from that SAME row's before-image, rather than
            // replacing today's gaze by a different remembered scene even
            // when the remembered interaction changed nothing.
            const rememberedVisible = Object.hasOwn(recalled!.input, 'gaze/relative/0');
            const currentKnown = !observation.predictionSupport || observation.predictionSupport.includes('targetId');
            const currentVisible = Object.hasOwn(state, 'gaze/relative/0');
            if (head.key === 'appearance/visible') {
              if (!currentKnown) return [];
              const value = after === rememberedVisible ? currentVisible : after;
              return [[head.key, { value, absolute: true, range: undefined,
                margin: 0, supported: false, refuted: false, head }] as const];
            }
            const anchor = head.key.startsWith('appearance/position/') ? 'gaze/relative/' + head.key.slice('appearance/position/'.length)
              : head.key.startsWith('appearance/property/') ? 'gaze/property/' + head.key.slice('appearance/property/'.length) : null;
            if (anchor) {
              const remembered = recalled!.input[anchor], current = state[anchor];
              const acquiredFromEmpty = currentKnown && !currentVisible && !rememberedVisible;
              if (typeof after === 'number') {
                const value = typeof remembered === 'number' && typeof current === 'number' ? current + after - remembered
                  : acquiredFromEmpty ? after : undefined;
                if (value === undefined) return [];
                return [[head.key, { value, absolute: true, range: pointRange(value),
                  margin: 0, supported: false, refuted: false, head }] as const];
              }
              if (Object.is(remembered, after) && current === undefined && !acquiredFromEmpty) return [];
              const value = Object.is(remembered, after) && current !== undefined ? current : after;
              return [[head.key, { value, absolute: true, range: undefined,
                margin: 0, supported: false, refuted: false, head }] as const];
            }
          }
          return [[head.key, { value: numeric ? after - before : after, absolute: !numeric,
            range: numeric ? pointRange(after - before) : undefined,
            margin: 0, supported: false, refuted: false, head }] as const];
        }));
      }
      const field = this.#field(model, state);
      const present = new Set(features(state).map(([key]) => key));
      const knownInput = (key: string) => {
        if (present.has(key)) return true;
        if (!key.startsWith('[')) return false;
        const [base] = JSON.parse(key) as [string, PublicValue];
        return Object.hasOwn(state, base) && present.has(JSON.stringify([base, state[base]]))
          && model.inputs.includes(JSON.stringify([base, state[base]]));
      };
      // Propagate ranges for missing measurements. A head can remain usable
      // only when every value in those ranges gives the same narrow result.
      const inputBounds: NumericRange[] = Array.from({ length: INPUTS }, (_, i) => {
        const range = stateBounds[model.inputs[i]!];
        return range && typeof state[model.inputs[i]!] === 'number' ? scaleRange(range, .25)
          : i >= model.inputs.length || knownInput(model.inputs[i]!) ? pointRange(field[i + 1]!) : model.ranges[i] ?? [-4, 4];
      });
      const hiddenBounds = model.weights.map((row, index): [number, number] => {
        const limits = row.reduce<[number, number]>((sum, w, i) => [sum[0] + Math.min(w * inputBounds[i]![0], w * inputBounds[i]![1]),
          sum[1] + Math.max(w * inputBounds[i]![0], w * inputBounds[i]![1])], [model.bias[index]!, model.bias[index]!]);
        return [Math.tanh(limits[0]), Math.tanh(limits[1])];
      });
      // The new field is already a bounded 32+16 state. Imagined uncertain
      // channels were explicitly masked by its private branch; that masking
      // alone does NOT certify multi-step state or dynamics below.
      const bounds: NumericRange[] = model.encoding ? field.map(pointRange) : [[1, 1], ...inputBounds, ...hiddenBounds];
      for (let i = 0; i < SIZE; i++) field[i] = (bounds[i]![0] + bounds[i]![1]) / 2;
      return new Map(model.heads.map(head => {
        const conditional = this.#contexts.read(id, head.key, state, stateBounds);
        const locallyRefuted = conditional && conditional.externalCalibrated >= 8 && conditional.externalAccuracy < .8;
        const value = conditional?.supported ? { value: conditional.value, absolute: conditional.absolute,
          range: conditional.bounds?.[conditional.absolute ? 'absolute' : 'delta'],
          margin: 1, supported: true } : this.#read(head, field, bounds);
        if (!conditional?.supported) {
          // A global score cannot certify a sparse, locally unreliable or
          // out-of-range response. Keep regression available where actual
          // pre-update predictions have been calibrated in this region.
          value.supported &&= conditional?.externalSupported === true;
          if (value.range && conditional?.externalErrorRadius != null) {
            const residual = conditional.externalErrorRadius;
            value.range = [value.range[0] - residual, value.range[1] + residual];
          }
        }
        // A calibrated mean does not erase observed no-effect outcomes. Use
        // the retained conditional envelope even for a regression readout.
        if (value.range && conditional?.bounds) value.range = hull([value.range,
          conditional.bounds[value.absolute ? 'absolute' : 'delta']]);
        // Missing or conflicting context cannot be overruled by a globally
        // calibrated constant readout. Its small average error says nothing
        // about which incompatible response is possible here.
        if (!conditional) value.supported = false;
        // First slice has direct real-start endpoint calibration only. No
        // recurrent uncertainty/timed rollout certificate exists yet.
        if (options.state?.origin === 'imagined') value.supported = false;
        if (locallyRefuted && !conditional.supported) return [head.key, { ...value,
          supported: false, refuted: true, head }];
        const contrary = this.#contexts.counterexample(id, head.key, state, value.value, value.absolute);
        return [head.key, { ...value, ...(contrary ? { supported: false, refuted: true } : {}), head }];
      }));
    };
    const self = read(network, conditioned(), `${motor}/self`, experienceInputBounds(observation), 'self');
    const usable = (value: { supported: boolean; refuted?: boolean; head: Head } | undefined) =>
      value && !value.refuted && (value.supported || options.probe && value.head.observations >= 1);
    const known = (key: string) => !observation.predictionSupport || observation.predictionSupport.includes(key);
    result.predictionContext = {};
    for (const [name, value] of self) if (name.startsWith('context/') && usable(value)) {
      const channel = name.slice(8), before = inputState(observation)[channel];
      if (typeof before === 'number' || value.absolute) {
        result.predictionContext[channel] = Number(value.value) + (value.absolute ? 0 : Number(before));
        if (value.range) predictedBounds[name] = addRanges(value.range,
          value.absolute ? [0, 0] : priorRange(name, Number(before)));
      }
    }
    const displacement = [0, 1, 2].map(i => self.get(`motion/${i}`));
    const yawRange = priorRange('self/yaw', observation.self.yaw);
    const displacementRanges = rotateRanges(displacement.map(value => usable(value) ? value!.range ?? null : null), yawRange);
    const axes = [0, 1, 2].map(axis => bodyToWorld([0, 1, 2].map(i => Number(i === axis)), observation.self.yaw));
    const projected = (components: readonly (number | null)[], axis: number): number | null =>
      !known('self/yaw') || components.some((value, i) => value === null && Math.abs(axes[i]![axis]!) > 1e-9)
        ? null : components.reduce<number>((sum, value, i) => sum + (value ?? 0) * axes[i]![axis]!, 0);
    // A world axis depends only on the body components with nonzero geometric
    // projection. Uncertainty orthogonal to it cannot erase measured evidence.
    for (let axis = 0; axis < 3; axis++) {
      const delta = projected(displacement.map(value => usable(value) ? Number(value!.value) : null), axis);
      if (delta === null || !displacementRanges[axis] || !known(`self/position.${axis}`)) continue;
      result.self.position[axis] = observation.self.position[axis]! + delta;
      predictedBounds[`self/position.${axis}`] = addRanges(priorRange(`self/position.${axis}`, observation.self.position[axis]!), displacementRanges[axis]!);
      support.push(`self/position.${axis}`);
    }
    for (const name of ['yaw', 'pitch']) {
      const value = self.get(name); if (!value || !usable(value) || !known(`self/${name}`)) continue;
      result.self[name] = (value.absolute && name === 'pitch' ? 0 : observation.self[name as 'yaw' | 'pitch'])
        + Number(value.value); support.push(`self/${name}`);
      if (value.range) predictedBounds[`self/${name}`] = addRanges(value.range,
        value.absolute && name === 'pitch' ? [0, 0] : priorRange(`self/${name}`, observation.self[name as 'yaw' | 'pitch']));
    }
    const apply = (values: ReturnType<typeof read>, before: PublicObject['properties'], output: any, prefix: string) => {
      for (const [name, result] of values) {
        if (!name.startsWith('property/') || !usable(result)) continue;
        const property = name.slice(9); if (!Object.hasOwn(before, property)
          || result.head.numeric && !result.absolute && !known(`${prefix}/properties.${property}`)) continue;
        let value = result.head.numeric ? (result.absolute ? 0 : Number(before[property])) + Number(result.value) : result.value;
        if (result.head.numeric && result.head.integral) value = Math.round(Number(value));
        output[property] = value; support.push(`${prefix}/properties.${property}`);
        if (result.range) {
          const range = addRanges(result.range, result.absolute ? [0, 0]
            : priorRange(`${prefix}/properties.${property}`, Number(before[property])));
          predictedBounds[`${prefix}/properties.${property}`] = result.head.integral ? [Math.round(range[0]), Math.round(range[1])] : range;
        }
      }
    };
    apply(self, observation.self.properties, result.self.properties, 'self');
    const objectNetwork = this.#networks.get(`${motor}/object`);
    const motionInformation = objectNetwork?.motion ? inverseInformation(objectNetwork.motion.information) : null;
    const gazeCandidates: string[] = []; let gazeMeasured = 0;
    if (objectNetwork) for (const object of observation.objects) {
      const values = read(objectNetwork, conditioned(object), `${motor}/object`, experienceInputBounds(observation, object), `object:${object.id}`);
      const measurement = values.get('measurement');
      if (usable(measurement) && measurement!.value === false) continue;
      const estimate = objectNetwork.motion;
      const fallbackRadii: (number | null)[] = [null, null, null];
      const motion = [0, 1, 2].map(i => {
        const value = values.get(`motion/${i}`);
        if (usable(value)) return Number(value!.value);
        if (value?.refuted) return null;
        // Coefficient covariance has units of inverse information, not blocks.
        // Convert it with measured pre-update/sensor variance. Include residual
        // outcome variation, and require measured rank (no regularizing prior).
        const calibration = estimate?.calibration ?? [];
        const domain = this.#contexts.read(`${motor}/plane`, 'plane/motion', { ...conditioned(object),
          ...Object.fromEntries([0, 1, 2].map(axis => ['plane/normal/' + axis, Number(axis === i)])) },
          experienceInputBounds(observation, object));
        const radius = estimate && motionInformation ? Math.max(domain?.externalErrorRadius ?? Infinity,
          4 * Math.sqrt(estimate.variance * (1 + motionInformation[i]![i]!))) : Infinity;
        if (estimate && motionInformation && calibration.length >= 8
          && calibration.filter(row => row.error <= 1).length / calibration.length >= .8
          && domain?.externalSupported === true
          && radius <= .05) { fallbackRadii[i] = radius; return estimate.mean[i]!; }
        return null;
      });
      const motionRanges = rotateRanges(motion.map((value, i) => {
        if (value === null) return null;
        const learned = values.get(`motion/${i}`);
        if (usable(learned) && learned!.range) return learned!.range;
        const radius = fallbackRadii[i]!;
        return [value - radius, value + radius] as NumericRange;
      }), yawRange);
      const predicted = { ...object, properties: { ...object.properties } };
      const relative = [...object.relativePosition];
      for (let axis = 0; axis < 3; axis++) {
        const delta = projected(motion, axis), field = `object:${object.id}/relativePosition.${axis}`;
        if (delta === null || !motionRanges[axis] || !support.includes(`self/position.${axis}`) || !known(field)) continue;
        relative[axis] = object.relativePosition[axis]! + delta - (result.self.position[axis] - observation.self.position[axis]!);
        predictedBounds[field] = addRanges(priorRange(field, object.relativePosition[axis]!),
          addRanges(motionRanges[axis]!, scaleRange(displacementRanges[axis]!, -1)));
        support.push(field);
      }
      predicted.relativePosition = relative as unknown as XYZ;
      if ([0, 1, 2].every(axis => support.includes(`object:${object.id}/relativePosition.${axis}`)))
        support.push(`object:${object.id}/relativeDistance`);
      result.objects.push(predicted);
      const gaze = values.get('gaze');
      if (usable(gaze)) gazeMeasured++;
      if (usable(gaze) && gaze!.value === true) gazeCandidates.push(object.id);
      apply(values, object.properties, predicted.properties, `object:${object.id}`);
    }
    // Without objects there is no binding to preserve. With visible objects,
    // crosshair identity is itself a measured, learned channel.
    if (gazeMeasured === observation.objects.length && gazeCandidates.length <= 1) {
      result.targetId = gazeCandidates[0] ?? null; support.push('targetId');
    } else result.targetId = null;
    const visible = self.get('appearance/visible'); let predictedGazeRole: string | undefined;
    if (usable(visible) && visible!.value === false) { result.targetId = null; support.push('targetId'); }
    else if (usable(visible) && visible!.value === true && support.includes('self/yaw')) {
      const position = [0, 1, 2].map(axis => self.get(`appearance/position/${axis}`)), type = self.get('appearance/type');
      if (position.every(usable) && usable(type) && typeof type!.value === 'string') {
        // This is an unbound future gaze role, never the ID of a real object
        // and never evidence that a hidden or previous object still exists.
        const id = result.targetId ?? 'next-visible-gaze', properties: Record<string, PublicValue> = {};
        predictedGazeRole = id;
        for (const [name, value] of self) if (name.startsWith('appearance/property/') && usable(value)) {
          const property = name.slice('appearance/property/'.length); properties[property] = value.value;
          if (value.range) predictedBounds[`object:${id}/properties.${property}`] = value.range;
          support.push(`object:${id}/properties.${property}`);
        }
        const gaze = { id, type: type!.value, relativePosition: bodyToWorld(position.map(value => Number(value!.value)), result.self.yaw), properties };
        rotateRanges(position.map(value => value!.range ?? null), predictedBounds['self/yaw'] ?? pointRange(result.self.yaw))
          .forEach((range, axis) => { if (range) predictedBounds[`object:${id}/relativePosition.${axis}`] = range; });
        result.objects = result.objects.filter((object: PublicObject) => object.id !== id); result.objects.push(gaze);
        result.targetId = id; support.push('targetId', `object:${id}/type`, `object:${id}/visible`, `object:${id}/relativeDistance`,
          ...[0, 1, 2].map(axis => `object:${id}/relativePosition.${axis}`));
      }
    }
    // Structural empty-gaze bookkeeping is not a learned rollout certificate.
    // Every field, including targetId, remains untrusted after an imagined z.
    const supported = options.state?.origin === 'imagined' && !options.probe ? [] : [...new Set(support)];
    for (const object of result.objects as PublicObject[]) {
      const ranges = [0, 1, 2].map(axis => predictedBounds[`object:${object.id}/relativePosition.${axis}`]);
      if (ranges.every(range => range)) predictedBounds[`object:${object.id}/relativeDistance`] = [
        Math.hypot(...ranges.map(range => range![0] <= 0 && range![1] >= 0 ? 0 : Math.min(Math.abs(range![0]), Math.abs(range![1])))),
        Math.hypot(...ranges.map(range => Math.max(Math.abs(range![0]), Math.abs(range![1]))))];
    }
    result.predictionSupport = options.probe ? [] : supported;
    const accepted = !options.probe && supported.length > 0;
    const returnTicks = self.get('return/physicalTicks');
    const timing: ExperiencePrediction['timing'] = options.state ? { semantics: 'window-endpoint-v1',
      returnPhysicalTicks: { range: returnTicks?.range ? [Math.max(0, returnTicks.range[0]), Math.max(0, returnTicks.range[1])] : null,
        supported: !options.probe && Boolean(returnTicks?.supported && !returnTicks.refuted) }, intervalRolloutSupported: false } : undefined;
    // Variable motor-on/off exposure cannot be reconstructed from an endpoint
    // duration estimate. Advance a private explicitly timing-unknown branch;
    // this is useful as an untrusted probe state, never a real clock or rollout
    // support. Preserve the original real z and all theta/calibration state.
    const state = options.state ? new ExperienceLiveBranch(options.state, { frameCapacity: 64, cueCapacity: 32,
      maximumChannels: 4096, maximumSnapshotBytes: 16_777_216 }).advance(result,
      { kind: 'unknown', reason: 'branch-unknown' }, { state: 'unknown', provenance: 'unknown', cue: null }) : undefined;
    return { observation: result, accepted, reason: options.probe ? 'exploratory-hypothesis'
      : accepted ? null : 'insufficient-observed-predictive-support',
      activationMargin: accepted ? 1 : 0, prequentialAccuracy: network.heads.reduce((sum, head) => sum + head.correct, 0) / Math.max(1, network.heads.length),
      observedSamples: network.observations, settled: true, supportedFields: options.probe ? [] : supported,
      ...(predictedGazeRole ? { predictedGazeRole } : {}),
      ...(state ? { state, timing } : {}),
      ...(options.probe ? { hypothesizedFields: supported } : {}) };
  }
  explorationDrive(cue: ActionCue, observation: Observation, attentionId = observation.perception?.attendedId, state?: LiveStateV1): number {
    if (state) {
      validateLivePredictionState(state, observation);
      const motor = continuousEndpointIdentity(cue), network = this.#networks.get(`${motor}/self`);
      if (!network) return 2;
      const input = continuousReadoutInput(state, inputState(observation));
      const quality = this.#contexts.keys(`${motor}/self`).map(key => this.#contexts.read(`${motor}/self`, key, input));
      const progress = quality.reduce((sum, value) => sum + (value?.progress ?? 0) / (1 + (value?.error ?? 0)), 0);
      const errors = network.heads.reduce((sum, head) => sum + head.error / (1 + head.error), 0);
      // Generic measured learning progress and uncertainty. No named motor
      // effect, old receptor cache or imagined duration enters this drive.
      return 1 / Math.sqrt(1 + network.observations)
        + .15 * progress / Math.max(1, network.heads.length) + .05 * errors / Math.max(1, network.heads.length);
    }
    const motor = motorIdentity(cue), network = this.#networks.get(`${motor}/self`);
    if (!network) return 2;
    const uncertainty = (model: Network, state: State) => {
      const field = this.#field(model, state), covariance = model.heads[0]?.covariance;
      if (!covariance) return 1;
      return Math.log1p(Math.max(0, covariance.reduce((sum, row, i) => sum + field[i]!
        * row.reduce((inner, value, j) => inner + value * field[j]!, 0), 0)));
    };
    const attended = observation.objects.find(object => object.id === attentionId);
    const track = observation.perception?.tracks.find(object => object.id === attentionId);
    const local = this.#networks.get(`${motor}/object`);
    const normal = track?.surface ? worldToBody(track.surface.normal, observation.self.yaw) : null;
    const projectionUncertainty = normal ? Math.log1p(Math.max(0, normal.reduce((sum, n, i) => sum + n
      * normal.reduce((inner, v, j) => inner + v * (local?.motion?.covariance[i]?.[j] ?? (i === j ? 1000 : 0)), 0), 0)))
      : track?.motionEvidence.reduce((sum, measured, axis) => sum + (measured ? Math.log1p(1 / (1
        + (local?.heads.find(head => head.key === `motion/${axis}`)?.observations ?? 0))) : 0), 0) ?? 0;
    let acquisitionGain = 0;
    if (attended && observation.sensation) {
      let predictions = this.#attentionPredictions.get(observation);
      if (!predictions) { predictions = new Map(); this.#attentionPredictions.set(observation, predictions); }
      const motor = motorIdentity(cue);
      let predicted = predictions.get(motor);
      if (!predicted) { predicted = this.predict(cue, observation); predictions.set(motor, predicted); }
      const next = predicted.observation;
      if (next && ['self/yaw', 'self/pitch', 'self/position.0', 'self/position.1', 'self/position.2']
        .every(field => predicted.supportedFields.includes(field))) {
        // Choose a motor response using its LEARNED camera/body change. The
        // reference is the currently measured attention point, not a claim
        // about an unobserved future object or a named action's effect.
        // A retained anchor may lie outside today's visible patch. Attention
        // must center today's measured surface, not that remembered anchor.
        const view = observation.sensation, point = (track?.surface?.point ?? attended.relativePosition)
          .map((v, i) => v + observation.self.position[i]!);
        const quality = (self: Observation['self']) => {
          const [x, y, z] = point.map((v, i) => v - self.position[i]! - (i === 1 ? 1.62 : 0));
          const distance = Math.hypot(x!, y!, z!);
          const yaw = Math.atan2(Math.sin(Math.atan2(-x!, -z!) - self.yaw), Math.cos(Math.atan2(-x!, -z!) - self.yaw));
          const pitch = Math.atan2(y!, Math.hypot(x!, z!)) - self.pitch;
          // Center the sampled point. A large unfamiliar surface need not fit
          // entirely inside the field of view before attending to part of it
          // becomes worthwhile.
          return distance > view.range ? 0 : Math.exp(-4 * ((yaw / view.horizontalFov) ** 2 + (pitch / view.verticalFov) ** 2));
        };
        acquisitionGain = quality(next.self) - quality(observation.self);
      }
    }
    // Body terms do not depend on which visible surface receives attention.
    // Compute the same retinal input once per motor/frame, rather than once
    // per output head and again for every candidate object. Learning clears
    // the cache; it contains no transferable evidence or stored policy.
    let bases = this.#attentionBase.get(observation);
    if (!bases) { bases = new Map(); this.#attentionBase.set(observation, bases); }
    let base = bases.get(motor);
    if (base === undefined) {
      const state = inputState(observation);
      const progress = this.#contexts.keys(`${motor}/self`).map(key => this.#contexts.read(`${motor}/self`, key, state))
        .reduce((sum, value) => sum + (value?.progress ?? 0) / (1 + (value?.error ?? 0)), 0);
      base = 1 / Math.sqrt(1 + network.observations) + .15 * progress / Math.max(1, network.heads.length)
        + .05 * uncertainty(network, state);
      bases.set(motor, base);
    }
    const attendedState = attended ? inputState(observation, attended) : null;
    const acquisition = attendedState ? this.#contexts.read(`${motor}/object`, 'measurement', attendedState) : null;
    const measurable = acquisition?.supported && acquisition.value === false ? 0 : 1;
    return base + (attendedState ? .05 * (local ? uncertainty(local, attendedState) : 1) : 0)
      + .8 * acquisitionGain + .5 * projectionUncertainty * measurable;
  }
  snapshot(): ExperienceMediumSnapshot {
    const { recent, ...ledger } = this.#ledger.snapshot();
    return structuredClone({ version: this.#continuous ? 'KairosExperienceMediumV12' : 'KairosExperienceMediumV11', seed: this.#seed,
      random: this.#random, networks: [...this.#networks], events: recent, writes: this.#writes,
      ...(this.#untrainedMotorWindows ? { untrainedMotorWindows: this.#untrainedMotorWindows } : {}),
      ...(this.#untrainedLiveWindows ? { untrainedLiveWindows: this.#untrainedLiveWindows } : {}),
      ...(this.#continuous ? { semantics: CONTINUOUS_READOUT } : {}),
      contexts: this.#contexts.snapshot(), ledger });
  }
  static restore(state: ExperienceMediumSnapshot): ExperienceMedium {
    if (!['KairosExperienceMediumV9', 'KairosExperienceMediumV10', 'KairosExperienceMediumV11', 'KairosExperienceMediumV12'].includes(state.version)) throw new Error('experience-medium-version-mismatch');
    const continuous = state.version === 'KairosExperienceMediumV12';
    if (continuous ? state.semantics !== CONTINUOUS_READOUT : state.semantics !== undefined)
      throw new Error('experience-medium-semantic-version-mismatch');
    if (!continuous && state.version !== 'KairosExperienceMediumV11' && (state.contexts?.circuits.some(([, circuit]) =>
      circuit.samples.some(row => Object.hasOwn(row.input, 'self/oxygen') && Object.keys(row.input).some(key => key.startsWith('view/'))))
      || state.networks.some(([, network]) => network.inputs.includes('self/oxygen') && network.inputs.some(key => key.startsWith('view/')))))
      throw new Error('unowned-native-body-channel-requires-original-event-reencoding');
    const copy = structuredClone(state), medium = new ExperienceMedium(copy.seed);
    if (!Number.isSafeInteger(copy.random) || copy.random < 1 || copy.random > 0xffffffff)
      throw new Error('experience-medium-invalid-random-state');
    const untrainedMotorWindows = copy.untrainedMotorWindows ?? 0;
    const untrainedLiveWindows = copy.untrainedLiveWindows ?? 0;
    if (!Number.isSafeInteger(untrainedMotorWindows) || untrainedMotorWindows < 0
      || untrainedMotorWindows > 0 && copy.version !== 'KairosExperienceMediumV11' && !continuous
      || !Number.isSafeInteger(untrainedLiveWindows) || untrainedLiveWindows < 0 || untrainedLiveWindows > 0 && !continuous
      || !Number.isSafeInteger(copy.writes + untrainedMotorWindows + untrainedLiveWindows)) throw new Error('experience-medium-invalid-populations');
    if (!Number.isSafeInteger(copy.writes) || copy.writes < 0 || copy.events.length > copy.writes + untrainedMotorWindows + untrainedLiveWindows
      || copy.version === 'KairosExperienceMediumV9' && copy.events.length !== copy.writes
      || copy.version !== 'KairosExperienceMediumV9' && (!copy.ledger || !copy.contexts)
      || new Set(copy.events.map(([id]) => id)).size !== copy.events.length
      || new Set(copy.networks.map(([id]) => id)).size !== copy.networks.length) throw new Error('experience-medium-invalid-populations');
    if (copy.contexts?.circuits.some(([id]) => id.startsWith('continuous-v1/') && !continuous))
      throw new Error('experience-medium-semantic-version-mismatch');
    for (const [id, network] of copy.networks) {
      const encoded = id.startsWith('continuous-v1/');
      if (encoded ? !continuous || network.encoding !== EXPERIENCE_LIVE_LAW
        || !/^continuous-v1\/(endpoint|interval)\/[a-f0-9]{64}\/(self|object)$/.test(id)
        || network.inputs.length !== 0 || network.ranges.length !== 0 || network.motion !== undefined
        || [...network.weights.flat(), ...network.bias].some(value => value !== 0)
        : network.encoding !== undefined) throw new Error('experience-medium-readout-encoding-mismatch');
      const motion = network.motion;
      if (motion?.calibration && (motion.calibration.length > 32
        || new Set(motion.calibration.map(row => row.windowId)).size !== motion.calibration.length
        || motion.calibration.some(row => !row.windowId || !Number.isFinite(row.error) || row.error < 0
          || !Number.isFinite(row.residual) || row.residual < 0))) throw new Error('invalid-motion-window-calibration');
      if (motion && (motion.mean.length !== 3 || motion.covariance.length !== 3 || motion.information.length !== 3
        || [...motion.covariance, ...motion.information].some(row => row.length !== 3)
        || [...motion.mean, ...motion.covariance.flat(), ...motion.information.flat(), motion.variance, motion.correct, motion.error].some(v => !Number.isFinite(v))
        || motion.variance < 0 || motion.covariance.some((row, i) => row[i]! <= 0)
        || motion.correct < 0 || motion.correct > 1 || !Number.isSafeInteger(motion.observations) || motion.observations < 1))
        throw new Error('experience-medium-invalid-motion-estimate');
      if (network.inputs.length > INPUTS || new Set(network.inputs).size !== network.inputs.length
        || network.ranges.length !== network.inputs.length || network.ranges.some(range => range.length !== 2
          || !range.every(Number.isFinite) || range[0] > range[1])
        || network.weights.length !== HIDDEN || network.weights.some(row => row.length !== INPUTS)
        || network.bias.length !== HIDDEN || network.heads.some(head => [...head.readout, ...head.categoryReadout].some(row => row.length !== SIZE)
          || head.readout.length !== (head.numeric ? 2 : head.values.length)
          || head.numericQuality.length !== (head.numeric ? 4 : 0)
          || head.numericMeans.length !== (head.numeric ? 2 : 0) || head.numericMeans.some(value => !Number.isFinite(value))
          || head.categoryReadout.length !== (head.numeric ? 0 : head.values.length)
          || head.covariance.length !== SIZE || head.covariance.some(row => row.length !== SIZE)
          || !Number.isSafeInteger(head.observations) || head.observations < 1
          || [head.correct, head.categoryCorrect, head.regressionCorrect, ...head.numericQuality.map(q => q.correct)]
            .some(value => !Number.isFinite(value) || value < 0 || value > 1))
        || [...network.weights.flat(), ...network.bias, ...network.heads.flatMap(head =>
          [...head.readout.flat(), ...head.categoryReadout.flat(), ...head.covariance.flat()])]
          .some(value => !Number.isFinite(value))) throw new Error('experience-medium-invalid-conductances');
    }
    medium.#random = copy.random; medium.#networks = new Map(copy.networks); medium.#writes = copy.writes;
    medium.#untrainedMotorWindows = untrainedMotorWindows;
    medium.#untrainedLiveWindows = untrainedLiveWindows;
    medium.#continuous = continuous;
    if (copy.ledger) medium.#ledger = new ExperienceLedger(copy.ledger.capacity, copy.ledger.retired, copy.events, copy.ledger.streams);
    else for (const [id, digest] of copy.events) medium.#ledger.commit(id, digest);
    if (copy.contexts) medium.#contexts = ContextualReadout.restore(copy.contexts);
    return medium;
  }
}
