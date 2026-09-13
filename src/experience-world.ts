import type { Observation, PublicValue, XYZ } from './contracts.js';

export interface RememberedSurface {
  id: string; position: XYZ; properties: Readonly<Record<string, PublicValue>>;
  lastSeen: number; observations: number; visible: boolean; confidence: number;
  /** A possible correspondence, not a measurement or a guaranteed identity. */
  perceptId: string; anchorEpoch: number;
}
interface Place { position: XYZ; visits: number; headings: number[]; lastSeen: number }
export interface ExperienceWorldSnapshot { version: 'ExperienceWorld1'; clock: number; serial: number;
  places: [string, Place][]; surfaces: RememberedSurface[]; placeCapacity: number; surfaceCapacity: number }
const distance = (a: XYZ, b: XYZ) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cell = (position: XYZ) => position.map(Math.floor).join(',');
const indexable = (position: XYZ, properties: Readonly<Record<string, PublicValue>>) =>
  position.every(value => Number.isFinite(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER - 2)
  && ['red', 'green', 'blue'].every(key => typeof properties[key] !== 'number' || Number.isFinite(properties[key]));

/** A bounded record of where sensing occurred and what surfaces were seen.
 * Remembered surfaces never get appended to Observation.objects: remembering
 * an object and currently measuring it are different kinds of evidence. */
export class ExperienceWorld {
  #places = new Map<string, Place>(); #surfaces = new Map<string, RememberedSurface>();
  #clock = 0; #serial = 0; #lastSequence: number | null = null;
  constructor(readonly placeCapacity = 2048, readonly surfaceCapacity = 512) {
    if (![placeCapacity, surfaceCapacity].every(v => Number.isSafeInteger(v) && v >= 8 && v <= 65536))
      throw new Error('invalid-world-memory-capacity');
  }
  #key(position: XYZ): string { return position.map(v => Math.floor(v / .75)).join(','); }
  #heading(yaw: number): number { return (Math.round(yaw / (Math.PI / 12)) % 24 + 24) % 24; }
  observe(observation: Observation): void {
    if (observation.predictionSupport !== undefined || observation.predictionContext !== undefined || observation.predictionBounds !== undefined)
      throw new Error('imagined-world-evidence');
    if (observation.sequence === this.#lastSequence) return;
    this.#lastSequence = observation.sequence; this.#clock++;
    const key = this.#key(observation.self.position), heading = this.#heading(observation.self.yaw);
    const place = this.#places.get(key) ?? { position: observation.self.position, visits: 0, headings: [], lastSeen: 0 };
    place.visits++; place.lastSeen = this.#clock;
    if (!place.headings.includes(heading)) place.headings.push(heading);
    this.#places.delete(key); this.#places.set(key, place);
    if (this.#places.size > this.placeCapacity) {
      this.#places.delete(this.#places.keys().next().value!);
    }
    for (const surface of this.#surfaces.values()) surface.visible = false;
    // Rebuild a transient geometric index from the existing memory only. The
    // largest unchanged association radius is .8, so a matching point must
    // occupy one of the 27 neighboring unit cells. No nearest-k truncation.
    const cells = new Map<string, Set<RememberedSurface>>(), order = new Map<string, number>();
    let indexed = true;
    const add = (surface: RememberedSurface) => {
      const key = cell(surface.position), bucket = cells.get(key) ?? new Set<RememberedSurface>();
      bucket.add(surface); cells.set(key, bucket);
      if (!order.has(surface.id)) order.set(surface.id, order.size);
      indexed &&= indexable(surface.position, surface.properties);
    };
    for (const surface of this.#surfaces.values()) add(surface);
    const claimed = new Set<string>();
    for (const object of observation.objects) {
      const track = observation.perception?.tracks.find(value => value.id === object.id);
      if (track && (track.ambiguity >= .65 || track.confidence < .5)) continue;
      const position = (track?.surface?.point ?? object.relativePosition)
        .map((v, i) => v + observation.self.position[i]!) as unknown as XYZ;
      let candidates: Iterable<RememberedSurface> = this.#surfaces.values();
      if (indexed && indexable(position, object.properties)) {
        const nearby: RememberedSurface[] = [], [x, y, z] = position.map(Math.floor) as [number, number, number];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
          for (const surface of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) nearby.push(surface);
        // Stable original Map order also preserves exact tie/ambiguity behavior.
        candidates = nearby.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      }
      let first: { surface: RememberedSurface; score: number } | undefined, second: typeof first;
      for (const surface of candidates) if (!claimed.has(surface.id)) {
          let appearance = 0;
          for (const k of ['red', 'green', 'blue']) if (typeof surface.properties[k] === 'number'
            && typeof object.properties[k] === 'number')
            appearance += Math.abs(Number(surface.properties[k]) - Number(object.properties[k]));
          const sameTrack = surface.perceptId === object.id && surface.anchorEpoch === (track?.anchorEpoch ?? 0);
          const limit = sameTrack ? .8 : .35;
          // A coordinate distance already outside the original radius cannot
          // pass with nonnegative appearance distance. Keep the full original
          // score, insertion order and ambiguity test for every possible match.
          if (appearance >= 0 && (Math.abs(surface.position[0] - position[0]) >= limit
            || Math.abs(surface.position[1] - position[1]) >= limit
            || Math.abs(surface.position[2] - position[2]) >= limit)) continue;
          const candidate = { surface, score: distance(surface.position, position) + appearance * 4 };
          if (candidate.score >= limit) continue;
          if (!first || candidate.score < first.score) { second = first; first = candidate; }
          else if (!second || candidate.score < second.score) second = candidate;
      }
      const unambiguous = first && (!second || second.score - first.score > .2);
      const surface: RememberedSurface = unambiguous ? first!.surface : {
        id: `remembered-${++this.#serial}`, perceptId: object.id, anchorEpoch: track?.anchorEpoch ?? 0,
        position, properties: {}, lastSeen: this.#clock, observations: 0, visible: true, confidence: .5 };
      const oldCell = cell(surface.position);
      cells.get(oldCell)?.delete(surface);
      Object.assign(surface, { position, properties: { ...object.properties }, lastSeen: this.#clock,
        observations: surface.observations + 1, visible: true, perceptId: object.id, anchorEpoch: track?.anchorEpoch ?? 0,
        confidence: Math.min(.99, .5 + .05 * surface.observations) });
      claimed.add(surface.id); this.#surfaces.set(surface.id, surface);
      add(surface);
    }
    while (this.#surfaces.size > this.surfaceCapacity) {
      let oldest: RememberedSurface | undefined;
      for (const candidate of this.#surfaces.values()) if (!oldest || Number(candidate.visible) < Number(oldest.visible)
        || candidate.visible === oldest.visible && candidate.lastSeen < oldest.lastSeen) oldest = candidate;
      this.#surfaces.delete(oldest!.id);
    }
  }
  novelty(observation: Observation): number {
    if (observation.predictionSupport && !['self/position.0', 'self/position.1', 'self/position.2', 'self/yaw']
      .every(field => observation.predictionSupport!.includes(field))) return 0;
    const place = this.#places.get(this.#key(observation.self.position));
    return 1 / Math.sqrt(1 + (place?.visits ?? 0))
      + (place?.headings.includes(this.#heading(observation.self.yaw)) ? 0 : .1);
  }
  get stats() { return { retainedPlaces: this.#places.size, retainedSurfaces: this.#surfaces.size,
    observations: this.#clock, visibleSurfaces: [...this.#surfaces.values()].filter(s => s.visible).length }; }
  remembered(): readonly RememberedSurface[] {
    return structuredClone([...this.#surfaces.values()].map(surface => ({ ...surface,
      confidence: surface.confidence / (1 + (this.#clock - surface.lastSeen) / 100) })));
  }
  snapshot(): ExperienceWorldSnapshot { return structuredClone({ version: 'ExperienceWorld1', clock: this.#clock,
    serial: this.#serial, places: [...this.#places], surfaces: [...this.#surfaces.values()],
    placeCapacity: this.placeCapacity, surfaceCapacity: this.surfaceCapacity }); }
  static restore(state: ExperienceWorldSnapshot): ExperienceWorld {
    if (state.version !== 'ExperienceWorld1') throw new Error('world-memory-version-mismatch');
    const world = new ExperienceWorld(state.placeCapacity, state.surfaceCapacity);
    if (state.places.length > world.placeCapacity || state.surfaces.length > world.surfaceCapacity
      || !Number.isSafeInteger(state.clock) || state.clock < 0 || !Number.isSafeInteger(state.serial)
      || new Set(state.places.map(([id]) => id)).size !== state.places.length
      || new Set(state.surfaces.map(s => s.id)).size !== state.surfaces.length
      || [...state.places.map(([, p]) => p.position), ...state.surfaces.map(s => s.position)]
        .some(p => p.length !== 3 || p.some(v => !Number.isFinite(v)))) throw new Error('invalid-world-memory');
    world.#clock = state.clock; world.#serial = state.serial;
    world.#places = new Map(structuredClone(state.places).sort((a, b) => a[1].lastSeen - b[1].lastSeen));
    // Percept IDs belong to a body session. A new renderer can reuse their
    // names after restart; reacquisition must use measured geometry/appearance.
    world.#surfaces = new Map(structuredClone(state.surfaces).map(s => [s.id, { ...s, perceptId: '', visible: false }]));
    return world;
  }
}
