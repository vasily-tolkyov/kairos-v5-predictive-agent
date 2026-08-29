import { PREDICTION_CONFIG } from "../config.js";
import type {
  FirewallRejections,
  LeakageAudit,
  PredictionResult,
  R1TraceSnapshot,
  Vec3,
} from "../contracts.js";
import { pathInitialTangent } from "../learning/path-projector.js";
import { PhysicalMedium3D } from "../physics/physical-medium.js";
import { SplitMix64 } from "../random.js";
import {
  add3,
  clone3,
  cross3,
  dot3,
  norm3,
  normalize3,
  sameBits3,
  scale3,
  sub3,
  vec3,
} from "../vector.js";

function rotateMinimum(vector: Vec3, from: Vec3, to: Vec3): Vec3 {
  const a = normalize3(from);
  const b = normalize3(to);
  if (a === null || b === null) throw new RangeError("minimum rotation requires observable tangents");
  const cosine = Math.max(-1, Math.min(1, dot3(a, b)));
  if (cosine > 1 - 1e-12) return clone3(vector);
  let axis: Vec3;
  let sine: number;
  if (cosine < -1 + 1e-12) {
    const basis = Math.abs(a[0]!) < 0.8 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    const candidate = normalize3(cross3(a, basis));
    if (candidate === null) throw new Error("failed to construct antiparallel axis");
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

export function transportTraceSnapshot(
  snapshot: R1TraceSnapshot,
  source: Vec3,
  observableInitialTangent: Vec3,
): readonly Vec3[] | null {
  const centers = snapshot.kernels.map((kernel) => kernel.center);
  const sourceCenter = centers[0];
  if (sourceCenter === undefined) return null;
  const relative = centers.map((center) => sub3(center, sourceCenter));
  const traceTangent = pathInitialTangent(relative);
  const currentTangent = normalize3(observableInitialTangent);
  if (traceTangent === null || currentTangent === null) return null;
  return relative.map((point) => add3(source, rotateMinimum(point, traceTangent, currentTangent)));
}

export class PredictionClone {
  readonly #audit: LeakageAudit;
  readonly #rejections: FirewallRejections;

  constructor(audit: LeakageAudit, rejections: FirewallRejections) {
    this.#audit = audit;
    this.#rejections = rejections;
  }

  run(
    snapshot: R1TraceSnapshot | null,
    source: Vec3,
    observableInitialTangent: Vec3,
    random: SplitMix64,
    steps: number,
  ): PredictionResult {
    if (!Number.isInteger(steps) || steps < 1) throw new RangeError("prediction steps must be positive");
    if (snapshot === null) return this.#abstain("selected R1 road has recovered below the active threshold");
    const transported = transportTraceSnapshot(snapshot, source, observableInitialTangent);
    if (transported === null) return this.#abstain("observable initial tangent unavailable", snapshot);

    const temporaryMedium = new PhysicalMedium3D(PREDICTION_CONFIG);
    const pageId = temporaryMedium.createPageFromTrace(snapshot, transported);
    const positions: Vec3[] = [clone3(source)];
    let current = clone3(source);
    let acceptedSteps = 0;
    for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      const step = temporaryMedium.stochasticStep(pageId, current, random);
      current = step.position;
      if (step.accepted) acceptedSteps += 1;
      positions.push(current);
    }
    if (
      positions.length === transported.length
      && positions.every((position, index) => sameBits3(position, transported[index]!))
    ) this.#audit.exactTrainingTrajectoryCopies += 1;
    return {
      abstained: false,
      reason: null,
      selectedTraceId: snapshot.traceId,
      selectedPageId: snapshot.pageId,
      positions,
      acceptedSteps,
      boundaryHits: temporaryMedium.boundaryHits,
      temporaryPageCount: temporaryMedium.pageCount,
    };
  }

  depositVisit(): never {
    this.#rejections.predictionMutation += 1;
    throw new Error("PredictionClone firewall rejects external deposition");
  }

  depositOrderedTrajectory(): never {
    this.#rejections.predictionMutation += 1;
    throw new Error("PredictionClone firewall rejects external road writes");
  }

  writeBack(): never {
    this.#rejections.predictionMutation += 1;
    throw new Error("PredictionClone firewall rejects all long-term write-back");
  }

  #abstain(reason: string, snapshot: R1TraceSnapshot | null = null): PredictionResult {
    return {
      abstained: true,
      reason,
      selectedTraceId: snapshot?.traceId ?? null,
      selectedPageId: snapshot?.pageId ?? null,
      positions: [],
      acceptedSteps: 0,
      boundaryHits: 0,
      temporaryPageCount: 0,
    };
  }
}
