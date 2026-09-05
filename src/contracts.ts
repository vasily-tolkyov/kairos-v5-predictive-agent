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
export type PrimitiveKind = 'observe' | 'wait' | 'look' | 'move' | 'jump' | 'interact' | 'attack' | 'break' | 'place' | 'select-hotbar';
export interface Action {
  readonly kind: PrimitiveKind;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly targetId?: string;
}
export interface ActionCue {
  readonly kind: PrimitiveKind | 'passive';
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly targetRole: string | null;
}
export interface BodyResult {
  readonly action: Action;
  readonly executed: boolean;
  readonly status: 'completed' | 'no-target' | 'out-of-reach' | 'unavailable';
  readonly startSequence: number;
  readonly endSequence: number;
  readonly terminationReason?: 'stable' | 'no-effect-window-complete' | 'observation-limit';
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
