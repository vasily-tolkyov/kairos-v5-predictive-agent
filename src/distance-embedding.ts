/** Distance MDS + radial-basis extension extracted from V4 PathProjector.
 * Only the input metric changes from a world/path surrogate to public event features.
 * No labels, random hash coordinates, learned future outcomes, or old fitted parameters.
 */
import type { FeatureRow } from './events.js';
import { assert } from './util.js';

export interface EmbeddingState {
  readonly keys: readonly string[]; readonly mean: readonly number[]; readonly deviation: readonly number[];
  readonly landmarks: readonly (readonly number[])[]; readonly weights: readonly (readonly number[])[];
  readonly bandwidth: number; readonly scale: number;
}
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
const distance = (a: readonly number[], b: readonly number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0) / Math.max(1, a.length));
function solve(matrix: number[][], target: number[]): number[] {
  const n = target.length, a = matrix.map((row, i) => [...row, target[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    [a[c], a[pivot]] = [a[pivot]!, a[c]!]; const divisor = a[c]![c]!;
    if (Math.abs(divisor) < 1e-12) continue;
    for (let v = c; v <= n; v++) a[c]![v] = a[c]![v]! / divisor;
    for (let r = 0; r < n; r++) if (r !== c) {
      const factor = a[r]![c]!;
      for (let v = c; v <= n; v++) a[r]![v] = a[r]![v]! - factor * a[c]![v]!;
    }
  }
  return a.map(row => row[n]!);
}
function mds(distances: number[][]): number[][] {
  const n = distances.length;
  const means = distances.map(row => row.reduce((s, v) => s + v * v, 0) / n);
  const grand = means.reduce((s, v) => s + v, 0) / n;
  const gram = distances.map((row, i) => row.map((v, j) => -0.5 * (v * v - means[i]! - means[j]! + grand)));
  const vectors: number[][] = [], eigenvalues: number[] = [];
  for (let component = 0; component < 3; component++) {
    let vector = Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (component + 1) * 1.618));
    for (let iteration = 0; iteration < 160; iteration++) {
      const next = gram.map(row => dot(row, vector));
      for (const prev of vectors) { const projection = dot(next, prev); next.forEach((v, i) => { next[i] = v - projection * prev[i]!; }); }
      const magnitude = Math.sqrt(dot(next, next)); if (magnitude <= 1e-12) break;
      vector = next.map(v => v / magnitude);
    }
    vectors.push(vector); eigenvalues.push(Math.max(0, dot(vector, gram.map(row => dot(row, vector)))));
  }
  return Array.from({ length: n }, (_, i) => vectors.map((v, axis) => v[i]! * Math.sqrt(eigenvalues[axis]!)));
}
export class DistanceEmbedding {
  constructor(readonly state: EmbeddingState) {}
  static fit(rows: readonly FeatureRow[]): DistanceEmbedding {
    assert(rows.length >= 8, 'distance-embedding-needs-observations');
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();
    const mean = keys.map(key => rows.reduce((s, row) => s + (row[key] ?? 0), 0) / rows.length);
    const deviation = keys.map((key, i) => Math.sqrt(rows.reduce((s, row) => s + ((row[key] ?? 0) - mean[i]!) ** 2, 0) / rows.length) || 1);
    const values = rows.map(row => keys.map((key, i) => ((row[key] ?? 0) - mean[i]!) / deviation[i]!));
    // Farthest-point landmarks bound fitting cost; selection uses features, never outcomes or goals.
    const selected = [0]; const nearest = values.map(v => distance(v, values[0]!));
    while (selected.length < Math.min(64, rows.length)) {
      let chosen = 0; nearest.forEach((d, i) => { if (d > nearest[chosen]!) chosen = i; });
      if (nearest[chosen]! < 1e-10) break;
      selected.push(chosen); nearest.forEach((d, i) => { nearest[i] = Math.min(d, distance(values[i]!, values[chosen]!)); });
    }
    assert(selected.length >= 2, 'event-representation-has-no-identifiable-variation');
    const landmarks = selected.map(i => values[i]!);
    const distances = landmarks.map(a => landmarks.map(b => distance(a, b)));
    const targets = mds(distances);
    const nonzero = distances.flat().filter(v => v > 1e-9).sort((a, b) => a - b);
    const bandwidth = nonzero[Math.floor(nonzero.length * .55)] ?? 1;
    const phi = landmarks.map(v => [1, ...landmarks.map(l => Math.exp(-(distance(v, l) ** 2) / (2 * bandwidth ** 2)))]);
    const width = landmarks.length + 1;
    const normal = Array.from({ length: width }, (_, i) => Array.from({ length: width }, (_, j) =>
      phi.reduce((s, row) => s + row[i]! * row[j]!, 0) + (i === j ? 1e-5 : 0)));
    const weights = [0, 1, 2].map(axis => solve(normal, Array.from({ length: width }, (_, i) =>
      phi.reduce((s, row, j) => s + row[i]! * targets[j]![axis]!, 0))));
    return new DistanceEmbedding({ keys, mean, deviation, landmarks, weights, bandwidth, scale: 1 });
  }
  encode(row: FeatureRow): { coordinate: number[]; unknownKeys: string[] } {
    const s = this.state;
    const values = s.keys.map((key, i) => ((row[key] ?? 0) - s.mean[i]!) / s.deviation[i]!);
    const features = [1, ...s.landmarks.map(l => Math.exp(-(distance(values, l) ** 2) / (2 * s.bandwidth ** 2)))];
    return { coordinate: s.weights.map(weight => dot(weight, features) * s.scale),
      unknownKeys: Object.keys(row).filter(key => !s.keys.includes(key)) };
  }
}
