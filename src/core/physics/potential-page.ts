import type {
  BasinActivation,
  KernelSnapshot,
  MediumConfig,
  PageSnapshot,
  R1TraceSnapshot,
  Vec3,
} from "../contracts.js";
import { assertVec3, clone3, distanceSquared3, norm3, sub3, vec3 } from "../vector.js";

interface MutableKernel {
  readonly center: Vec3;
  coefficient: number;
  readonly originalMagnitude: number;
  readonly sigma: number;
  readonly depositedAt: number;
  readonly kind: "visit" | "road";
  readonly arcFraction: number | null;
  readonly traceId: string | null;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
}

function contribution(kernel: Pick<MutableKernel, "center" | "coefficient" | "sigma">, point: Vec3): number {
  return kernel.coefficient
    * Math.exp(-distanceSquared3(point, kernel.center) / (2 * kernel.sigma * kernel.sigma));
}

function snapshotKernel(kernel: MutableKernel): KernelSnapshot {
  return {
    center: clone3(kernel.center),
    coefficient: kernel.coefficient,
    originalMagnitude: kernel.originalMagnitude,
    sigma: kernel.sigma,
    depositedAt: kernel.depositedAt,
    kind: kernel.kind,
    arcFraction: kernel.arcFraction,
    traceId: kernel.traceId,
  };
}

export class PotentialPage3D {
  readonly #pageId: string;
  readonly #createdAt: number;
  readonly #config: MediumConfig;
  readonly #kernels: MutableKernel[] = [];

  constructor(pageId: string, createdAt: number, config: MediumConfig) {
    if (pageId.length === 0) throw new RangeError("pageId must be non-empty");
    this.#pageId = pageId;
    this.#createdAt = createdAt;
    this.#config = config;
  }

