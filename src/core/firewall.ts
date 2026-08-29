import type {
  FirewallRejections,
  LeakageAudit,
  PublicR1State,
  PublicEventContext,
  RawExperience,
  Vec3,
} from "./contracts.js";
import { assertVec3, clone3 } from "./vector.js";

const ADMISSION_SECRET = Symbol("kairos-v4-trusted-public-observation");

function cloneState(state: PublicR1State): PublicR1State {
  return {
    position: clone3(state.position),
    velocity: clone3(state.velocity),
    causalPrefix: state.causalPrefix.map(clone3),
    observedAt: state.observedAt,
    numericAttributes: new Float64Array(state.numericAttributes),
  };
}

export class TrustedExperience {
  readonly #trajectory: readonly Vec3[];
  readonly #perception: Float64Array;
  readonly #r1State: PublicR1State;
  readonly #publicEventContext: PublicEventContext | null;

  constructor(secret: symbol, raw: RawExperience) {
    if (secret !== ADMISSION_SECRET) throw new Error("TrustedExperience can only be created by ObservationGate");
    this.#trajectory = raw.trajectory.map(clone3);
    this.#perception = new Float64Array(raw.perception);
    this.#r1State = cloneState(raw.r1State);
    this.#publicEventContext = raw.publicEventContext === undefined
      ? null
      : structuredClone(raw.publicEventContext);
  }

  trajectory(): readonly Vec3[] {
    return this.#trajectory.map(clone3);
  }

  perception(): Float64Array {
    return new Float64Array(this.#perception);
  }

  r1State(): PublicR1State {
    return cloneState(this.#r1State);
  }

  publicEventContext(): PublicEventContext | null {
    return this.#publicEventContext === null ? null : structuredClone(this.#publicEventContext);
  }
}

export class ObservationGate {
  readonly #audit: LeakageAudit;
  readonly #rejections: FirewallRejections;

  constructor(audit: LeakageAudit, rejections: FirewallRejections) {
    this.#audit = audit;
    this.#rejections = rejections;
  }

  admit(raw: RawExperience): TrustedExperience {
    // Only provenance flags are inspected until all checks pass. Forbidden
    // payloads therefore cannot be read, projected, deposited, or learned.
    if (raw.provenance.containsSimulatorPrivate) {
      this.#rejections.simulatorPrivate += 1;
      throw new Error("observation rejected before simulator-private data access");
    }
    if (raw.provenance.containsFutureObservation) {
      this.#rejections.futureObservation += 1;
      throw new Error("observation rejected before future-observation access");
    }
    if (raw.provenance.containsSemanticRuleOrResult) {
      this.#rejections.semanticRuleOrResult += 1;
      throw new Error("observation rejected before semantic rule/result access");
    }
    if (!raw.provenance.actualObservation) {
      this.#rejections.nonActual += 1;
      throw new Error("only actual observations may update long-term media");
    }
    if (!raw.provenance.publicOnly) {
      this.#rejections.nonPublic += 1;
      throw new Error("only public observations may update long-term media");
    }
    if (!raw.provenance.causallyAvailable) {
      this.#rejections.nonCausal += 1;
      throw new Error("only causally available observations may update long-term media");
    }
    if (raw.trajectory.length < 2) throw new RangeError("experience requires at least two trajectory samples");
    raw.trajectory.forEach(assertVec3);
    assertVec3(raw.r1State.position);
    assertVec3(raw.r1State.velocity);
    if (raw.r1State.causalPrefix.length < 2) throw new RangeError("public R1 causal prefix requires two samples");
    raw.r1State.causalPrefix.forEach(assertVec3);
    for (const value of raw.perception) {
      if (!Number.isFinite(value)) throw new RangeError("public perception must be finite numeric data");
    }
    if (raw.publicEventContext !== undefined) {
      if (raw.publicEventContext.version !== "PublicEventContextV1"
        && raw.publicEventContext.version !== "PublicEventContextV2") throw new TypeError("unsupported public event context");
      if (raw.publicEventContext.version === "PublicEventContextV2"
        && raw.publicEventContext.causalEvidenceContextIdentityVersion !== "CausalEvidenceContextIdV1"
        && raw.publicEventContext.causalEvidenceContextIdentityVersion !== "CausalEvidenceContextIdV2") {
        throw new TypeError("unsupported causal evidence context identity");
      }
      for (const value of [
        raw.publicEventContext.interventionKey,
        raw.publicEventContext.version === "PublicEventContextV2"
          ? raw.publicEventContext.causalEvidenceContextId
          : raw.publicEventContext.sceneFingerprint,
        raw.publicEventContext.publicR1Signature,
      ]) {
        if (value.length === 0 || value.length > 256) throw new RangeError("public event context identifiers must be bounded and nonempty");
      }
    }
    return new TrustedExperience(ADMISSION_SECRET, raw);
  }

  audit(): LeakageAudit {
    return { ...this.#audit };
  }

  rejections(): FirewallRejections {
    return { ...this.#rejections };
  }
}

export function emptyLeakageAudit(): LeakageAudit {
  return {
    simulatorPrivateReads: 0,
    futureObservationReads: 0,
    semanticRuleOrResultReads: 0,
    directTargetOutputs: 0,
    predictionWriteBacks: 0,
    admittedPredictionWrites: 0,
    exactTrainingTrajectoryCopies: 0,
  };
}

export function emptyFirewallRejections(): FirewallRejections {
  return {
    simulatorPrivate: 0,
    futureObservation: 0,
    semanticRuleOrResult: 0,
    nonPublic: 0,
    nonCausal: 0,
    nonActual: 0,
    predictionMutation: 0,
  };
}
