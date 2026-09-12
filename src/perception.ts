import type { Observation, PublicObject, XYZ } from './contracts.js';

/** Anonymous, unsegmented measurements. No engine identities or block labels. */
export interface VisualSensation {
  readonly version: 'AnonymousRGBD1';
  readonly width: number; readonly height: number;
  readonly horizontalFov: number; readonly verticalFov: number;
  readonly range: number;
  /** Older AnonymousRGBD1 captures used a 0.001-unit depth quantum. */
  readonly depthResolution?: number;
  /** Row-major [red, green, blue, ray distance]; RGB in [0,1], -1 is no return. */
  readonly samples: readonly number[];
}
export interface PerceptualTrack {
  readonly id: string;
  readonly position: XYZ;
  readonly color: XYZ;
  readonly extent: number;
  readonly sampleCount: number;
  readonly visible: boolean;
  readonly confidence: number;
  readonly ambiguity: number;
  readonly age: number;
  readonly missed: number;
  readonly anchorEpoch: number;
  /** Which components of motion are constrained by actual surface normals or
   * visible boundaries, in [forward, right, up] observer axes. */
  readonly motionEvidence: readonly [boolean, boolean, boolean];
  /** A measured local plane, in world-aligned axes relative to the observer. */
  readonly surface?: { readonly normal: XYZ; readonly point: XYZ; readonly residual?: number };
}
export interface PerceptionFrame {
  readonly version: 'AttentivePerception8';
  readonly tracks: readonly PerceptualTrack[];
  readonly attendedId: string | null;
  readonly gazeId: string | null;
  readonly receptors: number;
  readonly groups: number;
}
type RetainedTrack = PerceptualTrack & { world: XYZ; centroid: XYZ; shape: XYZ[]; visits: number };
export interface PerceptionSnapshot {
  version: 'AttentivePerceptionSnapshot1'; serial: number; lastSequence: number;
  tracks: RetainedTrack[]; last: PerceptionFrame | null;
}
const length = (a: readonly number[]) => Math.hypot(...a);
const difference = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - b[i]!);
const sample = <T>(values: T[], count: number) => values.length <= count ? values
  : Array.from({ length: count }, (_, i) => values[Math.floor(i * values.length / count)]!);
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
function fittedNormal(points: readonly XYZ[], center: XYZ): XYZ | null {
  const matrix = [0, 1, 2].map(i => [0, 1, 2].map(j => points.reduce((sum, point) =>
    sum + (point[i]! - center[i]!) * (point[j]! - center[j]!), 0) / points.length));
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  // Jacobi diagonalization of the measured spatial covariance. The least
  // variance direction fits the plane itself, without averaging edge normals.
  for (let step = 0; step < 12; step++) {
    const [p, q] = [[0, 1], [0, 2], [1, 2]].sort((a, b) =>
      Math.abs(matrix[b[0]!]![b[1]!]!) - Math.abs(matrix[a[0]!]![a[1]!]!))[0]!;
    const off = matrix[p!]![q!]!; if (Math.abs(off) < 1e-12) break;
    const tau = (matrix[q!]![q!]! - matrix[p!]![p!]!) / (2 * off);
    const t = (tau < 0 ? -1 : 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    matrix[p!]![p!]! -= t * off; matrix[q!]![q!]! += t * off;
    matrix[p!]![q!] = matrix[q!]![p!] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const a = matrix[k]![p!]!, b = matrix[k]![q!]!;
        matrix[k]![p!] = matrix[p!]![k] = c * a - s * b;
        matrix[k]![q!] = matrix[q!]![k] = s * a + c * b;
      }
      const a = vectors[k]![p!]!, b = vectors[k]![q!]!;
      vectors[k]![p!] = c * a - s * b; vectors[k]![q!] = s * a + c * b;
    }
  }
  const axes = [0, 1, 2].sort((a, b) => matrix[a]![a]! - matrix[b]![b]!);
  if (matrix[axes[1]!]![axes[1]!]! < 1e-8) return null; // A line cannot identify a plane.
  return vectors.map(row => row[axes[0]!]!) as unknown as XYZ;
}
export const worldToBody = (value: readonly number[], yaw: number): XYZ => [
  -Math.sin(yaw) * value[0]! - Math.cos(yaw) * value[2]!,
  Math.cos(yaw) * value[0]! - Math.sin(yaw) * value[2]!, value[1]!];
export const bodyToWorld = (value: readonly number[], yaw: number): XYZ => [
  -Math.sin(yaw) * value[0]! + Math.cos(yaw) * value[1]!, value[2]!,
  -Math.cos(yaw) * value[0]! - Math.sin(yaw) * value[1]!];

