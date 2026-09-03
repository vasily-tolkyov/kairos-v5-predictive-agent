import { FORMAL_EVALUATION, R1_CONFIG, R2_CONFIG } from '../config.js';
import type { Vec3 } from '../contracts.js';
import { DistanceEmbedding, type EmbeddingState } from '../../distance-embedding.js';
import type { FeatureRow } from '../../events.js';
import { R2_ATOM_DESCRIPTOR_VERSION_V2, r2AtomDescriptorV2 } from './r2-atom-descriptor.js';
import { R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1 } from './r2-continuous-event.js';
import { sha } from '../../util.js';

export interface R2AtomQualificationV1 {
  readonly version: 'R2AtomQualificationV1';
  readonly descriptorVersion: typeof R2_ATOM_DESCRIPTOR_VERSION_V2;
  readonly sourceMetric: 'frozen-R1-path-rms-v2';
  readonly equivalentSourceTransforms: 'monotone-arc-resampling';
  readonly equivalentOutputMaximum: number;
  readonly protectedNearSourceMaximum: number;
  readonly protectedNearOutputMaximum: number;
  readonly obviousSourceMinimum: number;
  readonly obviousOutputMinimum: number;
  readonly equivalentProbeCount: number;
  readonly protectedNearPairCount: number;
  readonly obviousPairCount: number;
  readonly maximumEquivalentDistance: number;
  readonly maximumProtectedNearDistance: number;
  readonly minimumObviousDistance: number;
  readonly boundaryMargin: number;
  readonly selectedScale: number;
  readonly result: 'equivalence-and-separation-passed';
}

export interface R2AtomMeasurementAdapterStateV3 {
  readonly version: 'R2AtomMeasurementAdapterStateV3';
  readonly coordinateSystem: typeof R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1;
  readonly source: 'frozen-R1-event-description-path';
  readonly embeddingInputMetric: 'raw-feature-rms';
  readonly outputWidth: 3;
  readonly embedding: EmbeddingState;
  readonly qualification: R2AtomQualificationV1;
  readonly identitySha256: string;
}

export const R2_ATOM_EQUIVALENT_RESOLUTION_V1 = R2_CONFIG.kernelWidth * .1;
// A descriptor is the scalar RMS of N three-axis samples from one R1 road.
// Its aggregate resolution therefore scales as sigma/sqrt(3N), rather than as
// one local R1 kernel. The near band occupies half that aggregate resolution;
// the interval between the two thresholds has no forced merge/split meaning.
export const R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1 =
  R1_CONFIG.kernelWidth / Math.sqrt(FORMAL_EVALUATION.pathSamples * 3);
export const R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1 =
  R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1 / 2;
export const R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1 = R2_CONFIG.kernelWidth * .75;
export const R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1 = R2_CONFIG.kernelWidth;

function descriptor(path: readonly Vec3[]): FeatureRow {
  const geometry = r2AtomDescriptorV2(path);
  const row: Record<string, number> = {};
  for (let index = 0; index < geometry.length; index += 1) {
    row[`${R2_ATOM_DESCRIPTOR_VERSION_V2}/${index}`] = geometry[index]!;
  }
  return row;
}

function densify(path: readonly Vec3[], subdivisions: number): Vec3[] {
  const values: Vec3[] = [new Float64Array(path[0]!)];
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]!, end = path[index]!;
    for (let part = 1; part <= subdivisions; part += 1) values.push(new Float64Array(start.map((value, axis) =>
      value + (end[axis]! - value) * part / subdivisions)));
  }
  return values;
}

function distance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(...left.map((value, axis) => value - right[axis]!));
}

function sourceDistance(left: FeatureRow, right: FeatureRow): number {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  const delta = keys.map(key => (left[key] ?? 0) - (right[key] ?? 0));
  return Math.sqrt(delta.reduce((sum, value) => sum + value ** 2, 0) / Math.max(1, delta.length));
}

export interface R2AtomQualificationScaleInputV1 {
  readonly maximumUnscaledEquivalentDistance: number;
  readonly maximumUnscaledProtectedNearDistance: number;
  readonly minimumUnscaledObviousDistance: number;
  readonly maximumUnscaledCoordinateMagnitude: number;
}

