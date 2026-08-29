import type {
  BasinActivation,
  MediumConfig,
  MediumSnapshot,
  PageSnapshot,
  R1TraceSnapshot,
  StepResult,
  Vec3,
} from "../contracts.js";
import { SplitMix64 } from "../random.js";
import { assertVec3, clone3, vec3 } from "../vector.js";
import { PotentialPage3D, potentialFromSnapshot } from "./potential-page.js";

function validateConfig(config: MediumConfig): void {
  const positive: readonly (keyof MediumConfig)[] = [
    "kernelWidth",
    "visitAmplitude",
    "roadStartAmplitude",
    "roadEndAmplitude",
    "timeStep",
    "temperature",
    "basinRadiusScale",
    "minimumActiveMagnitude",
  ];
  for (const key of positive) {
    const value = config[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${key} must be positive and finite`);
    }
  }
  if (!Number.isFinite(config.recoveryRate) || config.recoveryRate < 0) {
    throw new RangeError("recoveryRate must be finite and nonnegative");
  }
  if (!Number.isFinite(config.diffusion) || config.diffusion < 0) {
    throw new RangeError("diffusion must be finite and nonnegative");
  }
  assertVec3(config.boundary.min);
  assertVec3(config.boundary.max);
  for (let axis = 0; axis < 3; axis += 1) {
    if (config.boundary.min[axis]! >= config.boundary.max[axis]!) {
      throw new RangeError("each boundary minimum must be below its maximum");
    }
  }
}

function cloneConfig(config: MediumConfig): MediumConfig {
  return {
    ...config,
    boundary: {
      mode: "reflect",
      min: clone3(config.boundary.min),
      max: clone3(config.boundary.max),
    },
  };
}

function reflect(value: number, minimum: number, maximum: number): { value: number; hits: number } {
  if (value >= minimum && value <= maximum) return { value, hits: 0 };
  const width = maximum - minimum;
  const period = 2 * width;
  let offset = (value - minimum) % period;
  if (offset < 0) offset += period;
  const reflected = offset <= width ? minimum + offset : maximum - (offset - width);
  return { value: reflected, hits: Math.max(1, Math.floor(Math.abs(value - reflected) / width + 0.5)) };
}

export class ReadOnlyPhysicalMedium3D {
  readonly #snapshot: MediumSnapshot;

  constructor(snapshot: MediumSnapshot) {
    this.#snapshot = structuredClone(snapshot) as MediumSnapshot;
  }

  snapshot(): MediumSnapshot {
    return structuredClone(this.#snapshot) as MediumSnapshot;
  }

  potentialAt(pageId: string, coordinate: Vec3): number {
    const page = this.#snapshot.pages.find((candidate) => candidate.pageId === pageId);
    if (page === undefined) throw new RangeError(`unknown page: ${pageId}`);
    return potentialFromSnapshot(page, coordinate);
  }

  page(pageId: string): PageSnapshot {
    const page = this.#snapshot.pages.find((candidate) => candidate.pageId === pageId);
    if (page === undefined) throw new RangeError(`unknown page: ${pageId}`);
    return structuredClone(page) as PageSnapshot;
  }

  depositVisit(): never {
    throw new Error("read-only physical-medium clone rejects deposition");
  }

  depositOrderedTrajectory(): never {
    throw new Error("read-only physical-medium clone rejects road writes");
  }

  recover(): never {
    throw new Error("read-only physical-medium clone rejects recovery writes");
  }
}

export class PhysicalMedium3D {
  readonly #config: MediumConfig;
  readonly #pages = new Map<string, PotentialPage3D>();
  #logicalTime = 0;
  #boundaryHits = 0;
  #pageSequence = 0;

  constructor(config: MediumConfig) {
    validateConfig(config);
    this.#config = cloneConfig(config);
  }

  static fromSnapshot(snapshot: MediumSnapshot): PhysicalMedium3D {
    const config: MediumConfig = {
      ...snapshot.config,
      boundary: {
        mode: "reflect",
        min: new Float64Array(snapshot.config.boundary.min),
        max: new Float64Array(snapshot.config.boundary.max),
      },
    };
    const medium = new PhysicalMedium3D(config);
    medium.#logicalTime = snapshot.logicalTime;
    medium.#boundaryHits = snapshot.boundaryHits;
    medium.#pageSequence = snapshot.pageSequence;
    for (const page of snapshot.pages) {
      medium.#pages.set(page.pageId, PotentialPage3D.fromSnapshot(page, medium.#config));
    }
    return medium;
  }

  get config(): MediumConfig {
    return cloneConfig(this.#config);
  }

  get logicalTime(): number {
    return this.#logicalTime;
  }

  get boundaryHits(): number {
    return this.#boundaryHits;
  }

  get pageCount(): number {
    return this.#pages.size;
  }

  pageIds(): readonly string[] {
    return [...this.#pages.keys()];
  }

  createPage(): string {
    this.#pageSequence += 1;
    const pageId = `${this.#config.name}-page-${this.#pageSequence.toString().padStart(6, "0")}`;
    this.#pages.set(pageId, new PotentialPage3D(pageId, this.#logicalTime, this.#config));
    return pageId;
  }

  createPageFromTrace(snapshot: R1TraceSnapshot, centers: readonly Vec3[]): string {
    if (this.#config.name !== "prediction" && this.#config.name !== "test") {
      throw new Error("trace snapshots can only seed isolated prediction/test media");
    }
    const pageId = this.createPage();
    this.#getPage(pageId).importTrace(snapshot, centers);
    return pageId;
  }

  depositVisit(pageId: string, coordinate: Vec3, strength = 1, traceId: string | null = null): void {
    this.#getPage(pageId).depositVisit(coordinate, strength, this.#logicalTime, traceId);
  }

  depositOrderedTrajectory(
    pageId: string,
    samples: readonly Vec3[],
    strength = 1,
    traceId = `trace-${this.#logicalTime.toString(16)}-${this.#getPage(pageId).kernelCount}`,
  ): void {
    this.#getPage(pageId).depositOrderedTrajectory(samples, strength, this.#logicalTime, traceId);
  }

  recover(elapsed: number): void {
    this.#validateElapsed(elapsed);
    for (const page of this.#pages.values()) page.recover(this.#config.recoveryRate, elapsed);
    this.#logicalTime += elapsed;
  }

  recoverPage(pageId: string, elapsed: number): void {
    this.#validateElapsed(elapsed);
    this.#getPage(pageId).recover(this.#config.recoveryRate, elapsed);
    this.#logicalTime += elapsed;
  }

  recoverTrace(pageId: string, traceId: string, elapsed: number): void {
    this.#validateElapsed(elapsed);
    this.#getPage(pageId).recover(this.#config.recoveryRate, elapsed, traceId);
    this.#logicalTime += elapsed;
  }

  potentialAt(pageId: string, coordinate: Vec3): number {
    return this.#getPage(pageId).potentialAt(coordinate);
  }

  sampleBasins(pageId: string, query: Vec3, maxCount = 32): readonly BasinActivation[] {
    return this.#getPage(pageId).sampleBasins(query, maxCount);
  }

  traceSnapshot(pageId: string, traceId: string): R1TraceSnapshot | null {
    return this.#getPage(pageId).traceSnapshot(traceId, this.#logicalTime);
  }

  isTraceActive(pageId: string, traceId: string): boolean {
    return this.#getPage(pageId).isTraceActive(traceId);
  }

  traceIds(pageId: string): readonly string[] {
    return this.#getPage(pageId).traceIds();
  }

  stochasticStep(pageId: string, position: Vec3, random: SplitMix64): StepResult {
    assertVec3(position);
    const page = this.#getPage(pageId);
    const currentPotential = page.potentialAt(position);
    if (this.#config.diffusion === 0) {
      const unchanged = clone3(position);
      return {
        position: unchanged,
        candidate: clone3(unchanged),
        accepted: true,
        acceptanceProbability: 1,
        currentPotential,
        candidatePotential: currentPotential,
        boundaryHits: 0,
      };
    }
    const noise = random.gaussian3();
    const proposalScale = Math.sqrt(2 * this.#config.diffusion * this.#config.timeStep);
    const candidate = vec3(
      position[0]! + proposalScale * noise[0]!,
      position[1]! + proposalScale * noise[1]!,
      position[2]! + proposalScale * noise[2]!,
    );
    let stepBoundaryHits = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const reflected = reflect(candidate[axis]!, this.#config.boundary.min[axis]!, this.#config.boundary.max[axis]!);
      candidate[axis] = reflected.value;
      stepBoundaryHits += reflected.hits;
    }
    this.#boundaryHits += stepBoundaryHits;
    const candidatePotential = page.potentialAt(candidate);
    const exponent = -(candidatePotential - currentPotential) / this.#config.temperature;
    const acceptanceProbability = Math.min(1, Math.exp(Math.min(0, exponent)));
    const accepted = random.uniform() < acceptanceProbability;
    return {
      position: accepted ? clone3(candidate) : clone3(position),
      candidate: clone3(candidate),
      accepted,
      acceptanceProbability,
      currentPotential,
      candidatePotential,
      boundaryHits: stepBoundaryHits,
    };
  }

  randomWalk(pageId: string, start: Vec3, steps: number, random: SplitMix64): readonly Vec3[] {
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError("steps must be nonnegative");
    const positions: Vec3[] = [clone3(start)];
    let current = clone3(start);
    for (let step = 0; step < steps; step += 1) {
      current = this.stochasticStep(pageId, current, random).position;
      positions.push(current);
    }
    return positions;
  }

  snapshot(): MediumSnapshot {
    return {
      config: cloneConfig(this.#config),
      logicalTime: this.#logicalTime,
      boundaryHits: this.#boundaryHits,
      pageSequence: this.#pageSequence,
      pages: [...this.#pages.values()].map((page) => page.snapshot()),
    };
  }

  readonlyClone(): ReadOnlyPhysicalMedium3D {
    return new ReadOnlyPhysicalMedium3D(this.snapshot());
  }

  #getPage(pageId: string): PotentialPage3D {
    const page = this.#pages.get(pageId);
    if (page === undefined) throw new RangeError(`unknown page: ${pageId}`);
    return page;
  }

  #validateElapsed(elapsed: number): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("elapsed must be finite and nonnegative");
  }
}