/** Generic spatial/color grouping creates revisable SURFACE hypotheses, not
 * semantic categories or guaranteed whole-object segmentation. Temporal
 * association uses observer motion, geometry and appearance jointly. */
export class AttentivePerception {
  #tracks: RetainedTrack[] = [];
  #serial = 0;
  #lastSequence = -1;
  #last: PerceptionFrame | null = null;
  reset(): void { this.#tracks = []; this.#last = null; this.#lastSequence = -1; }
  snapshot(): PerceptionSnapshot { return structuredClone({ version: 'AttentivePerceptionSnapshot1',
    serial: this.#serial, lastSequence: this.#lastSequence, tracks: this.#tracks, last: this.#last }); }
  static restore(snapshot: PerceptionSnapshot): AttentivePerception {
    const state = structuredClone(snapshot);
    const vector = (value: readonly number[]) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    if (state.version !== 'AttentivePerceptionSnapshot1' || !Number.isSafeInteger(state.serial) || state.serial < 0
      || !Number.isSafeInteger(state.lastSequence) || state.lastSequence < -1 || state.tracks.length > 64
      || new Set(state.tracks.map(track => track.id)).size !== state.tracks.length
      || state.tracks.some(track => ![track.world, track.centroid, track.position, track.color, ...track.shape].every(vector)
        || track.shape.length > 64 || !Number.isSafeInteger(track.visits) || track.visits < 0
        || ![track.extent, track.confidence, track.ambiguity, track.age, track.missed, track.anchorEpoch, track.sampleCount].every(Number.isFinite))
      || state.last && (state.last.version !== 'AttentivePerception8' || state.lastSequence < 0
        || JSON.stringify(state.last.tracks) !== JSON.stringify(state.tracks.map(({ world: _world, centroid: _centroid,
          shape: _shape, visits: _visits, ...track }) => track)))
      || !state.last && (state.tracks.length > 0 || state.lastSequence !== -1)) throw new Error('invalid-perception-checkpoint');
    const perception = new AttentivePerception();
    perception.#serial = state.serial; perception.#lastSequence = state.lastSequence;
    perception.#tracks = state.tracks; perception.#last = state.last; return perception;
  }
  observe(observation: Pick<Observation, 'sequence' | 'self'>, visual: VisualSensation): PerceptionFrame {
    if (observation.sequence === this.#lastSequence && this.#last) return this.#last;
    if (observation.sequence < this.#lastSequence) throw new Error('perception-observation-order');
    const { width, height, samples } = visual;
    const depthResolution = visual.depthResolution ?? .001;
    if (samples.length !== width * height * 4 || width < 2 || height < 2
      || !Number.isFinite(depthResolution) || depthResolution <= 0
      || samples.some(v => !Number.isFinite(v))) throw new Error('invalid-anonymous-sensation');
    const points: (XYZ | null)[] = [], colors: XYZ[] = [];
    for (let i = 0; i < width * height; i++) {
      const yaw = observation.self.yaw + (.5 - i % width / (width - 1)) * visual.horizontalFov;
      const pitch = observation.self.pitch + (.5 - Math.floor(i / width) / (height - 1)) * visual.verticalFov;
      const d = samples[i * 4 + 3]!;
      points.push(d < 0 ? null : [-Math.sin(yaw) * Math.cos(pitch) * d,
        1.62 + Math.sin(pitch) * d, -Math.cos(yaw) * Math.cos(pitch) * d]);
      colors.push([samples[i * 4]!, samples[i * 4 + 1]!, samples[i * 4 + 2]!]);
    }
    // Adjacent rays on a grazing surface can be far apart in depth. Local
    // tangent planes distinguish this perspective effect from a real edge.
    const normals = points.map((point, i): XYZ | null => {
      if (!point) return null;
      const closest = (neighbors: number[]) => neighbors.filter(j => j >= 0 && j < points.length && points[j])
        .map(j => difference(points[j]!, point)).sort((a, b) => length(a) - length(b))[0];
      const a = closest([...(i % width ? [i - 1] : []), ...(i % width < width - 1 ? [i + 1] : [])]);
      const b = closest([i - width, i + width]);
      if (!a || !b) return null;
      const cross = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      const norm = length(cross); return norm < 1e-8 ? null : cross.map(v => v / norm) as unknown as XYZ;
    });
    const seen = new Set<number>(), groups: { position: XYZ; color: XYZ; count: number; extent: number; gaze: boolean;
      shape: XYZ[]; motionEvidence: readonly [boolean, boolean, boolean]; surface?: PerceptualTrack['surface'] }[] = [];
    for (let start = 0; start < points.length; start++) {
      if (!points[start] || seen.has(start)) continue;
      const pending = [start], indices: number[] = []; seen.add(start);
      for (let cursor = 0; cursor < pending.length; cursor++) {
        const i = pending[cursor]!; indices.push(i);
        const neighbors = [i - width, i + width, ...(i % width ? [i - 1] : []),
          ...(i % width < width - 1 ? [i + 1] : [])];
        for (const j of neighbors) {
          if (j < 0 || j >= points.length || !points[j] || seen.has(j)) continue;
          // Locality is a sensor-scale bias, not a block-size or object-name rule.
          const resolution = Math.max(.10, Math.min(samples[i * 4 + 3]!, samples[j * 4 + 3]!)
            * Math.max(visual.horizontalFov / width, visual.verticalFov / height) * 2.2);
          const displacement = difference(points[i]!, points[j]!), ni = normals[i], nj = normals[j];
          if (ni && nj && Math.abs(ni.reduce((sum, v, axis) => sum + v * nj[axis]!, 0)) < .9) continue;
          const coplanar = ni && nj && Math.abs(ni.reduce((sum, v, axis) => sum + v * nj[axis]!, 0)) > .95
            && Math.abs(ni.reduce((sum, v, axis) => sum + v * displacement[axis]!, 0)) < .02
            && Math.abs(nj.reduce((sum, v, axis) => sum + v * displacement[axis]!, 0)) < .02;
          if ((!coplanar && length(displacement) > resolution)
            || length(difference(colors[i]!, colors[j]!)) > .23) continue;
          seen.add(j); pending.push(j);
        }
      }
      if (indices.length < 3) continue;
      const mean = (values: readonly (readonly number[] | null)[]): XYZ => [0, 1, 2].map(axis =>
        indices.reduce((sum, i) => sum + values[i]![axis]!, 0) / indices.length) as unknown as XYZ;
      const position = mean(points), color = mean(colors);
      const extent = Math.sqrt(indices.reduce((sum, i) => sum + length(difference(points[i]!, position)) ** 2, 0) / indices.length);
      const members = new Set(indices), normal = fittedNormal(indices.map(i => points[i]!), position) ?? [0, 0, 0];
      const planeError = Math.sqrt(indices.reduce((sum, i) => sum + normal.reduce((dot, v, axis) =>
        dot + v * (points[i]![axis]! - position[axis]!), 0) ** 2, 0) / indices.length);
      // A multi-face or curved group can remain an object hypothesis, but
      // must not supply a precise plane constraint beyond sensor resolution.
      const planar = length(normal) > .99 && planeError < 3 * depthResolution;
      const facing = planar ? worldToBody(normal, observation.self.yaw) : [0, 0, 0];
      const closed = (horizontal: boolean) => indices.every(i => {
        if (horizontal && (i % width === 0 || i % width === width - 1)
          || !horizontal && (i < width || i >= width * (height - 1))) return false;
        // Border ownership matters: a farther neighbor can reveal this
        // surface's edge; a nearer neighbor merely occludes this surface.
        return [i - (horizontal ? 1 : width), i + (horizontal ? 1 : width)].every(j => members.has(j)
          || points[j] && samples[j * 4 + 3]! - samples[i * 4 + 3]! > Math.max(.02,
            samples[i * 4 + 3]! * Math.max(visual.horizontalFov / width, visual.verticalFov / height)));
      });
      const horizontal = closed(true), vertical = closed(false);
      groups.push({ position, color, count: indices.length, extent,
        ...(planar
          ? { surface: { normal: normal as unknown as XYZ, point: position, residual: planeError } } : {}),
        // An oblique normal constrains a combination of axes, not each
        // component separately. This interface only emits near-axis evidence.
        motionEvidence: [Math.abs(facing[0]) > .999 || horizontal && vertical,
          Math.abs(facing[1]) > .999 || horizontal, Math.abs(facing[2]) > .999 || vertical],
        shape: sample(indices, 32).map(i => points[i]!.map((v, axis) => v + observation.self.position[axis]!) as unknown as XYZ),
        gaze: indices.includes(Math.floor(height / 2) * width + Math.floor(width / 2)) });
    }
    // The foveated surface must survive the capacity cut. Otherwise textured
    // surroundings evict a small object before attention/action binding can
    // use the very evidence the observer is looking at.
    groups.sort((a, b) => Number(b.gaze) - Number(a.gaze) || b.count - a.count);
    const used = new Set<string>(), next: RetainedTrack[] = []; let gazeId: string | null = null;
    for (const group of groups.slice(0, 32)) {
      const world = group.position.map((v, i) => v + observation.self.position[i]!) as unknown as XYZ;
      const matches = this.#tracks.filter(track => !used.has(track.id)).map(track => {
        const distance = length(difference(world, track.centroid));
        const color = length(difference(group.color, track.color));
        return { track, distance, color, cost: distance / Math.max(.3, group.extent + track.extent) + color * 5 };
      }).filter(match => match.distance < Math.max(.6, group.extent + match.track.extent)
        && match.color < .20).sort((a, b) => a.cost - b.cost);
      const first = matches[0], ambiguity = first && matches[1]
        ? Math.exp(-(matches[1].cost - first.cost) * 5) : 0;
      const previous = first && ambiguity < .65 ? first.track : undefined;
      // A visible patch's centroid moves when the camera reveals another part
      // of the same surface. Register overlapping measured samples and retain
      // a surface anchor; do not mistake that sampling change for object motion.
      const correspondences = previous ? group.shape.map(point => {
        const nearest = previous.shape.map(other => ({ other, distance: length(difference(point, other)) }))
          .sort((a, b) => a.distance - b.distance)[0]!;
        return { distance: nearest.distance, delta: difference(point, nearest.other) };
      }).sort((a, b) => a.distance - b.distance).slice(0, Math.max(3, Math.floor(group.shape.length / 2))) : [];
      const registered = previous && correspondences.length >= 3
        && correspondences.at(-1)!.distance < Math.max(.2, group.extent / 2);
      let offset: XYZ = registered ? [0, 1, 2].map(axis => median(correspondences.map(pair => pair.delta[axis]!))) as unknown as XYZ : [0, 0, 0];
      if (registered && group.surface) {
        // Correspondence on an unbounded plane cannot measure sliding along
        // that plane. Keep only constrained components and the measured plane
        // displacement, instead of integrating registration noise as motion.
        offset = bodyToWorld(worldToBody(offset, observation.self.yaw)
          .map((value, axis) => group.motionEvidence[axis] ? value : 0), observation.self.yaw);
        const normal = group.surface.normal;
        const residual = normal.reduce((sum, value, axis) => sum + value
          * (world[axis]! - previous.centroid[axis]! - offset[axis]!), 0);
        offset = offset.map((value, axis) => value + normal[axis]! * residual) as unknown as XYZ;
      }
      const anchor = registered ? previous.world.map((v, i) => v + offset[i]!) as unknown as XYZ : world;
      const retainedShape = registered ? previous.shape.map(point => point.map((v, i) => v + offset[i]!) as unknown as XYZ) : [];
      const id = previous?.id ?? `percept-${++this.#serial}`;
      if (group.gaze) gazeId = id;
      if (previous) used.add(id);
      next.push({ id, world: anchor, centroid: world, shape: sample([...retainedShape, ...group.shape], 64),
        position: difference(anchor, observation.self.position) as unknown as XYZ, color: group.color, extent: group.extent,
        motionEvidence: group.motionEvidence,
        ...(group.surface ? { surface: group.surface } : {}),
        anchorEpoch: (previous?.anchorEpoch ?? 0) + Number(Boolean(previous) && !registered),
        sampleCount: group.count, visible: true, confidence: previous ? Math.min(1, previous.confidence + .08) : .35,
        ambiguity, age: (previous?.age ?? 0) + 1, missed: 0, visits: previous?.visits ?? 0 });
    }
    for (const previous of this.#tracks) {
      if (used.has(previous.id) || previous.missed >= 100) continue;
      next.push({ ...previous, position: difference(previous.world, observation.self.position) as unknown as XYZ,
        visible: false, missed: previous.missed + 1, confidence: previous.confidence * .96 });
    }
    this.#tracks = next.sort((a, b) => Number(b.visible) - Number(a.visible) || b.confidence - a.confidence).slice(0, 64);
    const attended = this.#tracks.filter(track => track.visible).sort((a, b) => {
      const drive = (t: typeof a) => (1 - t.confidence + 1 / Math.sqrt(1 + t.visits))
        * Math.log1p(t.sampleCount) / (1 + t.extent);
      return drive(b) - drive(a);
    })[0];
    if (attended) attended.visits++;
    this.#lastSequence = observation.sequence;
    return this.#last = { version: 'AttentivePerception8', tracks: this.#tracks.map(({ world: _world,
      centroid: _centroid, shape: _shape, visits: _visits, ...track }) => track),
      attendedId: attended?.id ?? null, gazeId, receptors: points.filter(Boolean).length, groups: groups.length };
  }
}

export function perceptualObjects(frame: PerceptionFrame): PublicObject[] {
  return frame.tracks.filter(track => track.visible).map(track => ({ id: track.id, type: 'percept',
    // This envelope describes today's visible measurement, not a historical
    // correspondence anchor that can lie outside today's sampled surface.
    relativePosition: track.surface?.point ?? track.position, properties: { red: track.color[0], green: track.color[1], blue: track.color[2],
      extent: track.extent, confidence: track.confidence, ambiguity: track.ambiguity } }));
}