export function solveR2AtomQualificationScaleV1(input: R2AtomQualificationScaleInputV1): number {
  const values = Object.values(input);
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('invalid-R2-atom-qualification-distance');
  }
  if (input.minimumUnscaledObviousDistance <= 1e-12) {
    throw new Error('R2-obvious-event-contrast-collapsed-in-three-dimensions');
  }
  const lower = R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1 / input.minimumUnscaledObviousDistance;
  const caps: number[] = [];
  if (input.maximumUnscaledEquivalentDistance > 1e-12) caps.push(
    R2_ATOM_EQUIVALENT_RESOLUTION_V1 / input.maximumUnscaledEquivalentDistance);
  if (input.maximumUnscaledProtectedNearDistance > 1e-12) caps.push(
    R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1 / input.maximumUnscaledProtectedNearDistance);
  const boundaryMargin = R2_CONFIG.kernelWidth * R2_CONFIG.basinRadiusScale;
  const availableBoundary = Math.min(...R2_CONFIG.boundary.max.map((maximum, axis) =>
    Math.min(maximum - boundaryMargin, -R2_CONFIG.boundary.min[axis]! - boundaryMargin)));
  if (!(availableBoundary > 0)) throw new Error('R2-physical-boundary-has-no-qualified-interior');
  if (input.maximumUnscaledCoordinateMagnitude > 1e-12) caps.push(
    availableBoundary / input.maximumUnscaledCoordinateMagnitude);
  const upper = caps.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...caps);
  if (lower > upper + 1e-12) {
    throw new Error('R2-three-dimensional-qualification-infeasible');
  }
  return lower;
}

/**
 * Label-free measurement adapter from an already frozen R1 event path to one
 * R2 measurement point.  It reads neither a goal nor a world coordinate.  A
 * complete R2 event is still the ordered sequence of these points, never one
 * endpoint returned by this adapter.
 */
export class R2AtomMeasurementAdapterV1 {
  readonly #embedding: DistanceEmbedding;
  readonly #state: R2AtomMeasurementAdapterStateV3;

  private constructor(embedding: DistanceEmbedding, state: Omit<R2AtomMeasurementAdapterStateV3, 'identitySha256'>) {
    this.#embedding = embedding;
    this.#state = { ...state, identitySha256: sha(state) };
  }

