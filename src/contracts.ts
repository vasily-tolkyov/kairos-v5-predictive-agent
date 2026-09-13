/** World coordinates never inhabit an R1 type. Only public observations cross this boundary. */
export type XYZ = readonly [number, number, number];
export type PublicValue = string | number | boolean | null;
export interface PublicObject {
  readonly id: string;
  readonly type: string;
  readonly relativePosition: XYZ;
  readonly properties: Readonly<Record<string, PublicValue>>;
}
export interface Observation {
  /** Actual capture instrumentation only; absent legacy clocks stay unknown.
   * Neither absolute clocks nor sampled control metadata are sensory features. */
  readonly physicalClock?: RealFrameClockV1;
  /** State at capture, before any motor edge emitted after this same frame. */
  readonly motorSignal?: BodyMotorSignalV1;
  /** Provenance of body-side measurements, never a predictive input. An
   * absent channel remains unknown across login/respawn boundaries. */
  readonly bodySensation?: { readonly version: 'OwnedBodySignals1'; readonly oxygen?: {
    readonly rawAir: number; readonly value: number } };
  /** Body-side optical binding, removed before anonymous learner input. */
  readonly retinalTargetId?: string | null;
  /** An engineered reading of the currently visible hotbar, without item IDs,
   * names, recipes, stack limits, or hidden inventory slots. */
  readonly hotbarSensation?: { readonly version: 'VisibleHotbar1'; readonly slots: readonly {
    readonly count: number; readonly color: XYZ | null }[] };
  readonly sensation?: import('./perception.js').VisualSensation;
  readonly perception?: import('./perception.js').PerceptionFrame;
  /** Present only on imagined states: fields absent from this set are unknown. */
  readonly predictionSupport?: readonly string[];
  readonly predictionContext?: Readonly<Record<string, PublicValue>>;
  /** Imagined numeric possibilities accumulated from measured response
   * envelopes. These are not observations or confidence guarantees. */
  readonly predictionBounds?: import('./numeric-ranges.js').NumericRanges;
  readonly sequence: number;
  readonly activeSeconds: number;
  readonly objects: readonly PublicObject[];
  readonly self: { readonly position: XYZ; readonly yaw: number; readonly pitch: number;
    readonly properties: Readonly<Record<string, PublicValue>> };
  readonly targetId: string | null;
  readonly contextId: string;
}
export interface VerifiedInternalChannelV1 {
  readonly version: 'VerifiedInternalChannelV1';
  readonly name: 'branch-entropy' | 'prediction-support' | 'applicable-relations'
    | 'surprise-rate' | 'goal-residual' | 'action-budget-remaining';
  readonly value: number;
  readonly provenance: 'verified-internal';
  readonly availableBeforeOutcome: true;
}
export type PrimitiveKind = 'passive' | 'observe' | 'wait' | 'look' | 'move' | 'jump' | 'interact' | 'attack' | 'break' | 'place' | 'select-hotbar' | 'respawn' | 'use-item';
export interface Action {
  readonly kind: PrimitiveKind;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly targetId?: string;
}
export interface ActionCue {
  readonly kind: PrimitiveKind;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly targetRole: string | null;
}
/** Body instrumentation only: no action, engine object ID, or world state. */
export interface MotorClockV1 {
  readonly observationSequence: number;
  /** Physical callbacks, excluding terminal sensor samples such as death. */
  readonly physicsTick: number;
  readonly activeSeconds: number;
  /** Process-monotonic milliseconds, not wall time or a learned input. */
  readonly monotonicMs: number;
}
export interface RealFrameClockV1 {
  readonly version: 'RealFrameClockV1'; readonly physicsTick: number;
  readonly secondsPerTick: 0.05; readonly monotonicMs: number;
  readonly sample: 'physics' | 'terminal';
}
/** Only controls with measured hold transitions have a known state. This is
 * an actuator signal, never a claim about motion, effect or physical rest. */
export type BodyMotorSignalV1 =
  | { readonly version: 'BodyMotorSignalV1'; readonly scope: 'instrumented-held-controls';
      readonly state: 'unknown'; readonly cue: null }
  | { readonly version: 'BodyMotorSignalV1'; readonly scope: 'instrumented-held-controls';
      readonly state: 'off'; readonly cue: null }
  | { readonly version: 'BodyMotorSignalV1'; readonly scope: 'instrumented-held-controls';
      readonly state: 'held'; readonly cue: ActionCue };
export interface MotorEdgeV1 {
  readonly version: 'MotorEdgeV1'; readonly edgeSequence: number;
  readonly kind: 'press' | 'release' | 'unmeasured'; readonly clock: MotorClockV1;
  readonly signal: BodyMotorSignalV1; readonly succeeded: boolean | null;
  readonly releaseReason: MotorReceiptV1['releaseReason'] | null;
}
export type PhysicalTelemetryRecordV1 = { readonly order: number; readonly receivedMonotonicMs: number } & (
  | { readonly kind: 'frame'; readonly observation: Observation; readonly source?: 'worker-frame' | 'cached-anchor' }
  | { readonly kind: 'motor-edge'; readonly edge: MotorEdgeV1 });
