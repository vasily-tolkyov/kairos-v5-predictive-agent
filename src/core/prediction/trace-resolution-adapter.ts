import { PREDICTION_CONFIG, R1_CONFIG } from "../config.js";
import type { R1TraceSnapshot, Vec3 } from "../contracts.js";

export interface AdaptedPredictionTraceV1 {
  readonly version: "AdaptedPredictionTraceV1";
  readonly snapshot: R1TraceSnapshot;
  readonly scaleFactor: number;
  readonly originalMaximumAdjacentGap: number;
  readonly adaptedMaximumAdjacentGap: number;
  readonly targetMaximumAdjacentGap: number;
  /** Exact original-coordinate time step represented by one clone step after
   * the uniform coordinate gauge is restored.  This is not a claim that the
   * clone covered the unadapted wall-clock horizon. */
  readonly equivalentOriginalTimeStep: number;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function scaleAbout(point: Vec3, origin: Vec3, factor: number): Vec3 {
  return new Float64Array([
    origin[0]! + (point[0]! - origin[0]!) * factor,
    origin[1]! + (point[1]! - origin[1]!) * factor,
    origin[2]! + (point[2]! - origin[2]!) * factor,
  ]);
}

/**
 * Converts a defensive R1 trace copy into the numerical length gauge used by
 * PredictionClone.  It is a uniform change over every geometric quantity
 * (centres and kernel widths); order, coefficients, labels and the persistent
 * R1 medium are untouched.  With positions restored afterward, one clone step
 * is exactly equivalent to an original-coordinate Metropolis step using
 * `PREDICTION_CONFIG.timeStep / scaleFactor**2` and the same random draw.
 *
 * The frozen event map already caps the largest adjacent observation at
 * 0.4 R1 kernel widths.  Short events can be orders of magnitude below that
 * cap, while PredictionClone has one fixed Gaussian proposal scale.  Expanding
 * the complete temporary geometry to the same resolution contract preserves
 * all dimensionless potential values and prevents the proposal from jumping
 * over a physically real but numerically compressed event.
 */
export function adaptPredictionTraceResolution(snapshot: R1TraceSnapshot): AdaptedPredictionTraceV1 {
  if (snapshot.kernels.length < 2) throw new RangeError("prediction trace requires at least two kernels");
  let maximumAdjacentGap = 0;
  for (let index = 1; index < snapshot.kernels.length; index += 1) {
    maximumAdjacentGap = Math.max(
      maximumAdjacentGap,
      distance(snapshot.kernels[index - 1]!.center, snapshot.kernels[index]!.center),
    );
  }
  if (!(maximumAdjacentGap > 1e-12)) throw new RangeError("prediction trace has no resolvable geometric progress");

  const targetMaximumAdjacentGap = R1_CONFIG.kernelWidth * 0.4;
  const scaleFactor = Math.max(1, targetMaximumAdjacentGap / maximumAdjacentGap);
  const origin = snapshot.kernels[0]!.center;
  const adapted: R1TraceSnapshot = {
    ...snapshot,
    kernels: snapshot.kernels.map((kernel) => ({
      ...kernel,
      center: scaleAbout(kernel.center, origin, scaleFactor),
      sigma: kernel.sigma * scaleFactor,
    })),
  };
  return {
    version: "AdaptedPredictionTraceV1",
    snapshot: adapted,
    scaleFactor,
    originalMaximumAdjacentGap: maximumAdjacentGap,
    adaptedMaximumAdjacentGap: maximumAdjacentGap * scaleFactor,
    targetMaximumAdjacentGap,
    equivalentOriginalTimeStep: PREDICTION_CONFIG.timeStep / (scaleFactor * scaleFactor),
  };
}

/** Restore public diagnostic samples to the persistent R1 coordinate unit. */
export function restorePredictionTracePositions(
  positions: readonly Vec3[],
  source: Vec3,
  scaleFactor: number,
): readonly Vec3[] {
  if (!(Number.isFinite(scaleFactor) && scaleFactor >= 1)) throw new RangeError("invalid prediction trace scale");
  return positions.map((position) => scaleAbout(position, source, 1 / scaleFactor));
}
