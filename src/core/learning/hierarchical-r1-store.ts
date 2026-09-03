import { FORMAL_EVALUATION, R1_CONFIG } from '../config.js';
import type { MediumSnapshot, R1RouteSignature, Vec3 } from '../contracts.js';
import type { TrustedExperience } from '../firewall.js';
import { PhysicalMedium3D } from '../physics/physical-medium.js';
import { clone3, dot3, normalize3 } from '../vector.js';

export interface R1AtomPhysicalReceiptV1 {
  readonly version: 'R1AtomPhysicalReceiptV1';
  readonly eventNumber: number;
  readonly atomId: string;
  readonly anchorId: string;
  readonly pageId: string;
  readonly traceId: string;
  readonly observedAt: number;
}

interface R1RoutePrototypeV1 {
  readonly pageId: string;
  readonly geometryMean: readonly number[];
  readonly initialTangentMean: readonly number[];
  readonly terminalTangentMean: readonly number[];
  readonly intrinsicClosureDistanceMean: number;
  readonly selfIntersectionCountMaximum: number;
  readonly count: number;
}

export interface HierarchicalR1StoreCheckpointV1 {
  readonly version: 'HierarchicalR1StoreCheckpointV1';
  readonly medium: MediumSnapshot;
  readonly routes: readonly R1RoutePrototypeV1[];
  readonly atoms: readonly R1AtomPhysicalReceiptV1[];
  readonly eventSequence: number;
  readonly logicalTime: number;
}

interface MutableRoute {
  geometryMean: Float64Array;
  initialTangentMean: Vec3;
  terminalTangentMean: Vec3;
  intrinsicClosureDistanceMean: number;
  selfIntersectionCountMaximum: number;
  count: number;
}

function routeDistance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length || left.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index]! - right[index]!;
    sum += delta * delta;
  }
  return Math.sqrt(sum / left.length);
}

/**
 * R1's production writer for the rebuilt hierarchy.  It has no R2 reference
 * or writer method by construction: one trusted event can only deepen R1.
 */
export class HierarchicalR1StoreV1 {
  readonly medium: PhysicalMedium3D;
  readonly #routes = new Map<string, MutableRoute>();
  readonly #atoms: R1AtomPhysicalReceiptV1[] = [];
  #eventSequence = 0;
  #logicalTime = 0;

