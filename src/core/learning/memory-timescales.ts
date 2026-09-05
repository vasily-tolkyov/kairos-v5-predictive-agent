/**
 * DESIGN-002's law-level time-scale primitives.
 *
 * This module deliberately does not mutate a physical medium.  It defines the
 * deterministic functions used by the forthcoming protocol revision so their
 * monotonicity, bounds and provenance can be tested before any production
 * snapshot is bumped.  A caller supplies measured components, never a final
 * salience or recovery rate; the law derives both values here.
 */

export interface MemoryTimescaleLawConfigV1 {
  readonly version: 'MemoryTimescaleLawConfigV1';
  readonly baseRecoveryRate: 0.002;
  readonly minimumRecoveryFactor: number;
  readonly surpriseWeight: number;
  readonly goalRelevanceWeight: number;
  readonly repetitionWeight: number;
  readonly rehearsalWeight: number;
  readonly arousalDecayRate: number;
  readonly arousalGain: number;
  readonly encodingGainMinimum: number;
  readonly encodingGainMaximum: number;
  readonly homeostaticDownscaleFactor: number;
}

export interface MeasuredSalienceV1 {
  readonly version: 'MeasuredSalienceV1';
  /** Measured prediction-violation magnitude; zero is valid. */
  readonly surpriseMagnitude: number;
  /** Measured reduction in goal residual across the event; zero means none. */
  readonly goalRelevance: number;
  /** Existing physical support mass at the time of reinforcement. */
  readonly supportMass: number;
  /** Existing replay reactivation count for the structure. */
  readonly rehearsalCount: number;
}

export interface MediumArousalStateV1 {
  readonly version: 'MediumArousalStateV1';
  readonly arousal: number;
  readonly logicalTime: number;
}

export function memoryTimescaleLawConfigV1(): MemoryTimescaleLawConfigV1 {
  return Object.freeze({
    version: 'MemoryTimescaleLawConfigV1',
    baseRecoveryRate: 0.002,
    minimumRecoveryFactor: 0.2,
    surpriseWeight: 0.4,
    goalRelevanceWeight: 0.25,
    repetitionWeight: 0.2,
    rehearsalWeight: 0.15,
    arousalDecayRate: 0.05,
    arousalGain: 0.5,
    encodingGainMinimum: 0.75,
    encodingGainMaximum: 1.5,
    homeostaticDownscaleFactor: 0.995,
  });
}

function finiteNonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
  return value;
}

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function saturating(value: number): number {
  return 1 - Math.exp(-finiteNonnegative(value, 'measured salience component'));
}

function validateLaw(config: MemoryTimescaleLawConfigV1): void {
  if (config.version !== 'MemoryTimescaleLawConfigV1') throw new Error('unsupported memory timescale law');
  const canonicalLaw = memoryTimescaleLawConfigV1();
  const frozenKeys: readonly (keyof MemoryTimescaleLawConfigV1)[] = [
    'baseRecoveryRate', 'minimumRecoveryFactor', 'surpriseWeight',
    'goalRelevanceWeight', 'repetitionWeight', 'rehearsalWeight',
    'arousalDecayRate', 'arousalGain', 'encodingGainMinimum',
    'encodingGainMaximum', 'homeostaticDownscaleFactor',
  ];
  if (frozenKeys.some(key => config[key] !== canonicalLaw[key]))
    throw new Error('memory timescale law identity is frozen');
  if (config.baseRecoveryRate !== 0.002) throw new Error('base recovery rate is frozen at 0.002');
  if (!(config.minimumRecoveryFactor > 0 && config.minimumRecoveryFactor <= 1))
    throw new RangeError('minimum recovery factor must be in (0,1]');
  const weights = [config.surpriseWeight, config.goalRelevanceWeight,
    config.repetitionWeight, config.rehearsalWeight];
  if (weights.some(value => !Number.isFinite(value) || value < 0)
    || Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-12)
    throw new RangeError('salience weights must be nonnegative and sum to one');
  if (!(config.arousalDecayRate > 0) || !(config.arousalGain > 0))
    throw new RangeError('arousal law coefficients must be positive');
  if (!(config.encodingGainMinimum > 0 && config.encodingGainMinimum <= config.encodingGainMaximum))
    throw new RangeError('encoding gain bounds are invalid');
  if (!(config.homeostaticDownscaleFactor > 0 && config.homeostaticDownscaleFactor < 1))
    throw new RangeError('homeostatic factor must be in (0,1)');
}

/** Validate the canonical law identity without exposing mutable law state. */
export function assertMemoryTimescaleLawV1(config: MemoryTimescaleLawConfigV1): void {
  validateLaw(config);
}

/** Derive a continuous salience from measured components only. */
export function measuredSalienceV1(measurement: MeasuredSalienceV1,
  config: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): number {
  validateLaw(config);
  if (measurement.version !== 'MeasuredSalienceV1') throw new Error('unsupported salience measurement');
  return bounded(
    config.surpriseWeight * saturating(measurement.surpriseMagnitude)
    + config.goalRelevanceWeight * saturating(measurement.goalRelevance)
    + config.repetitionWeight * saturating(measurement.supportMass)
    + config.rehearsalWeight * saturating(measurement.rehearsalCount),
  );
}

/** Continuous monotone recovery factor. Zero salience retains the old rate. */
export function effectiveRecoveryRateV1(measurement: MeasuredSalienceV1,
  config: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): number {
  const salience = measuredSalienceV1(measurement, config);
  const factor = config.minimumRecoveryFactor
    + (1 - config.minimumRecoveryFactor) * Math.exp(-2 * salience);
  return config.baseRecoveryRate * factor;
}

/** Arousal is a medium state: callers provide measured surprise flux only. */
export function advanceArousalV1(state: MediumArousalStateV1, surpriseFlux: number,
  elapsed: number, config: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): MediumArousalStateV1 {
  validateLaw(config);
  if (state.version !== 'MediumArousalStateV1') throw new Error('unsupported arousal state');
  finiteNonnegative(state.arousal, 'arousal state');
  if (state.arousal > 1) throw new RangeError('arousal state must be bounded');
  finiteNonnegative(state.logicalTime, 'arousal logicalTime');
  finiteNonnegative(surpriseFlux, 'surprise flux');
  finiteNonnegative(elapsed, 'elapsed');
  const decayed = state.arousal * Math.exp(-config.arousalDecayRate * elapsed);
  return { version: 'MediumArousalStateV1', arousal: bounded(decayed + config.arousalGain * surpriseFlux),
    logicalTime: state.logicalTime + elapsed };
}

export function encodingGainV1(arousal: number,
  config: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): number {
  validateLaw(config);
  finiteNonnegative(arousal, 'arousal');
  const normalized = bounded(arousal);
  return config.encodingGainMinimum
    + (config.encodingGainMaximum - config.encodingGainMinimum) * normalized;
}

export function homeostaticDownscaleV1(values: readonly number[],
  config: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): readonly number[] {
  validateLaw(config);
  return values.map((value) => {
    finiteNonnegative(value, 'homeostatic value');
    return value * config.homeostaticDownscaleFactor;
  });
}
