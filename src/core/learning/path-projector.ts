import { FORMAL_EVALUATION } from "../config.js";
import type { PathProjectorStateV1, R1RouteSignature, Vec3 } from "../contracts.js";
import { TrustedExperience } from "../firewall.js";
import {
  add3,
  clone3,
  cross3,
  dot3,
  norm3,
  normalize3,
  scale3,
  sub3,
  vec3,
} from "../vector.js";

export interface PathEncoderDiagnostics {
  readonly geometryDistanceCorrelation: number;
  readonly causalPrefixRootMeanSquaredDistance: number;
  readonly outputDimensions: 3;
  readonly landmarkCount: number;
}

function firstTangent(points: readonly Vec3[]): Vec3 | null {
  for (let index = 1; index < points.length; index += 1) {
    const tangent = normalize3(sub3(points[index]!, points[index - 1]!));
    if (tangent !== null) return tangent;
  }
  return null;
}

function lastTangent(points: readonly Vec3[]): Vec3 | null {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const tangent = normalize3(sub3(points[index]!, points[index - 1]!));
    if (tangent !== null) return tangent;
  }
  return null;
}

function approximateSelfIntersections(points: readonly Vec3[], tolerance = 0.004): number {
  let count = 0;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 2; right < points.length; right += 1) {
      if (left === 0 && right === points.length - 1) continue;
      if (norm3(sub3(points[left]!, points[right]!)) <= tolerance) count += 1;
    }
  }
  return count;
}

function rotateMinimum(vector: Vec3, from: Vec3, to: Vec3): Vec3 {
  const a = normalize3(from);
  const b = normalize3(to);
  if (a === null || b === null) throw new RangeError("rotation requires nonzero vectors");
  const cosine = Math.max(-1, Math.min(1, dot3(a, b)));
  if (cosine > 1 - 1e-12) return clone3(vector);
  let axis: Vec3;
  let sine: number;
  if (cosine < -1 + 1e-12) {
    const basis = Math.abs(a[0]!) < 0.8 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    const candidate = normalize3(cross3(a, basis));
    if (candidate === null) throw new Error("failed to construct canonical rotation");
    axis = candidate;
    sine = 0;
  } else {
    const cross = cross3(a, b);
    const candidate = normalize3(cross);
    if (candidate === null) return clone3(vector);
    axis = candidate;
    sine = norm3(cross);
  }
  return add3(
    add3(scale3(vector, cosine), scale3(cross3(axis, vector), sine)),
    scale3(axis, dot3(axis, vector) * (1 - cosine)),
  );
}

function resampleByArc(points: readonly Vec3[], count: number): readonly Vec3[] {
  if (points.length < 2) throw new RangeError("path requires at least two samples");
  const cumulative = new Float64Array(points.length);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += norm3(sub3(points[index]!, points[index - 1]!));
    cumulative[index] = total;
  }
  if (total <= 1e-12) throw new RangeError("path requires a nonzero arc");
  const result: Vec3[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample += 1) {
    const target = total * sample / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment]! < target) segment += 1;
    const before = segment - 1;
    const span = cumulative[segment]! - cumulative[before]!;
    const mix = span <= 1e-12 ? 0 : (target - cumulative[before]!) / span;
    result.push(add3(points[before]!, scale3(sub3(points[segment]!, points[before]!), mix)));
  }
  return result;
}

export function canonicalPath(points: readonly Vec3[], sampleCount = FORMAL_EVALUATION.pathSamples): Float64Array {
  const source = points[0];
  if (source === undefined) throw new RangeError("path cannot be empty");
  const relative = points.map((point) => sub3(point, source));
  const tangent = firstTangent(relative);
  if (tangent === null) throw new RangeError("path requires an observable initial tangent");
  const rotated = relative.map((point) => rotateMinimum(point, tangent, vec3(1, 0, 0)));
  const sampled = resampleByArc(rotated, sampleCount);
  const flattened = new Float64Array(sampleCount * 3);
  sampled.forEach((point, index) => flattened.set(point, index * 3));
  return flattened;
}

export function rawGeometryDistance(left: Float64Array, right: Float64Array): number {
  if (left.length !== right.length || left.length % 3 !== 0) throw new RangeError("geometry vectors must align");
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += (left[index]! - right[index]!) ** 2;
  return Math.sqrt(sum / (left.length / 3));
}

export function r1RouteSignature(points: readonly Vec3[]): R1RouteSignature {
  if (points.length < 2) throw new RangeError("R1 route signature requires at least two points");
  const tangent = firstTangent(points);
  const terminalTangent = lastTangent(points);
  const closureDistance = norm3(sub3(points[points.length - 1]!, points[0]!));
  if (tangent === null || terminalTangent === null || closureDistance <= 1e-9) {
    throw new RangeError("R1 route signature requires an ordered, intrinsically non-closed event path");
  }
  return {
    version: "R1RouteSignatureV2",
    geometry: canonicalPath(points),
    initialTangent: clone3(tangent),
    terminalTangent: clone3(terminalTangent),
    intrinsicClosureDistance: closureDistance,
    selfIntersectionCount: approximateSelfIntersections(points),
  };
}