export interface PhysicalTelemetryGapV1 {
  readonly firstOrder: number; readonly lastOrder: number;
  readonly records: number; readonly frames: number; readonly motorEdges: number;
  readonly reason: 'payload-or-record-capacity';
}
export interface PhysicalTelemetryBatchV1 {
  readonly version: 'PhysicalTelemetryBatchV1'; readonly records: readonly PhysicalTelemetryRecordV1[];
  readonly gap: PhysicalTelemetryGapV1 | null;
  readonly receivedThroughOrder: number; readonly deliveredThroughOrder: number;
  /** Exact raw transport JSON payload bytes before adapter anonymization,
   * not a heap/RSS guarantee and not the size of the transformed records. */
  readonly serializedPayloadBytes: number;
  readonly limits: { readonly records: number; readonly serializedPayloadBytes: number };
  /** The requested exact frame was unavailable; never certify continuity. */
  readonly boundaryMissing?: true;
}
export interface MotorReceiptV1 {
  readonly version: 'MotorReceiptV1';
  readonly durationParameter: 'ticks' | 'holdTicks';
  readonly requestedTicks: number;
  readonly requestedAt: MotorClockV1;
  readonly pressedAt: MotorClockV1;
  readonly releasedAt: MotorClockV1;
  readonly pressSucceeded: boolean;
  readonly releaseSucceeded: boolean;
  readonly actualTicks: number;
  readonly actualSeconds: number;
  readonly elapsedMonotonicMs: number;
  readonly observedIntervals: number;
  readonly frameRange: { readonly startSequence: number; readonly endSequence: number };
  readonly releaseReason: 'interval-complete' | 'death' | 'fault' | 'closed' | 'timeout' | 'press-failed';
}
export interface BodyResult {
  readonly action: Action;
  readonly executed: boolean;
  readonly status: 'completed' | 'no-target' | 'out-of-reach' | 'unavailable';
  readonly startSequence: number;
  readonly endSequence: number;
  /** Absent in legacy records: never reconstructed from requested duration. */
  readonly motorReceipt?: MotorReceiptV1;
  readonly terminationReason?: 'stable' | 'no-effect-window-complete' | 'observation-limit' | 'motor-released' | 'body-interrupted' | 'interval-complete';
}
export interface RealEventContinuityEvidenceV1 {
  readonly dependencyId: string;
  readonly basis: 'public-state-carried-forward' | 'successor-depends-on-prior-public-observation';
  readonly subject: string;
  readonly property: string;
  readonly beforeObservationSequence: number;
  readonly afterObservationSequence: number;
  /** Hashes of public values at the two ends; no world/R1/R2 coordinate is encoded. */
  readonly beforeValueSha256: string;
  readonly afterValueSha256: string;
  readonly factCategory: 'public-state-persistence' | 'public-state-transition' | 'public-successor-precondition';
}
/**
 * Public, replayable continuity metadata. Legacy/reset-separated records omit
 * this object and are therefore R1-only; omission never guesses an R2 chain.
 */
export interface RealEventHierarchyContinuityV1 {
  readonly version: 'RealEventHierarchyContinuityV1';
  readonly sessionId: string;
  readonly continuityEpochId: string;
  readonly boundaryBefore: 'continuous' | 'reset' | 'gap' | 'external-takeover';
  readonly processStatusAfter: 'open' | 'publicly-resolved' | 'observation-insufficient';
  readonly dependencies: readonly RealEventContinuityEvidenceV1[];
}
export interface RealEvent {
  readonly version: 'RealEventV5' | 'RealEventV6';
  readonly id: string;
  readonly cue: ActionCue;
  readonly frames: readonly Observation[];
  readonly trackedIds: readonly string[];
  /** Object selected for attention before the action, never from its outcome. */
  readonly attentionId?: string | null;
  readonly bodyResult: BodyResult | null;
  readonly provenance: 'executed-real-body' | 'observed-passive';
  readonly complete: boolean;
  readonly hierarchyContinuity?: RealEventHierarchyContinuityV1;
  /** Runtime-derived internal facts; callers cannot supply these to validation. */
  readonly verifiedInternalChannels?: readonly VerifiedInternalChannelV1[];
}
export interface PublicChange {
  readonly subject: string;
  readonly property: string;
  readonly before: PublicValue;
  readonly after: PublicValue;
  readonly observationIndex: number;
  readonly meaning: 'observed-co-occurrence';
}
export interface DesiredChange {
  readonly subject?: string;
  readonly property?: string;
  readonly direction?: 'increase' | 'decrease' | 'change' | 'unchanged';
  readonly value?: PublicValue;
}
export interface LocalReadout {
  readonly sampleStep: number;
  /** Index within the physical snapshot passed to Clone/readout. */
  readonly kernelIndex: number;
  /** Index before factual-prefix slicing; absent only in older saved evidence. */
  readonly originalKernelIndex?: number;
  readonly distance: number;
  readonly potential: number;
  readonly changes: readonly PublicChange[];
}
export interface PredictionSample {
  readonly seed: number;
  readonly traceId: string | null;
  readonly pageId: string | null;
  readonly positions: readonly number[][];
  /**
   * Control/audit snapshots may retain only the endpoints of an already
   * completed trajectory. The live PhysicalMemory result omits this field
   * and always contains the full trajectory.
   */
  readonly trajectoryRetention?: 'endpoints-only';
  /** Number of positions produced by PredictionClone before audit compaction. */
  readonly simulatedPositionCount?: number;
  readonly readout: readonly LocalReadout[];
  readonly reason: string | null;
  /** Uniform numerical-unit conversion used only inside the temporary clone. */
  readonly resolutionScale?: number;
}
export interface Prediction {
  readonly kind: 'factual-prediction' | 'hypothetical-prediction';
  readonly support: number;
  readonly calibratedProbability: false;
  readonly samples: readonly PredictionSample[];
  readonly evidence: unknown;
  readonly unknown: readonly string[];
  readonly mapSha256: string | null;
}