  static fromSnapshot(snapshot: PageSnapshot, config: MediumConfig): PotentialPage3D {
    const page = new PotentialPage3D(snapshot.pageId, snapshot.createdAt, config);
    for (const kernel of snapshot.kernels) {
      const center = new Float64Array(kernel.center);
      assertVec3(center);
      if (!Number.isFinite(kernel.coefficient) || kernel.coefficient >= 0) {
        throw new RangeError("checkpoint kernel coefficient must be finite and negative");
      }
      page.#kernels.push({
        center,
        coefficient: kernel.coefficient,
        originalMagnitude: kernel.originalMagnitude,
        sigma: kernel.sigma,
        depositedAt: kernel.depositedAt,
        kind: kernel.kind,
        arcFraction: kernel.arcFraction,
        traceId: kernel.traceId,
      });
    }
    return page;
  }

  get pageId(): string {
    return this.#pageId;
  }

  get kernelCount(): number {
    return this.#kernels.length;
  }

  depositVisit(coordinate: Vec3, strength: number, time: number, traceId: string | null): void {
    assertVec3(coordinate);
    requirePositiveFinite(strength, "visit strength");
    const coefficient = -this.#config.visitAmplitude * strength;
    this.#kernels.push({
      center: clone3(coordinate),
      coefficient,
      originalMagnitude: -coefficient,
      sigma: this.#config.kernelWidth,
      depositedAt: time,
      kind: "visit",
      arcFraction: null,
      traceId,
    });
  }

  depositOrderedTrajectory(
    samples: readonly Vec3[],
    strength: number,
    time: number,
    traceId: string,
  ): void {
    requirePositiveFinite(strength, "road strength");
    if (traceId.length === 0) throw new RangeError("R1 road deposition requires an opaque trace id");
    if (samples.length < 2) throw new RangeError("an ordered trajectory requires at least two actual samples");
    samples.forEach(assertVec3);
    const cumulative = new Float64Array(samples.length);
    let totalArc = 0;
    for (let index = 1; index < samples.length; index += 1) {
      totalArc += norm3(sub3(samples[index]!, samples[index - 1]!));
      cumulative[index] = totalArc;
    }
    requirePositiveFinite(totalArc, "observed trajectory arc length");
    for (let index = 0; index < samples.length; index += 1) {
      const arcFraction = cumulative[index]! / totalArc;
      const amplitude = this.#config.roadStartAmplitude
        + (this.#config.roadEndAmplitude - this.#config.roadStartAmplitude) * arcFraction;
      const coefficient = -amplitude * strength;
      this.#kernels.push({
        center: clone3(samples[index]!),
        coefficient,
        originalMagnitude: -coefficient,
        sigma: this.#config.kernelWidth,
        depositedAt: time,
        kind: "road",
        arcFraction,
        traceId,
      });
    }
  }

  importTrace(snapshot: R1TraceSnapshot, centers: readonly Vec3[]): void {
    if (snapshot.kernels.length !== centers.length || centers.length < 2) {
      throw new RangeError("trace import requires one transformed center per road kernel");
    }
    snapshot.kernels.forEach((kernel, index) => {
      assertVec3(centers[index]!);
      if (kernel.kind !== "road" || kernel.traceId !== snapshot.traceId) {
        throw new Error("only a defensive R1 road trace snapshot can seed a prediction page");
      }
      this.#kernels.push({
        center: clone3(centers[index]!),
        coefficient: kernel.coefficient,
        originalMagnitude: kernel.originalMagnitude,
        sigma: kernel.sigma,
        depositedAt: kernel.depositedAt,
        kind: "road",
        arcFraction: kernel.arcFraction,
        traceId: snapshot.traceId,
      });
    });
  }

  potentialAt(coordinate: Vec3): number {
    assertVec3(coordinate);
    let sum = 0;
    let correction = 0;
    for (const kernel of this.#kernels) {
      const term = contribution(kernel, coordinate);
      const adjusted = term - correction;
      const next = sum + adjusted;
      correction = (next - sum) - adjusted;
      sum = next;
    }
    return sum;
  }

  recover(recoveryRate: number, elapsed: number, traceId: string | null = null): void {
    if (!Number.isFinite(recoveryRate) || recoveryRate < 0) throw new RangeError("recoveryRate must be finite and nonnegative");
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("elapsed must be finite and nonnegative");
    const factor = Math.exp(-recoveryRate * elapsed);
    for (const kernel of this.#kernels) {
      if (traceId === null || kernel.traceId === traceId) kernel.coefficient *= factor;
    }
  }

  sampleBasins(query: Vec3, maxCount = 32): readonly BasinActivation[] {
    assertVec3(query);
    if (!Number.isInteger(maxCount) || maxCount < 1) throw new RangeError("maxCount must be positive");
    const active = this.#kernels.filter(
      (kernel) => -kernel.coefficient >= this.#config.minimumActiveMagnitude,
    );
    if (active.length === 0) return [];

    const parent = active.map((_, index) => index);
    const find = (value: number): number => {
      let current = value;
      while (parent[current] !== current) current = parent[current]!;
      while (parent[value] !== value) {
        const next = parent[value]!;
        parent[value] = current;
        value = next;
      }
      return current;
    };
    const unite = (left: number, right: number): void => {
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[b] = a;
    };
    for (let left = 0; left < active.length; left += 1) {
      for (let right = left + 1; right < active.length; right += 1) {
        const radius = this.#config.basinRadiusScale * Math.max(active[left]!.sigma, active[right]!.sigma);
        if (distanceSquared3(active[left]!.center, active[right]!.center) <= radius * radius) unite(left, right);
      }
    }
    const groups = new Map<number, MutableKernel[]>();
    active.forEach((kernel, index) => {
      const root = find(index);
      const group = groups.get(root) ?? [];
      group.push(kernel);
      groups.set(root, group);
    });

    const basins: BasinActivation[] = [];
    for (const kernels of groups.values()) {
      let currentMass = 0;
      let originalMass = 0;
      const weighted = vec3();
      const traces = new Set<string>();
      const visits = new Set<string>();
      for (const kernel of kernels) {
        const weight = -kernel.coefficient;
        currentMass += weight;
        originalMass += kernel.originalMagnitude;
        weighted[0] = weighted[0]! + kernel.center[0]! * weight;
        weighted[1] = weighted[1]! + kernel.center[1]! * weight;
        weighted[2] = weighted[2]! + kernel.center[2]! * weight;
        if (kernel.traceId !== null) traces.add(kernel.traceId);
        if (kernel.kind === "visit" && kernel.traceId !== null) visits.add(kernel.traceId);
      }
      const coordinate = vec3(
        weighted[0]! / currentMass,
        weighted[1]! / currentMass,
        weighted[2]! / currentMass,
      );
      const depth = -kernels.reduce((sum, kernel) => sum + contribution(kernel, coordinate), 0);
      const queryContribution = Math.max(0, -kernels.reduce((sum, kernel) => sum + contribution(kernel, query), 0));
      if (depth >= this.#config.minimumActiveMagnitude) {
        basins.push({
          pageId: this.#pageId,
          coordinate,
          depth,
          support: Math.max(traces.size, kernels.length),
          queryContribution,
          decayFraction: originalMass === 0 ? 0 : currentMass / originalMass,
          kernelCount: kernels.length,
          memberVisitIds: [...visits].sort(),
          memberTraceIds: [...traces].sort(),
        });
      }
    }
    return basins
      .sort((left, right) => right.queryContribution - left.queryContribution || right.depth - left.depth)
      .slice(0, maxCount)
      .map((basin) => ({
        ...basin,
        coordinate: clone3(basin.coordinate),
        memberVisitIds: [...basin.memberVisitIds],
        memberTraceIds: [...basin.memberTraceIds],
      }));
  }

  /**
   * Resolve an opaque visit/road trace through the current active-kernel
   * connectivity.  A trace spanning more than one disconnected basin is
   * ambiguous and therefore fails closed.
   */
  basinContainingTrace(traceId: string): BasinActivation | null {
    if (traceId.length === 0) throw new RangeError("traceId must be non-empty");
    const activeKernel = this.#kernels.find((kernel) => kernel.traceId === traceId
      && -kernel.coefficient >= this.#config.minimumActiveMagnitude);
    if (activeKernel === undefined) return null;
    const matches = this.sampleBasins(activeKernel.center, Number.MAX_SAFE_INTEGER)
      .filter((basin) => basin.memberTraceIds.includes(traceId));
    if (matches.length !== 1) return null;
    const basin = matches[0]!;
    return {
      ...basin,
      coordinate: clone3(basin.coordinate),
      memberVisitIds: [...basin.memberVisitIds],
      memberTraceIds: [...basin.memberTraceIds],
    };
  }

  /** Resolve only an active visit. Roads cannot masquerade as R2 evidence. */
  basinContainingVisit(visitId: string): BasinActivation | null {
    if (visitId.length === 0) throw new RangeError("visitId must be non-empty");
    const activeVisit = this.#kernels.find((kernel) => kernel.kind === "visit"
      && kernel.traceId === visitId
      && -kernel.coefficient >= this.#config.minimumActiveMagnitude);
    if (activeVisit === undefined) return null;
    const matches = this.sampleBasins(activeVisit.center, Number.MAX_SAFE_INTEGER)
      .filter((basin) => basin.memberVisitIds.includes(visitId));
    if (matches.length !== 1) return null;
    const basin = matches[0]!;
    return {
      ...basin,
      coordinate: clone3(basin.coordinate),
      memberVisitIds: [...basin.memberVisitIds],
      memberTraceIds: [...basin.memberTraceIds],
    };
  }

  traceSnapshot(traceId: string, capturedAt: number): R1TraceSnapshot | null {
    const kernels = this.#kernels
      .filter((kernel) => kernel.traceId === traceId && kernel.kind === "road")
      .sort((left, right) => (left.arcFraction ?? 0) - (right.arcFraction ?? 0));
    if (kernels.length < 2) return null;
    if (kernels.every((kernel) => -kernel.coefficient < this.#config.minimumActiveMagnitude)) return null;
    return {
      pageId: this.#pageId,
      traceId,
      capturedAt,
      kernels: kernels.map(snapshotKernel),
    };
  }

  isTraceActive(traceId: string): boolean {
    let roadKernels = 0;
    let activeKernels = 0;
    for (const kernel of this.#kernels) {
      if (kernel.traceId !== traceId || kernel.kind !== "road") continue;
      roadKernels += 1;
      if (-kernel.coefficient >= this.#config.minimumActiveMagnitude) activeKernels += 1;
    }
    return roadKernels >= 2 && activeKernels > 0;
  }

  traceIds(): readonly string[] {
    return [...new Set(this.#kernels.flatMap((kernel) => kernel.traceId === null ? [] : [kernel.traceId]))];
  }

  snapshot(): PageSnapshot {
    return {
      pageId: this.#pageId,
      createdAt: this.#createdAt,
      kernels: this.#kernels.map(snapshotKernel),
    };
  }
}

export function potentialFromSnapshot(page: PageSnapshot, coordinate: Vec3): number {
  assertVec3(coordinate);
  return page.kernels.reduce((value, kernel) => value + contribution(kernel, coordinate), 0);
}