function pearson(left: readonly number[], right: readonly number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]! - leftMean;
    const b = right[index]! - rightMean;
    numerator += a * b;
    leftEnergy += a * a;
    rightEnergy += b * b;
  }
  return leftEnergy === 0 || rightEnergy === 0 ? 0 : numerator / Math.sqrt(leftEnergy * rightEnergy);
}

function solveLinear(matrix: number[][], target: number[]): number[] {
  const n = target.length;
  const augmented = matrix.map((row, index) => [...row, target[index]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    if (Math.abs(divisor) < 1e-12) continue;
    for (let value = column; value <= n; value += 1) augmented[column]![value] = augmented[column]![value]! / divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let value = column; value <= n; value += 1) {
        augmented[row]![value] = augmented[row]![value]! - factor * augmented[column]![value]!;
      }
    }
  }
  return augmented.map((row) => row[n] ?? 0);
}

function multiply(matrix: readonly Float64Array[], vector: Float64Array): Float64Array {
  const result = new Float64Array(matrix.length);
  matrix.forEach((row, index) => {
    let value = 0;
    for (let column = 0; column < vector.length; column += 1) value += row[column]! * vector[column]!;
    result[index] = value;
  });
  return result;
}

function dotVector(left: Float64Array, right: Float64Array): number {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index]! * right[index]!;
  return value;
}

function classicalMds(distances: readonly Float64Array[]): readonly Vec3[] {
  const n = distances.length;
  const rowMeans = new Float64Array(n);
  let grandMean = 0;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) rowMeans[row] = rowMeans[row]! + distances[row]![column]! ** 2;
    rowMeans[row] = rowMeans[row]! / n;
    grandMean += rowMeans[row]!;
  }
  grandMean /= n;
  const gram: Float64Array[] = [];
  for (let row = 0; row < n; row += 1) {
    const values = new Float64Array(n);
    for (let column = 0; column < n; column += 1) {
      values[column] = -0.5 * (distances[row]![column]! ** 2 - rowMeans[row]! - rowMeans[column]! + grandMean);
    }
    gram.push(values);
  }
  const eigenvectors: Float64Array[] = [];
  const eigenvalues: number[] = [];
  for (let component = 0; component < 3; component += 1) {
    let vector: Float64Array = new Float64Array(n);
    for (let index = 0; index < n; index += 1) vector[index] = Math.sin((index + 1) * (component + 1) * 1.618);
    for (let iteration = 0; iteration < 160; iteration += 1) {
      let next = multiply(gram, vector);
      for (const previous of eigenvectors) {
        const projection = dotVector(next, previous);
        for (let index = 0; index < n; index += 1) next[index] = next[index]! - projection * previous[index]!;
      }
      const magnitude = Math.sqrt(dotVector(next, next));
      if (magnitude <= 1e-12) break;
      for (let index = 0; index < n; index += 1) next[index] = next[index]! / magnitude;
      vector = new Float64Array(next);
    }
    const eigenvalue = Math.max(0, dotVector(vector, multiply(gram, vector)));
    eigenvectors.push(vector);
    eigenvalues.push(eigenvalue);
  }
  return Array.from({ length: n }, (_, index) => vec3(
    eigenvectors[0]![index]! * Math.sqrt(eigenvalues[0]!),
    eigenvectors[1]![index]! * Math.sqrt(eigenvalues[1]!),
    eigenvectors[2]![index]! * Math.sqrt(eigenvalues[2]!),
  ));
}

export class PathProjector {
  #landmarks: readonly Float64Array[] = [];
  #bandwidth = 1;
  #weights: readonly Float64Array[] = [];
  #diagnostics: PathEncoderDiagnostics | null = null;

  fit(experiences: readonly TrustedExperience[]): void {
    if (experiences.length < 8) throw new RangeError("geometry encoder requires at least eight trusted paths");
    const geometries = experiences.map((experience) => canonicalPath(experience.trajectory()));
    const distances = geometries.map((left) => new Float64Array(geometries.map((right) => rawGeometryDistance(left, right))));
    const targets = classicalMds(distances);
    const landmarkCount = Math.min(12, geometries.length);
    const landmarkIndices = [0];
    while (landmarkIndices.length < landmarkCount) {
      let bestIndex = 0;
      let bestDistance = -1;
      geometries.forEach((geometry, index) => {
        const nearest = Math.min(...landmarkIndices.map((chosen) => rawGeometryDistance(geometry, geometries[chosen]!)));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          bestIndex = index;
        }
      });
      landmarkIndices.push(bestIndex);
    }
    this.#landmarks = landmarkIndices.map((index) => new Float64Array(geometries[index]!));
    const nonzero = distances.flatMap((row) => [...row].filter((value) => value > 1e-9)).sort((a, b) => a - b);
    this.#bandwidth = nonzero[Math.floor(nonzero.length * 0.55)] ?? 1;