  static fit(paths: readonly (readonly Vec3[])[]): R2AtomMeasurementAdapterV1 {
    if (paths.length < 8) throw new Error('R2-atom-adapter-needs-R1-measurements');
    // Qualification below is defined in the literal frozen-R1 path RMS
    // metric.  Learn the three-dimensional map in that same metric; the
    // default per-feature standardized embedding would silently optimize a
    // different geometry and can tear raw-near events apart.
    const rows = paths.map(descriptor), fitted = DistanceEmbedding.fitRawRms(rows);
    const rawCoordinates = rows.map(row => fitted.encode(row).coordinate);
    let equivalentProbeCount = 0, maximumUnscaledEquivalentDistance = 0;
    for (const path of paths) for (const subdivisions of [2, 3, 4]) {
      equivalentProbeCount++;
      maximumUnscaledEquivalentDistance = Math.max(maximumUnscaledEquivalentDistance,
        distance(fitted.encode(descriptor(path)).coordinate,
          fitted.encode(descriptor(densify(path, subdivisions))).coordinate));
    }
    let protectedNearPairCount = 0, obviousPairCount = 0;
    let maximumUnscaledProtectedNearDistance = 0;
    let minimumUnscaledObviousDistance = Number.POSITIVE_INFINITY;
    for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
      const source = sourceDistance(rows[left]!, rows[right]!);
      const output = distance(rawCoordinates[left]!, rawCoordinates[right]!);
      if (source <= R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1 + 1e-12) {
        protectedNearPairCount++;
        maximumUnscaledProtectedNearDistance = Math.max(maximumUnscaledProtectedNearDistance, output);
      }
      if (source + 1e-12 >= R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1) {
        obviousPairCount++;
        minimumUnscaledObviousDistance = Math.min(minimumUnscaledObviousDistance, output);
      }
    }
    if (obviousPairCount === 0) {
      throw new Error('R2-insufficient-obvious-calibration-contrast');
    }
    const maximumUnscaledCoordinateMagnitude = Math.max(...rawCoordinates.flatMap(coordinate => coordinate.map(Math.abs)));
    const scale = solveR2AtomQualificationScaleV1({ maximumUnscaledEquivalentDistance,
      maximumUnscaledProtectedNearDistance, minimumUnscaledObviousDistance,
      maximumUnscaledCoordinateMagnitude });
    const embedding = new DistanceEmbedding({ ...fitted.state, scale });
    const maximumEquivalentDistance = maximumUnscaledEquivalentDistance * scale;
    const maximumProtectedNearDistance = maximumUnscaledProtectedNearDistance * scale;
    const minimumObviousDistance = minimumUnscaledObviousDistance * scale;
    if (maximumEquivalentDistance > R2_ATOM_EQUIVALENT_RESOLUTION_V1 + 1e-9) {
      throw new Error('R2-equivalence-not-preserved');
    }
    if (maximumProtectedNearDistance > R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1 + 1e-9) {
      throw new Error('R2-protected-similarity-torn-apart');
    }
    if (minimumObviousDistance + 1e-9 < R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1) {
      throw new Error('R2-obvious-event-contrast-collapsed');
    }
    const boundaryMargin = R2_CONFIG.kernelWidth * R2_CONFIG.basinRadiusScale;
    const coordinates = rows.map(row => embedding.encode(row).coordinate);
    if (coordinates.some(coordinate => coordinate.some((value, axis) =>
      value < R2_CONFIG.boundary.min[axis]! + boundaryMargin - 1e-9
      || value > R2_CONFIG.boundary.max[axis]! - boundaryMargin + 1e-9))) {
      throw new Error('R2-qualified-coordinate-outside-physical-boundary');
    }
    return new R2AtomMeasurementAdapterV1(embedding, { version: 'R2AtomMeasurementAdapterStateV3',
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
      source: 'frozen-R1-event-description-path', embeddingInputMetric: 'raw-feature-rms', outputWidth: 3,
      embedding: embedding.state, qualification: { version: 'R2AtomQualificationV1',
        descriptorVersion: R2_ATOM_DESCRIPTOR_VERSION_V2, sourceMetric: 'frozen-R1-path-rms-v2',
        equivalentSourceTransforms: 'monotone-arc-resampling',
        equivalentOutputMaximum: R2_ATOM_EQUIVALENT_RESOLUTION_V1,
        protectedNearSourceMaximum: R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1,
        protectedNearOutputMaximum: R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1,
        obviousSourceMinimum: R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1,
        obviousOutputMinimum: R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1,
        equivalentProbeCount, protectedNearPairCount, obviousPairCount,
        maximumEquivalentDistance, maximumProtectedNearDistance, minimumObviousDistance,
        boundaryMargin, selectedScale: scale, result: 'equivalence-and-separation-passed' } });
  }

  static restore(state: R2AtomMeasurementAdapterStateV3): R2AtomMeasurementAdapterV1 {
    const qualification = state.qualification;
    if (state.version !== 'R2AtomMeasurementAdapterStateV3'
      || state.coordinateSystem !== R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1
      || state.source !== 'frozen-R1-event-description-path'
      || state.embeddingInputMetric !== 'raw-feature-rms'
      || state.embedding.deviation.some(value => value !== 1)
      || state.outputWidth !== 3
      || qualification?.version !== 'R2AtomQualificationV1'
      || qualification.descriptorVersion !== R2_ATOM_DESCRIPTOR_VERSION_V2
      || qualification.sourceMetric !== 'frozen-R1-path-rms-v2'
      || qualification.equivalentSourceTransforms !== 'monotone-arc-resampling'
      || qualification.equivalentOutputMaximum !== R2_ATOM_EQUIVALENT_RESOLUTION_V1
      || qualification.protectedNearSourceMaximum !== R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1
      || qualification.protectedNearOutputMaximum !== R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1
      || qualification.obviousSourceMinimum !== R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1
      || qualification.obviousOutputMinimum !== R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1
      || qualification.boundaryMargin !== R2_CONFIG.kernelWidth * R2_CONFIG.basinRadiusScale
      || qualification.result !== 'equivalence-and-separation-passed'
      || !Number.isSafeInteger(qualification.equivalentProbeCount) || qualification.equivalentProbeCount <= 0
      || !Number.isSafeInteger(qualification.protectedNearPairCount) || qualification.protectedNearPairCount < 0
      || !Number.isSafeInteger(qualification.obviousPairCount) || qualification.obviousPairCount <= 0
      || !Number.isFinite(qualification.selectedScale) || qualification.selectedScale <= 0
      || state.embedding.scale !== qualification.selectedScale
      || !Number.isFinite(qualification.maximumEquivalentDistance)
      || qualification.maximumEquivalentDistance < 0
      || qualification.maximumEquivalentDistance > qualification.equivalentOutputMaximum + 1e-9
      || !Number.isFinite(qualification.maximumProtectedNearDistance)
      || qualification.maximumProtectedNearDistance < 0
      || qualification.maximumProtectedNearDistance > qualification.protectedNearOutputMaximum + 1e-9
      || !Number.isFinite(qualification.minimumObviousDistance)
      || qualification.minimumObviousDistance + 1e-9 < qualification.obviousOutputMinimum) {
      throw new Error('legacy-or-incompatible-R2-atom-adapter');
    }
    const { identitySha256, ...identity } = state;
    if (identitySha256 !== sha(identity)) throw new Error('R2-atom-adapter-identity-mismatch');
    return new R2AtomMeasurementAdapterV1(new DistanceEmbedding(state.embedding), identity);
  }

  measure(path: readonly Vec3[]): Vec3 {
    const encoded = this.#embedding.encode(descriptor(path));
    if (encoded.unknownKeys.length > 0 || encoded.coordinate.length !== 3
      || encoded.coordinate.some(value => !Number.isFinite(value))) {
      throw new Error('R2-atom-measurement-not-representable');
    }
    return new Float64Array(encoded.coordinate);
  }

  exportState(): R2AtomMeasurementAdapterStateV3 { return structuredClone(this.#state); }
}