  constructor(checkpoint?: HierarchicalR1StoreCheckpointV1) {
    if (!checkpoint) { this.medium = new PhysicalMedium3D(R1_CONFIG); return; }
    if (checkpoint.version !== 'HierarchicalR1StoreCheckpointV1'
      || checkpoint.medium.config.name !== 'R1') throw new Error('legacy-R1-store-is-audit-only');
    this.medium = PhysicalMedium3D.fromSnapshot(checkpoint.medium);
    this.#eventSequence = checkpoint.eventSequence;
    this.#logicalTime = checkpoint.logicalTime;
    for (const route of checkpoint.routes) this.#routes.set(route.pageId, {
      geometryMean: new Float64Array(route.geometryMean), initialTangentMean: new Float64Array(route.initialTangentMean),
      terminalTangentMean: new Float64Array(route.terminalTangentMean),
      intrinsicClosureDistanceMean: route.intrinsicClosureDistanceMean,
      selfIntersectionCountMaximum: route.selfIntersectionCountMaximum, count: route.count,
    });
    this.#atoms.push(...structuredClone(checkpoint.atoms));
  }

  get logicalTime(): number { return this.#logicalTime; }
  get nextEventNumber(): number { return this.#eventSequence + 1; }
  get atomCount(): number { return this.#atoms.length; }

  advanceTo(observedAt: number): void {
    if (!Number.isFinite(observedAt) || observedAt < this.#logicalTime) throw new RangeError('R1-time-reversed');
    const elapsed = observedAt - this.#logicalTime;
    if (elapsed > 0) { this.medium.recover(elapsed); this.#logicalTime = observedAt; }
  }

  recover(elapsed: number): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError('R1-elapsed-must-be-nonnegative');
    this.medium.recover(elapsed); this.#logicalTime += elapsed;
  }

  writeAtom(experience: TrustedExperience, route: R1RouteSignature, atomId: string,
    anchorId: string, strength = 1): R1AtomPhysicalReceiptV1 {
    if (atomId.length === 0 || this.#atoms.some(atom => atom.atomId === atomId)) throw new Error('invalid-or-duplicate-R1-atom');
    const state = experience.r1State();
    if (Math.abs(state.observedAt - this.#logicalTime) > 1e-12) throw new Error('R1-writer-time-mismatch');
    const number = this.#eventSequence + 1;
    if (anchorId !== `experience-anchor-${number.toString().padStart(6, '0')}`) throw new Error('R1-anchor-sequence-mismatch');
    const pageId = this.#compatiblePage(route) ?? this.medium.createPage();
    const traceId = `r1-trace-${number.toString().padStart(6, '0')}`;
    this.medium.depositOrderedTrajectory(pageId, experience.trajectory(), strength, traceId);
    this.#eventSequence = number; this.#updateRoute(pageId, route);
    const receipt: R1AtomPhysicalReceiptV1 = { version: 'R1AtomPhysicalReceiptV1', eventNumber: number,
      atomId, anchorId, pageId, traceId, observedAt: state.observedAt };
    this.#atoms.push(receipt); return structuredClone(receipt);
  }

  atom(atomId: string): R1AtomPhysicalReceiptV1 | null {
    const atom = this.#atoms.find(value => value.atomId === atomId);
    return atom ? structuredClone(atom) : null;
  }
  atoms(): readonly R1AtomPhysicalReceiptV1[] { return structuredClone(this.#atoms); }

  snapshot(): HierarchicalR1StoreCheckpointV1 {
    return { version: 'HierarchicalR1StoreCheckpointV1', medium: this.medium.snapshot(),
      routes: [...this.#routes].map(([pageId, route]) => ({ pageId, geometryMean: [...route.geometryMean],
        initialTangentMean: [...route.initialTangentMean], terminalTangentMean: [...route.terminalTangentMean],
        intrinsicClosureDistanceMean: route.intrinsicClosureDistanceMean,
        selfIntersectionCountMaximum: route.selfIntersectionCountMaximum, count: route.count })),
      atoms: structuredClone(this.#atoms), eventSequence: this.#eventSequence, logicalTime: this.#logicalTime };
  }

  #compatiblePage(route: R1RouteSignature): string | null {
    let best: string | null = null, bestDistance = Number.POSITIVE_INFINITY;
    for (const [pageId, prototype] of this.#routes) {
      if (!this.medium.traceIds(pageId).some(traceId => this.medium.isTraceActive(pageId, traceId))) continue;
      const initial = normalize3(prototype.initialTangentMean), terminal = normalize3(prototype.terminalTangentMean);
      if (!initial || !terminal || dot3(route.initialTangent, initial) < .5 || dot3(route.terminalTangent, terminal) < .5) continue;
      if (route.selfIntersectionCount !== prototype.selfIntersectionCountMaximum) continue;
      const distance = routeDistance(route.geometry, prototype.geometryMean);
      if (distance < bestDistance) { best = pageId; bestDistance = distance; }
    }
    return bestDistance <= FORMAL_EVALUATION.r1PageCompatibilityDistance ? best : null;
  }

  #updateRoute(pageId: string, route: R1RouteSignature): void {
    const previous = this.#routes.get(pageId);
    if (!previous) {
      this.#routes.set(pageId, { geometryMean: new Float64Array(route.geometry),
        initialTangentMean: clone3(route.initialTangent), terminalTangentMean: clone3(route.terminalTangent),
        intrinsicClosureDistanceMean: route.intrinsicClosureDistance,
        selfIntersectionCountMaximum: route.selfIntersectionCount, count: 1 }); return;
    }
    const count = previous.count + 1;
    for (let index = 0; index < route.geometry.length; index += 1) previous.geometryMean[index] = previous.geometryMean[index]!
      + (route.geometry[index]! - previous.geometryMean[index]!) / count;
    for (let axis = 0; axis < 3; axis += 1) {
      previous.initialTangentMean[axis] = previous.initialTangentMean[axis]!
        + (route.initialTangent[axis]! - previous.initialTangentMean[axis]!) / count;
      previous.terminalTangentMean[axis] = previous.terminalTangentMean[axis]!
        + (route.terminalTangent[axis]! - previous.terminalTangentMean[axis]!) / count;
    }
    previous.intrinsicClosureDistanceMean += (route.intrinsicClosureDistance - previous.intrinsicClosureDistanceMean) / count;
    previous.selfIntersectionCountMaximum = Math.max(previous.selfIntersectionCountMaximum, route.selfIntersectionCount);
    previous.count = count;
  }
}