    const rows: Array<{ features: Float64Array; target: Vec3; weight: number }> = [];
    experiences.forEach((experience, index) => {
      rows.push({ features: this.#features(geometries[index]!), target: targets[index]!, weight: 1 });
      const path = experience.trajectory();
      for (const fraction of [0.125, 0.35, 0.60, 0.80]) {
        const count = Math.max(2, Math.ceil(path.length * fraction));
        rows.push({
          features: this.#features(canonicalPath(path.slice(0, count))),
          target: targets[index]!,
          weight: fraction === 0.125 ? 1 : fraction * 0.35,
        });
      }
    });
    const width = this.#landmarks.length + 1;
    const normal = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
    const targetsByAxis = Array.from({ length: 3 }, () => Array.from({ length: width }, () => 0));
    for (const row of rows) {
      for (let left = 0; left < width; left += 1) {
        for (let right = 0; right < width; right += 1) {
          normal[left]![right] = normal[left]![right]! + row.weight * row.features[left]! * row.features[right]!;
        }
        for (let axis = 0; axis < 3; axis += 1) {
          targetsByAxis[axis]![left] = targetsByAxis[axis]![left]! + row.weight * row.features[left]! * row.target[axis]!;
        }
      }
    }
    for (let diagonal = 0; diagonal < width; diagonal += 1) normal[diagonal]![diagonal] = normal[diagonal]![diagonal]! + 1e-5;
    this.#weights = targetsByAxis.map((target) => new Float64Array(solveLinear(normal, target)));

    const rawDistances: number[] = [];
    const embeddedDistances: number[] = [];
    for (let left = 0; left < geometries.length; left += 1) {
      for (let right = left + 1; right < geometries.length; right += 1) {
        rawDistances.push(distances[left]![right]!);
        embeddedDistances.push(norm3(sub3(this.#encode(geometries[left]!), this.#encode(geometries[right]!))));
      }
    }
    let prefixEnergy = 0;
    experiences.forEach((experience, index) => {
      const path = experience.trajectory();
      const prefix = canonicalPath(path.slice(0, Math.max(2, Math.ceil(path.length * 0.6))));
      prefixEnergy += norm3(sub3(this.#encode(prefix), this.#encode(geometries[index]!))) ** 2;
    });
    this.#diagnostics = {
      geometryDistanceCorrelation: pearson(rawDistances, embeddedDistances),
      causalPrefixRootMeanSquaredDistance: Math.sqrt(prefixEnergy / experiences.length),
      outputDimensions: 3,
      landmarkCount,
    };
  }

  static fromState(state: PathProjectorStateV1): PathProjector {
    if (state.weights.length !== 3 || state.landmarks.length < 1 || state.bandwidth <= 0) {
      throw new RangeError("invalid frozen PathProjector checkpoint state");
    }
    const projector = new PathProjector();
    projector.#landmarks = state.landmarks.map((row) => new Float64Array(row));
    projector.#bandwidth = state.bandwidth;
    projector.#weights = state.weights.map((row) => new Float64Array(row));
    projector.#diagnostics = { ...state.diagnostics };
    return projector;
  }

  exportState(): PathProjectorStateV1 {
    if (this.#diagnostics === null || this.#weights.length !== 3) {
      throw new Error("PathProjector must be fit before export");
    }
    return {
      landmarks: this.#landmarks.map((row) => [...row]),
      bandwidth: this.#bandwidth,
      weights: this.#weights.map((row) => [...row]),
      diagnostics: { ...this.#diagnostics },
    };
  }

  projectTrustedPath(experience: TrustedExperience): Vec3 {
    return this.#encode(canonicalPath(experience.trajectory()));
  }

  projectPath(points: readonly Vec3[]): Vec3 {
    return this.#encode(canonicalPath(points));
  }

  projectCausalPrefix(prefix: readonly Vec3[]): Vec3 {
    return this.#encode(canonicalPath(prefix));
  }

  geometry(points: readonly Vec3[]): Float64Array {
    return canonicalPath(points);
  }

  diagnostics(): PathEncoderDiagnostics {
    if (this.#diagnostics === null) throw new Error("PathProjector must be fit first");
    return { ...this.#diagnostics };
  }

  #features(geometry: Float64Array): Float64Array {
    const result = new Float64Array(this.#landmarks.length + 1);
    result[0] = 1;
    this.#landmarks.forEach((landmark, index) => {
      const distance = rawGeometryDistance(geometry, landmark);
      result[index + 1] = Math.exp(-(distance * distance) / (2 * this.#bandwidth * this.#bandwidth));
    });
    return result;
  }

  #encode(geometry: Float64Array): Vec3 {
    if (this.#weights.length !== 3) throw new Error("PathProjector must be fit before projection");
    const features = this.#features(geometry);
    const coordinate = vec3();
    for (let axis = 0; axis < 3; axis += 1) {
      for (let index = 0; index < features.length; index += 1) {
        coordinate[axis] = coordinate[axis]! + features[index]! * this.#weights[axis]![index]!;
      }
    }
    return coordinate;
  }
}

export function pathInitialTangent(points: readonly Vec3[]): Vec3 | null {
  return firstTangent(points);
}
