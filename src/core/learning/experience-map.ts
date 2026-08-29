import type {
  ExperienceAnchor,
  ExperienceMapStateV2,
  R1TraceReference,
  Vec3,
} from "../contracts.js";
import { clone3 } from "../vector.js";

export interface AddExperienceAnchor {
  readonly eventNumber: number;
  readonly observedAt: number;
  readonly perception: Float64Array;
  readonly contextCoordinate: Vec3;
  readonly contextOrigin: Vec3;
  readonly initialTangent: Vec3;
  readonly initialSpeed: number;
  readonly r2PageId: string;
  readonly r2VisitId: string;
  readonly r2Coordinate: Vec3;
  readonly r1Trace: R1TraceReference;
  readonly publicEventContext?: ExperienceAnchor["publicEventContext"];
}

function copy(anchor: ExperienceAnchor): ExperienceAnchor {
  return {
    ...anchor,
    perception: new Float64Array(anchor.perception),
    contextCoordinate: clone3(anchor.contextCoordinate),
    contextOrigin: clone3(anchor.contextOrigin),
    initialTangent: clone3(anchor.initialTangent),
    r2Coordinate: clone3(anchor.r2Coordinate),
    r1Trace: { ...anchor.r1Trace },
    ...(anchor.publicEventContext === undefined ? {} : { publicEventContext: structuredClone(anchor.publicEventContext) }),
  };
}

export class ExperienceMapStore {
  readonly #anchors: ExperienceAnchor[] = [];
  #sequence = 0;

  constructor(state?: ExperienceMapStateV2) {
    if (state === undefined) return;
    this.#sequence = state.sequence;
    for (const anchor of state.anchors) this.#anchors.push(copy(anchor));
    if (this.#anchors.length !== this.#sequence) {
      throw new RangeError("experience-map sequence must equal anchor count");
    }
  }

  add(value: AddExperienceAnchor): ExperienceAnchor {
    this.#sequence += 1;
    if (value.eventNumber !== this.#sequence) {
      throw new RangeError("experience anchors must be appended in event order");
    }
    if (value.perception.length !== 256) throw new RangeError("experience anchor perception must have width 256");
    const anchor: ExperienceAnchor = {
      anchorId: `experience-anchor-${this.#sequence.toString().padStart(6, "0")}`,
      eventNumber: value.eventNumber,
      observedAt: value.observedAt,
      perception: value.perception,
      contextCoordinate: value.contextCoordinate,
      contextOrigin: value.contextOrigin,
      initialTangent: value.initialTangent,
      initialSpeed: value.initialSpeed,
      r2PageId: value.r2PageId,
      r2VisitId: value.r2VisitId,
      r2Coordinate: value.r2Coordinate,
      r1Trace: value.r1Trace,
      ...(value.publicEventContext === undefined ? {} : { publicEventContext: value.publicEventContext }),
    };
    this.#anchors.push(copy(anchor));
    return copy(anchor);
  }

  get(anchorId: string): ExperienceAnchor {
    const found = this.#anchors.find((anchor) => anchor.anchorId === anchorId);
    if (found === undefined) throw new RangeError(`unknown experience anchor: ${anchorId}`);
    return copy(found);
  }

  all(): readonly ExperienceAnchor[] {
    return this.#anchors.map(copy);
  }

  get size(): number {
    return this.#anchors.length;
  }

  exportState(): ExperienceMapStateV2 {
    return { sequence: this.#sequence, anchors: this.#anchors.map(copy) };
  }
}
