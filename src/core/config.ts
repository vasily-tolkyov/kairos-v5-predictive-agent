import type { BoundaryConfig, MediumConfig, Vec3 } from "./contracts.js";

const v = (x: number, y: number, z: number): Vec3 => new Float64Array([x, y, z]);

export const FORMAL_SEED = 0x4b4149524f535634n;

export const FORMAL_THRESHOLDS = Object.freeze({
  r2Top5RecallMin: 0.90,
  r2aCrossRoomMatchMin: 0.90,
  r2aOppositeFalseMatchMax: 0.10,
  fieldNegativeDownRateMin: 0.90,
  fieldPositiveUpOrSuspendRateMin: 0.90,
  roomOnlyAccuracyDropMax: 0.05,
  stateSwitchProbabilityChangeMin: 0.70,
  r2AblationDropMin: 0.25,
  r2aR3AblationDropMin: 0.25,
});

export const FORMAL_BOUNDARY: BoundaryConfig = Object.freeze({
  mode: "reflect" as const,
  min: v(-100, -100, -100),
  max: v(100, 100, 100),
});

function medium(
  name: MediumConfig["name"],
  overrides: Partial<Omit<MediumConfig, "name" | "boundary">> = {},
): MediumConfig {
  return Object.freeze({
    name,
    recoveryRate: 0.002,
    kernelWidth: 0.14,
    visitAmplitude: 1.0,
    roadStartAmplitude: 1.5,
    roadEndAmplitude: 14.0,
    timeStep: 0.04,
    diffusion: 0.08,
    temperature: 0.18,
    basinRadiusScale: 2.6,
    minimumActiveMagnitude: 1e-7,
    boundary: FORMAL_BOUNDARY,
    ...overrides,
  });
}

export const R1_CONFIG = medium("R1", { kernelWidth: 0.12 });
export const R2_CONFIG = medium("R2", { kernelWidth: 0.64, visitAmplitude: 1.0 });
export const R2A_CONFIG = medium("R2A", { kernelWidth: 0.26, visitAmplitude: 1.0 });
export const PREDICTION_CONFIG = medium("prediction", {
  recoveryRate: 0,
  kernelWidth: 0.12,
  roadStartAmplitude: 1.5,
  roadEndAmplitude: 16.0,
  timeStep: 0.04,
  diffusion: 0.08,
  temperature: 0.16,
});

export const FORMAL_EVALUATION = Object.freeze({
  trainRooms: 4,
  trainingObjects: 3,
  edgePositions: 2,
  motionDirections: 2,
  perceptionWidth: 256,
  pathSamples: 32,
  factorSlots: 4,
  predictionsPerCondition: 40,
  predictionSteps: 700,
  associationRecoveryRate: 0.002,
  r1PageCompatibilityDistance: 0.19,
  basinAssignmentRadiusScale: 3.0,
});
