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
  readonly terminationReason?: 'stable' | 'observation-limit';
}
export interface RealEvent {
  readonly version: 'RealEventV5';
  readonly id: string;
  readonly cue: ActionCue;
  readonly frames: readonly Observation[];
  readonly trackedIds: readonly string[];
  readonly bodyResult: BodyResult | null;
  readonly provenance: 'executed-real-body' | 'observed-passive';
  readonly complete: boolean;
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
export interface Intent {
  readonly goal: string;
  readonly subgoals: readonly string[];
  readonly hypotheses: readonly string[];
  readonly plan: readonly string[];
  readonly verification: readonly string[];
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
  readonly readout: readonly LocalReadout[];
  readonly reason: string | null;
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
export interface HypotheticalState {
  readonly kind: 'hypothetical-state';
  readonly predictedChanges: readonly PublicChange[];
  readonly explicitAssumptions: readonly string[];
  readonly unobserved: 'unknown';
}
