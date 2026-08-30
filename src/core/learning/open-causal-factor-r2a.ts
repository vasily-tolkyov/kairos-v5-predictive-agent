import { R2A_CONFIG } from "../config.js";
import type {
  ActiveR2BasinMembershipV1,
  CausalFactorGraphStateV2,
  CausalFactorGraphStateV3,
  CausalFactorNodeV2,
  CausalHyperedgeV3,
  CommonFieldToken,
  ControlledExperimentPairSummaryV2,
  FactorMotifV1,
  FrozenFactorCandidatePoolStateV2,
  OpenFactorEventSummaryV3,
  PhysicalBasinReferenceV1,
  ProvisionalFactorCandidateV2,
  R2BasinMembershipResolverV1,
  R3FactorMatch,
  ResidualFieldState,
  SparseTokenConditionV1,
  Vec3,
} from "../contracts.js";
import { PhysicalMedium3D } from "../physics/physical-medium.js";
import { potentialFromSnapshot } from "../physics/potential-page.js";
import { fnv1a64 } from "../serialization.js";
import { clone3, vec3 } from "../vector.js";
import type { R3CausalEvaluation } from "./causal-contrast.js";
import {
  DeterministicTokenFieldEncoder,
  PhysicalCommonalityWorkspace,
  type EncodedTokenField,
} from "./token-field.js";

const MAX_NEIGHBORS = 31;
const MIN_COHORT = 8;
const FACTOR_SIMILARITY_MIN = 0.50;
const PASSIVE_INPUT_SIMILARITY_MIN = 0.25;
const QUERY_FACTOR_SIMILARITY_MIN = 0.20;
const STABLE_EVENT_MIN = 8;
const STABLE_SCENE_MIN = 4;
const STABLE_CONSISTENCY_MIN = 0.80;
const STABLE_GAIN_MIN = 0.20;
const MAX_CONTRADICTION_RATIO = 0.20;
const TOKEN_FIELD_WIDTH = 256;
const TOKEN_DISPLACEMENT = 0.12;

/** Current surviving physical evidence measured in minimum-rule units.
 *
 * `decayFraction` is current basin mass divided by all historical deposited
 * mass. Clamping the historical support before multiplying makes an actively
 * refreshed basin get weaker merely because it has a longer history. The
 * product must be formed first: for unit R2A visits this is the current
 * surviving basin mass divided by the eight-event physical evidence gate.
 * Recovery and disappearance remain entirely governed by PhysicalMedium3D.
 */
function currentR2aPhysicalSupport(basin: { readonly decayFraction: number; readonly support: number }): number {
  return clamp01(basin.decayFraction * basin.support / STABLE_EVENT_MIN);
}

export interface PreOutcomeFactorObservationV1 {
  readonly anchorId: string;
  readonly eventNumber: number;
  readonly observedAt: number;
  readonly perception: Float64Array;
  readonly interventionKey: string;
  readonly sourceContextId: string;
  readonly sourceContextIdentityVersion?: "CausalEvidenceContextIdV1" | "CausalEvidenceContextIdV2";
  readonly publicR1Signature: string;
}

export interface FrozenFactorCandidatePoolV1 extends FrozenFactorCandidatePoolStateV2 {
  readonly version: "FrozenFactorCandidatePoolV1";
}

export interface TrustedFactorOutcomeV1 {
  readonly r2Coordinate: Vec3;
  readonly r2PageId: string;
  readonly r2VisitId: string;
  readonly trustedActualObservation: true;
  readonly r1Trace: { readonly pageId: string; readonly traceId: string };
}

export interface ControlledFactorEvidenceV1 {
  readonly pairId: string;
  readonly factorIds: readonly string[];
  readonly interventionKey: string;
  readonly targetR2VisitId: string;
  readonly targetR2Coordinate: Vec3;
  readonly sourceContextId: string;
  readonly supported: boolean;
  readonly trustedActualObservation: true;
  readonly baselineProbeActionId: string;
  readonly interventionProbeActionId: string;
  readonly changedFactorId: string;
  readonly observedChangedFactorIds: readonly string[];
  readonly selectionDrop: number;
}

export interface R2AActivationAuditV1 {
  readonly factorId: string;
  readonly state: CausalFactorNodeV2["state"];
  readonly fullSimilarity: number;
  readonly sparseSimilarity: number;
  readonly contextMatch: number;
  readonly physicalSupport: number;
}

interface MutableNode {
  factorId: string;
  physicalBasin: PhysicalBasinReferenceV1;
  sparseTokenConditions: SparseTokenConditionV1[];
  residualPrototype: number[];
  commonInput: CommonFieldToken[];
  sourceEventIds: string[];
  sourceContextIds: string[];
  supportStrength: number;
  contradictionStrength: number;
  activationConsistency: number;
  r2SelectionGain: number;
  state: CausalFactorNodeV2["state"];
  lastAccessTime: number;
}

interface MutableEdge {
  hyperedgeId: string;
  factorIds: string[];
  interventionKey: string;
  targetR2VisitId: string;
  targetR2Basin: PhysicalBasinReferenceV1;
  supportStrength: number;
  contradictionStrength: number;
  controlledExperimentCoverage: number;
  relationStrength: number;
  sourceEventIds: string[];
  sourceContextIds: string[];
  retainedValidationContextIds: string[];
  retainedValidationFailureCount: number;
  state: CausalHyperedgeV3["state"];
}

function productionEligibleEdge(edge: Pick<MutableEdge, "factorIds" | "state">): boolean {
  return edge.factorIds.length === 1
    ? edge.state === "stable"
    : edge.state === "minimal-under-tested-interventions";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function magnitude(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return 0;
  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude <= 1e-12 || rightMagnitude <= 1e-12) return 0;
  let product = 0;
  for (let index = 0; index < left.length; index += 1) product += left[index]! * right[index]!;
  return Math.max(-1, Math.min(1, product / (leftMagnitude * rightMagnitude)));
}

function canonicalFactors(factorIds: readonly string[]): string[] {
  return [...new Set(factorIds)].sort();
}

function activeBasinKey(membership: ActiveR2BasinMembershipV1): string | null {
  if (membership.version !== "ActiveR2BasinMembershipV1"
    || membership.pageId.length === 0
    || membership.memberVisitIds.length === 0
    || membership.memberVisitIds.some((visitId) => visitId.length === 0)) return null;
  const members = [...membership.memberVisitIds].sort();
  if (new Set(members).size !== members.length) return null;
  return `${membership.pageId}\u0000${members.join("\u0000")}`;
}

function cloneCommon(tokens: readonly CommonFieldToken[]): CommonFieldToken[] {
  return tokens.map((token) => ({ ...token, coordinate: clone3(token.coordinate) }));
}

function cloneBasin(reference: PhysicalBasinReferenceV1): PhysicalBasinReferenceV1 {
  return { pageId: reference.pageId, coordinate: [...reference.coordinate] };
}

function sparseConditions(residual: ResidualFieldState): SparseTokenConditionV1[] {
  return residual.values
    .map((standardizedValue, tokenIndex) => ({ tokenIndex, standardizedValue, absolute: Math.abs(standardizedValue) }))
    .sort((left, right) => right.absolute - left.absolute || left.tokenIndex - right.tokenIndex)
    .slice(0, 32)
    .filter((item) => item.absolute > 0.05)
    .map(({ tokenIndex, standardizedValue }) => ({ tokenIndex, standardizedValue, tolerance: 0.45 }));
}

function sparseSimilarity(residual: readonly number[], conditions: readonly SparseTokenConditionV1[]): number {
  if (conditions.length === 0) return 0;
  const directionalCosine = cosine(
    conditions.map((condition) => residual[condition.tokenIndex] ?? 0),
    conditions.map((condition) => condition.standardizedValue),
  );
  // SparseTokenConditionV1 has always carried a physical tolerance, but the
  // previous query path ignored it and let one signed-hash collision dominate
  // an otherwise matching 32-token field.  Average bounded per-token overlap
  // is the physical "how many expected local displacements remain present"
  // interpretation; cosine remains available for uniformly scaled fields.
  const tolerantOverlap = conditions.reduce((sum, condition) => {
    const actual = residual[condition.tokenIndex] ?? 0;
    const difference = Math.abs(actual - condition.standardizedValue);
    return sum + Math.max(0, 1 - difference
      / (Math.abs(condition.standardizedValue) + condition.tolerance));
  }, 0) / conditions.length;
  return Math.max(0, directionalCosine, tolerantOverlap);
}

/**
 * Retain pre-outcome token differences that repeat inside one trusted
 * physical outcome mode and distinguish it from the other observed modes of
 * the same exact intervention. Outcome geometry is used only after the
 * frozen retrieval ticket has been committed; it selects evidence rows, never
 * query features or a result template.
 *
 * The mask is sparse and deterministic. Layout/material noise has high
 * within-mode variation and therefore loses to a repeatable public condition
 * contrast. The existing 0.05 token floor and 32-token capacity are unchanged
 * from sparseConditions().
 */
function invariantDiscriminativePrototype(
  rows: readonly { readonly values: readonly number[] }[],
  alternatives: readonly { readonly values: readonly number[] }[],
): number[] {
  if (rows.length === 0 || alternatives.length === 0) return Array(256).fill(0) as number[];
  const ranked = Array.from({ length: TOKEN_FIELD_WIDTH }, (_unused, index) => {
    const mean = rows.reduce((sum, row) => sum + row.values[index]!, 0) / rows.length;
    const alternativeMean = alternatives.reduce((sum, row) => sum + row.values[index]!, 0) / alternatives.length;
    const withinVariance = rows.reduce((sum, row) => {
      const delta = row.values[index]! - mean;
      return sum + delta * delta;
    }, 0) / rows.length;
    const contrast = Math.abs(mean - alternativeMean);
    return { index, mean, contrast, score: contrast / (Math.sqrt(withinVariance) + 0.05) };
  })
    .filter((item) => Math.abs(item.mean) > 0.05 && item.contrast > 0.05)
    .sort((left, right) => right.score - left.score || right.contrast - left.contrast || left.index - right.index)
    .slice(0, 32);
  const prototype = Array(TOKEN_FIELD_WIDTH).fill(0) as number[];
  for (const item of ranked) prototype[item.index] = item.mean;
  return prototype;
}

function maskToPrototype(values: readonly number[], prototype: readonly number[]): number[] {
  return values.map((value, index) => Math.abs(prototype[index] ?? 0) > 0 ? value : 0);
}

function strongestCoordinate(field: EncodedTokenField, residual: ResidualFieldState): Vec3 {
  let best = 0;
  for (let index = 1; index < residual.values.length; index += 1) {
    if (Math.abs(residual.values[index]!) > Math.abs(residual.values[best]!)) best = index;
  }
  return clone3(field.tokens[best]!.coordinate);
}

function deterministicBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** Physical overlap in the unchanged deterministic token geometry. */
function tokenFieldPhysicalLogOverlap(
  left: readonly number[],
  right: readonly number[],
  kernelWidth: number,
): number {
  if (left.length !== TOKEN_FIELD_WIDTH || right.length !== TOKEN_FIELD_WIDTH) {
    throw new RangeError("physical token overlap requires two 256-dimensional fields");
  }
  let exponent = 0;
  for (let index = 0; index < TOKEN_FIELD_WIDTH; index += 1) {
    const leftBounded = Math.max(-3, Math.min(3, left[index]!));
    const rightBounded = Math.max(-3, Math.min(3, right[index]!));
    const displacement = TOKEN_DISPLACEMENT * (leftBounded - rightBounded);
    exponent += displacement * displacement / (2 * kernelWidth * kernelWidth);
  }
  return -exponent / Math.sqrt(TOKEN_FIELD_WIDTH);
}

/**
 * Production R2A. Candidate retrieval is frozen before the result exists.
 * Outcome coordinates are accepted only by commitOutcome, after the ticket is
 * immutable; they can update predictive evidence but cannot change retrieval.
 */
export class OpenCausalFactorR2A {
  readonly #encoder: DeterministicTokenFieldEncoder;
  readonly #r2Basins: R2BasinMembershipResolverV1;
  readonly #workspace = new PhysicalCommonalityWorkspace();
  #medium: PhysicalMedium3D;
  readonly #nodes = new Map<string, MutableNode>();
  readonly #edges = new Map<string, MutableEdge>();
  readonly #provisional = new Map<string, ProvisionalFactorCandidateV2>();
  readonly #pending = new Map<string, FrozenFactorCandidatePoolV1>();
  readonly #events: OpenFactorEventSummaryV3[] = [];
  readonly #motifs = new Map<string, FactorMotifV1>();
  readonly #testedSubsets = new Set<string>();
  readonly #controlledPairs = new Map<string, ControlledExperimentPairSummaryV2>();
  #factorSequence = 0;
  #hyperedgeSequence = 0;
  #motifSequence = 0;
  #ticketSequence = 0;
  #logicalTime = 0;
  #evidenceContextIdentityVersion: "CausalEvidenceContextIdV1" | "CausalEvidenceContextIdV2" = "CausalEvidenceContextIdV1";

  constructor(
    encoder: DeterministicTokenFieldEncoder,
    r2Basins: R2BasinMembershipResolverV1,
    state?: CausalFactorGraphStateV2 | CausalFactorGraphStateV3,
  ) {
    this.#encoder = encoder;
    this.#r2Basins = r2Basins;
    if (state?.version === "CausalFactorGraphStateV2") {
      throw new Error("CausalFactorGraphStateV2 is audit-only; rebuild writable R2A from trusted raw events");
    }
    this.#medium = state === undefined ? new PhysicalMedium3D(R2A_CONFIG) : PhysicalMedium3D.fromSnapshot(state.r2aMedium);
    if (state === undefined) return;
    if (state.version !== "CausalFactorGraphStateV3"
      || state.outcomeIdentityVersion !== "ActiveR2BasinMembershipV1"
      || (state.evidenceContextIdentityVersion !== "CausalEvidenceContextIdV1"
        && state.evidenceContextIdentityVersion !== "CausalEvidenceContextIdV2")
      || state.legacySceneFingerprintsMigrated !== false
      || state.legacyOutcomeModesMigrated !== false) {
      throw new Error("open-factor production loader rejects legacy outcome identity; rebuild from trusted raw events");
    }
    this.#evidenceContextIdentityVersion = state.evidenceContextIdentityVersion;
    this.#factorSequence = state.factorSequence;
    this.#hyperedgeSequence = state.hyperedgeSequence;
    this.#motifSequence = state.motifSequence;
    this.#ticketSequence = state.ticketSequence;
    this.#logicalTime = state.logicalTime;
    for (const node of state.factorNodes) this.#nodes.set(node.factorId, this.#mutableNode(node));
    for (const edge of state.hyperedges) {
      if (!Array.isArray(edge.retainedValidationContextIds)
        || !Number.isSafeInteger(edge.retainedValidationFailureCount)) {
        throw new Error("open-factor production loader rejects graph state without retained-context evidence");
      }
      this.#edges.set(edge.hyperedgeId, this.#mutableEdge(edge));
    }
    for (const item of state.provisionalCandidates) this.#provisional.set(item.candidateId, structuredClone(item));
    for (const item of state.pendingCandidatePools) this.#pending.set(item.ticketId, { version: "FrozenFactorCandidatePoolV1", ...structuredClone(item) });
    for (const item of state.eventSummaries) {
      if (typeof item.r2VisitId !== "string" || item.r2VisitId.length === 0 || "r1Trace" in item) {
        throw new Error("R2A event is missing its V3 real R2 visit identity");
      }
      this.#events.push(structuredClone(item));
    }
    const eventIds = new Set(this.#events.map((event) => (
      `event-${event.eventNumber.toString().padStart(6, "0")}`
    )));
    for (const edge of this.#edges.values()) {
      if (typeof edge.targetR2VisitId !== "string" || edge.targetR2VisitId.length === 0
        || edge.sourceEventIds.length === 0
        || edge.sourceEventIds.some((eventId) => !eventIds.has(eventId))) {
        throw new Error("R2A edge lacks complete trusted-event R2 visit provenance");
      }
    }
    for (const motif of state.motifs) this.#motifs.set(motif.motifId, structuredClone(motif));
    for (const subset of state.testedSubsets) this.#testedSubsets.add(subset);
    for (const pair of state.controlledExperimentPairs) this.#controlledPairs.set(pair.pairId, structuredClone(pair));
    this.#refreshNodeStates();
    this.#refreshEdgeStates();
  }

  #activeOutcome(r2VisitId: string): { readonly membership: ActiveR2BasinMembershipV1; readonly key: string } | null {
    const membership = this.#r2Basins.resolveActiveR2Basin(r2VisitId);
    if (membership === null || !membership.memberVisitIds.includes(r2VisitId)
      || membership.coordinate.length !== 3
      || membership.coordinate.some((value) => !Number.isFinite(value))) return null;
    const key = activeBasinKey(membership);
    return key === null ? null : {
      membership: {
        version: "ActiveR2BasinMembershipV1",
        pageId: membership.pageId,
        coordinate: [...membership.coordinate],
        memberVisitIds: [...membership.memberVisitIds].sort(),
      },
      key,
    };
  }

  #samePhysicalOutcome(leftVisitId: string, rightVisitId: string): boolean {
    const left = this.#activeOutcome(leftVisitId);
    const right = this.#activeOutcome(rightVisitId);
    return left !== null && right !== null && left.key === right.key;
  }

  #edgeOutcome(edge: MutableEdge): { readonly membership: ActiveR2BasinMembershipV1; readonly key: string } | null {
    if (edge.sourceEventIds.length === 0) return null;
    const eventById = new Map(this.#events.map((event) => [
      `event-${event.eventNumber.toString().padStart(6, "0")}`,
      event,
    ]));
    let resolved: { readonly membership: ActiveR2BasinMembershipV1; readonly key: string } | null = null;
    for (const sourceEventId of edge.sourceEventIds) {
      const event = eventById.get(sourceEventId);
      // Production provenance must be a normal trusted event. Controlled-pair
      // summaries cannot manufacture a result edge by supplying a coordinate
      // or an otherwise unowned visit identity.
      if (event === undefined) return null;
      const outcome = this.#activeOutcome(event.r2VisitId);
      // A recovered individual visit does not erase repeated surviving
      // evidence from the same basin. But no surviving visit, or surviving
      // sources split across more than one current basin, is fail-closed.
      if (outcome === null) continue;
      if (resolved !== null && outcome.key !== resolved.key) return null;
      resolved = outcome;
    }
    return resolved;
  }

  #dominantPhysicalOutcomeFraction(events: readonly OpenFactorEventSummaryV3[]): number {
    if (events.length === 0) return 0;
    const counts = new Map<string, number>();
    for (const event of events) {
      const outcome = this.#activeOutcome(event.r2VisitId);
      // An inactive or internally inconsistent resolver result makes the
      // whole evidence set unsuitable for production rather than silently
      // falling back to coordinates or an R1 storage page.
      if (outcome === null) return 0;
      counts.set(outcome.key, (counts.get(outcome.key) ?? 0) + 1);
    }
    return Math.max(...counts.values()) / events.length;
  }

  freezeCandidatePool(observation: PreOutcomeFactorObservationV1): FrozenFactorCandidatePoolV1 {
    if (observation.perception.length !== 256) throw new RangeError("open R2A requires 256 public perception dimensions");
    if (this.#pending.size > 0) throw new Error("an outcome must commit before another candidate pool is frozen");
    const identityVersion = observation.sourceContextIdentityVersion ?? "CausalEvidenceContextIdV1";
    const hasCommittedEvidence = this.#events.length > 0 || this.#nodes.size > 0 || this.#edges.size > 0;
    if (!hasCommittedEvidence && this.#pending.size === 0) this.#evidenceContextIdentityVersion = identityVersion;
    if (identityVersion !== this.#evidenceContextIdentityVersion) {
      throw new Error("causal evidence context identity versions cannot be mixed or migrated in a writable R2A graph");
    }
    const field = this.#encoder.encode(observation.anchorId, observation.perception);
    const compatible = this.#events
      .filter((event) => event.interventionKey === observation.interventionKey)
      .slice(-MAX_NEIGHBORS)
      .map((event) => this.#fieldFromValues(event.anchorId, event.encodedValues));
    let commonInput: CommonFieldToken[] = [];
    let residualValues = field.tokens.map((token) => token.standardizedValue);
    if (compatible.length + 1 >= MIN_COHORT) {
      const analysis = this.#workspace.analyze([...compatible, field]);
      commonInput = cloneCommon(analysis.commonInput);
      residualValues = [...analysis.residuals.get(observation.anchorId)!.values];
    }
    const candidateFactorIds = [...this.#nodes.values()]
      .filter((node) => {
        const passive = observation.interventionKey === "passive-observation";
        const categories = [...this.#edges.values()]
          .filter((edge) => edge.factorIds.includes(node.factorId))
          .map((edge) => edge.interventionKey === "passive-observation");
        return categories.length === 0 || categories.includes(passive);
      })
      .map((node) => ({ factorId: node.factorId, similarity: cosine(residualValues, node.residualPrototype) }))
      .filter((item) => item.similarity >= FACTOR_SIMILARITY_MIN)
      .sort((left, right) => right.similarity - left.similarity || left.factorId.localeCompare(right.factorId))
      .slice(0, 8)
      .map((item) => item.factorId);
    this.#ticketSequence += 1;
    const ticket: FrozenFactorCandidatePoolV1 = Object.freeze({
      version: "FrozenFactorCandidatePoolV1",
      ticketId: `factor-ticket-${this.#ticketSequence.toString().padStart(6, "0")}`,
      anchorId: observation.anchorId,
      eventNumber: observation.eventNumber,
      observedAt: observation.observedAt,
      interventionKey: observation.interventionKey,
      sourceContextId: observation.sourceContextId,
      publicR1Signature: observation.publicR1Signature,
      encodedValues: field.tokens.map((token) => token.standardizedValue),
      commonInput,
      residualValues,
      candidateFactorIds,
      cohortAnchorIds: compatible.map((item) => item.anchorId),
    });
    this.#pending.set(ticket.ticketId, ticket);
    return structuredClone(ticket);
  }

  commitOutcome(ticket: FrozenFactorCandidatePoolV1, outcome: TrustedFactorOutcomeV1,
    currentUnifiedTime?: number): number {
    if (!outcome.trustedActualObservation) throw new Error("only trusted actual outcomes may update the causal graph");
    const pending = this.#pending.get(ticket.ticketId);
    if (pending === undefined || JSON.stringify(pending) !== JSON.stringify(ticket)) {
      throw new Error("unknown, changed, or already committed candidate-pool ticket");
    }
    this.#pending.delete(ticket.ticketId);
    if (currentUnifiedTime === undefined) {
      // Legacy checkpoints remain auditable. New V7 production always supplies
      // the model-owned time and never lets an outcome advance this clock.
      this.#logicalTime = Math.max(this.#logicalTime, ticket.observedAt);
    } else if (Math.abs(ticket.observedAt - currentUnifiedTime) > 1e-12
      || Math.abs(this.#logicalTime - currentUnifiedTime) > 1e-12
      || Math.abs(this.#medium.logicalTime - currentUnifiedTime) > 1e-12) {
      throw new Error("R2A-outcome-time-does-not-match-unified-cognitive-time");
    }
    const field = this.#fieldFromValues(ticket.anchorId, ticket.encodedValues);
    const assigned = canonicalFactors(ticket.candidateFactorIds.filter((factorId) => this.#nodes.has(factorId)));
    for (const factorId of assigned) {
      const node = this.#nodes.get(factorId)!;
      const analysis = this.#workspace.residualAgainst(field, node.commonInput);
      this.#reinforceNode(factorId, ticket, field, analysis.residual);
    }
    if (assigned.length === 0) this.#depositProvisionalObservation(ticket, field);
    // Event evidence must retain the trusted physical R2 coordinate. Relation
    // edges may canonicalize nearby coordinates for physical lookup, but that
    // relation-local operation must never rewrite the outcome used to measure
    // whether a pre-event residual actually improves R2 selection.
    const activeOutcome = this.#activeOutcome(outcome.r2VisitId);
    const target: PhysicalBasinReferenceV1 = activeOutcome === null ? {
      pageId: outcome.r2PageId,
      coordinate: [...outcome.r2Coordinate],
    } : {
      pageId: activeOutcome.membership.pageId,
      coordinate: [...activeOutcome.membership.coordinate],
    };
    const eventId = `event-${ticket.eventNumber.toString().padStart(6, "0")}`;
    this.#events.push({
      anchorId: ticket.anchorId,
      eventNumber: ticket.eventNumber,
      observedAt: ticket.observedAt,
      interventionKey: ticket.interventionKey,
      sourceContextId: ticket.sourceContextId,
      publicR1Signature: ticket.publicR1Signature,
      encodedValues: [...ticket.encodedValues],
      assignedFactorIds: assigned,
      r2VisitId: outcome.r2VisitId,
      targetR2Basin: cloneBasin(target),
    });
    if (assigned.length > 0 && activeOutcome !== null) {
      const edge = this.#upsertEdge(assigned, ticket.interventionKey, outcome.r2VisitId,
        eventId, ticket.sourceContextId, true);
      if (edge !== null) this.#refreshEvidence(assigned, ticket.interventionKey, edge.hyperedgeId);
    }
    this.#discoverPredictiveFactors(ticket.interventionKey);
    this.#refreshNodeStates();
    this.#refreshEdgeStates();
    return 1;
  }

  discardCandidatePool(ticket: FrozenFactorCandidatePoolV1): void {
    const pending = this.#pending.get(ticket.ticketId);
    if (pending !== undefined && JSON.stringify(pending) === JSON.stringify(ticket)) this.#pending.delete(ticket.ticketId);
  }

  evaluate(perception: Float64Array, eligibleAnchorIds?: ReadonlySet<string>): R3CausalEvaluation {
    const field = this.#encoder.encode("open-factor-query", perception);
    const active = new Map<string, { residualMatch: number; contextMatch: number; physical: number; applicability: number }>();
    for (const node of this.#nodes.values()) {
      if (node.state !== "stable") continue;
      const analysis = this.#workspace.residualAgainst(field, node.commonInput);
      const residualMatch = Math.max(
        0,
        cosine(analysis.residual.values, node.residualPrototype),
        sparseSimilarity(analysis.residual.values, node.sparseTokenConditions),
      );
      if (residualMatch < QUERY_FACTOR_SIMILARITY_MIN) continue;
      const coordinate = new Float64Array(node.physicalBasin.coordinate);
      const basin = this.#medium.sampleBasins(node.physicalBasin.pageId, coordinate, 1)[0];
      if (basin === undefined || basin.queryContribution <= 0 || basin.decayFraction <= 0) continue;
      const contextMatch = node.commonInput.length === 0 ? 1 : analysis.contextMatch;
      const physical = currentR2aPhysicalSupport(basin);
      const reliability = (node.supportStrength + 0.5)
        / (node.supportStrength + node.contradictionStrength + 1);
      active.set(node.factorId, {
        residualMatch,
        contextMatch,
        physical,
        applicability: Math.min(residualMatch, contextMatch, physical, reliability),
      });
    }
    const eligibleInterventions = new Set<string>();
    if (eligibleAnchorIds !== undefined) {
      for (const event of this.#events) if (eligibleAnchorIds.has(event.anchorId)) eligibleInterventions.add(event.interventionKey);
    }
    const interventions = eligibleInterventions.size > 0
      ? eligibleInterventions
      : new Set([...this.#edges.values()].map((edge) => edge.interventionKey));
    const scoreByOutcomeMode = new Map<string, number>();
    const outcomeCoordinates = new Map<string, Vec3>();
    const matches: R3FactorMatch[] = [];
    const relationIds: string[] = [];
    const scoreByExperienceAnchor = new Map<string, { readonly score: number; readonly matchId: string }>();
    for (const interventionKey of [...interventions].sort()) {
      const applicable = [...this.#edges.values()].filter((edge) => edge.interventionKey === interventionKey
        && productionEligibleEdge(edge)
        && this.#edgeOutcome(edge) !== null
        && edge.factorIds.length > 0 && edge.factorIds.every((factorId) => active.has(factorId)));
      if (applicable.length === 0) continue;
      const edgeApplicability = (edge: MutableEdge): number => Math.min(
        edge.relationStrength,
        ...edge.factorIds.map((factorId) => active.get(factorId)!.applicability),
      );
      applicable.sort((left, right) => edgeApplicability(right) - edgeApplicability(left)
        || right.factorIds.length - left.factorIds.length
        || right.relationStrength - left.relationStrength || left.hyperedgeId.localeCompare(right.hyperedgeId));
      const selectedFactors = applicable[0]!.factorIds;
      const selected = applicable.filter((edge) => JSON.stringify(edge.factorIds) === JSON.stringify(selectedFactors));
      const components = selectedFactors.map((factorId) => active.get(factorId)!);
      const residualMatch = Math.min(...components.map((item) => item.residualMatch));
      const contextMatch = Math.min(...components.map((item) => item.contextMatch));
      const physical = Math.min(...components.map((item) => item.physical));
      const support = selected.reduce((sum, edge) => sum + edge.supportStrength, 0);
      const contradiction = selected.reduce((sum, edge) => sum + edge.contradictionStrength, 0);
      const relationReliability = (support + 0.5) / (support + contradiction + 1);
      const relationApplicability = Math.min(relationReliability, contextMatch, residualMatch, physical);
      const relationId = selected[0]!.hyperedgeId;
      const inputModeId = `factor-set-${fnv1a64(selectedFactors)}`;
      const matchId = `${relationId}\u0001${inputModeId}`;
      matches.push({
        matchId, relationId, inputModeId, inputPole: 1,
        relationReliability, contextMatch, residualMatch, relationApplicability,
        confidence: relationApplicability,
      });
      relationIds.push(relationId);
      const allOutcomes = [...this.#edges.values()].filter((edge) => edge.interventionKey === interventionKey
        && productionEligibleEdge(edge) && this.#edgeOutcome(edge) !== null);
      const selectedByOutcome = new Map(selected.flatMap((edge) => {
        const outcome = this.#edgeOutcome(edge);
        return outcome === null ? [] : [[outcome.key, edge] as const];
      }));
      const uniqueOutcomes = new Map<string, MutableEdge>();
      for (const edge of allOutcomes) {
        const outcome = this.#edgeOutcome(edge);
        if (outcome === null) continue;
        const current = uniqueOutcomes.get(outcome.key);
        if (current === undefined || edge.supportStrength > current.supportStrength) uniqueOutcomes.set(outcome.key, edge);
      }
      for (const [outcomeKey, edge] of uniqueOutcomes) {
        const selectedEdge = selectedByOutcome.get(outcomeKey);
        const signed = selectedEdge === undefined
          ? -relationApplicability
          : relationApplicability * Math.log((selectedEdge.supportStrength + 0.5)
            / (selectedEdge.contradictionStrength + 0.5));
        const key = `${matchId}\u0000${edge.hyperedgeId}`;
        scoreByOutcomeMode.set(key, signed);
        const outcome = this.#edgeOutcome(edge);
        if (outcome !== null) outcomeCoordinates.set(key, new Float64Array(outcome.membership.coordinate));
      }
      const eligibleEvents = this.#events.filter((event) => event.interventionKey === interventionKey
        && (eligibleAnchorIds === undefined || eligibleAnchorIds.has(event.anchorId)));
      if (interventionKey === "passive-observation") {
        const queryValues = field.tokens.map((token) => token.standardizedValue);
        const gated = eligibleEvents
          .filter((event) => event.assignedFactorIds.some((factorId) => active.has(factorId)))
          .map((event) => ({
            event,
            logOverlap: tokenFieldPhysicalLogOverlap(
              queryValues,
              event.encodedValues,
              R2A_CONFIG.kernelWidth,
            ),
          }));
        if (gated.length > 0) {
          const maximum = Math.max(...gated.map((item) => item.logOverlap));
          const logMeanLikelihood = maximum + Math.log(gated.reduce(
            (sum, item) => sum + Math.exp(item.logOverlap - maximum),
            0,
          ) / gated.length);
          for (const item of gated) {
            scoreByExperienceAnchor.set(item.event.anchorId, {
              score: relationApplicability * (item.logOverlap - logMeanLikelihood),
              matchId,
            });
          }
        }
      } else {
        const signedScale = relationApplicability * Math.log((support + 0.5) / (contradiction + 0.5));
        // An action-conditioned candidate is an already observed physical
        // event.  Score it against the provenance of the selected relation,
        // not against its mutable factor assignment.  Discovery may refine
        // an event's provisional factor membership later, but that must not
        // detach the relation from the R2 outcome/R1 road that originally
        // supplied its trusted evidence.
        const selectedSourceEventIds = new Set(selected.flatMap((edge) => edge.sourceEventIds));
        for (const event of eligibleEvents) {
          const eventId = `event-${event.eventNumber.toString().padStart(6, "0")}`;
          const agrees = selectedSourceEventIds.has(eventId);
          scoreByExperienceAnchor.set(event.anchorId, {
            score: agrees ? signedScale : -signedScale,
            matchId,
          });
        }
      }
    }
    return { scoreByOutcomeMode, outcomeCoordinates, matches, relationIds, scoreByExperienceAnchor };
  }

  recover(elapsed: number, enforceUnifiedClock = false): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("elapsed must be nonnegative and finite");
    this.#medium.recover(elapsed);
    this.#logicalTime += elapsed;
    for (const node of this.#nodes.values()) {
      const basin = this.#medium.sampleBasins(node.physicalBasin.pageId, new Float64Array(node.physicalBasin.coordinate), 1)[0];
      if (basin === undefined || basin.queryContribution <= 0) node.state = "recovered";
    }
    for (const candidate of [...this.#provisional.values()]) {
      const node = this.#nodes.get(candidate.factorId);
      const mediumState = this.#medium.snapshot();
      const page = mediumState.pages.find((item) => item.pageId === candidate.physicalBasin.pageId);
      const aggregatePotential = page === undefined ? 0 : Math.abs(potentialFromSnapshot(
        page,
        new Float64Array(candidate.physicalBasin.coordinate),
      ));
      if (node?.state === "recovered" || (node === undefined
        && aggregatePotential < mediumState.config.minimumActiveMagnitude)) {
        this.#provisional.delete(candidate.candidateId);
      }
    }
    this.#refreshEdgeStates();
    if (enforceUnifiedClock && Math.abs(this.#medium.logicalTime - this.#logicalTime) > 1e-12) {
      throw new Error("R2A-graph-and-physical-medium-time-diverged");
    }
  }

  get logicalTime(): number { return this.#logicalTime; }
  get physicalMediumLogicalTime(): number { return this.#medium.logicalTime; }

  explorationHypothesesForAudit(): readonly CausalHyperedgeV3[] {
    return Object.freeze([...this.#edges.values()]
      .filter((edge) => edge.state === "provisional" || edge.state === "unresolved-composite")
      .map((edge) => this.#cloneEdge(edge))
      .sort((left, right) => left.hyperedgeId.localeCompare(right.hyperedgeId)));
  }

  recordControlledIntervention(evidence: ControlledFactorEvidenceV1): string {
    const factors = canonicalFactors(evidence.factorIds);
    if (factors.length === 0 || factors.some((factorId) => !this.#nodes.has(factorId))) {
      throw new RangeError("controlled evidence must reference existing opaque factors");
    }
    if (!evidence.trustedActualObservation) throw new Error("controlled evidence must be a trusted actual observation");
    if (evidence.baselineProbeActionId !== evidence.interventionProbeActionId) {
      throw new Error("controlled branches must use the same target probe action");
    }
    if (!factors.includes(evidence.changedFactorId)
      || evidence.observedChangedFactorIds.length !== 1
      || evidence.observedChangedFactorIds[0] !== evidence.changedFactorId) {
      throw new Error("a controlled pair must actually change exactly one planned factor");
    }
    if (!Number.isFinite(evidence.selectionDrop) || evidence.selectionDrop < -1 || evidence.selectionDrop > 1) {
      throw new RangeError("selection drop must be finite and bounded");
    }
    const previous = this.#controlledPairs.get(evidence.pairId);
    if (previous !== undefined) return previous.hyperedgeId;
    const target = this.#activeOutcome(evidence.targetR2VisitId);
    if (target === null) throw new Error("controlled evidence target has no unambiguous active R2 basin");
    const matching = [...this.#edges.values()].filter((candidate) => {
      const outcome = this.#edgeOutcome(candidate);
      return candidate.interventionKey === evidence.interventionKey
        && JSON.stringify(candidate.factorIds) === JSON.stringify(factors)
        && outcome !== null && outcome.key === target.key;
    });
    if (matching.length !== 1) {
      throw new Error("controlled evidence must strengthen one existing event-grounded R2 relation");
    }
    const edge = matching[0]!;
    edge.controlledExperimentCoverage += 1;
    this.#controlledPairs.set(evidence.pairId, {
      pairId: evidence.pairId,
      hyperedgeId: edge.hyperedgeId,
      changedFactorId: evidence.changedFactorId,
      probeActionId: evidence.baselineProbeActionId,
      sourceContextId: evidence.sourceContextId,
      selectionDrop: evidence.selectionDrop,
      supported: evidence.supported,
    });
    for (const factorId of factors) {
      const qualified = [...this.#controlledPairs.values()].filter((pair) => pair.hyperedgeId === edge.hyperedgeId
        && pair.changedFactorId === factorId && pair.supported && pair.selectionDrop >= 0.25).length;
      if (qualified >= 4) this.#testedSubsets.add(`${edge.hyperedgeId}\u0000${factorId}`);
    }
    const selectionRate = edge.supportStrength
      / Math.max(1, edge.supportStrength + edge.contradictionStrength);
    if (edge.controlledExperimentCoverage >= factors.length * 4 && selectionRate >= 0.75
      && factors.every((factorId) => this.#testedSubsets.has(`${edge.hyperedgeId}\u0000${factorId}`))) {
      edge.state = "minimal-under-tested-interventions";
    } else if (factors.length > 1) edge.state = "unresolved-composite";
    this.#refreshEdgeStates();
    return edge.hyperedgeId;
  }

  markTestedRemoval(hyperedgeId: string, factorId: string, selectionDrop: number): void {
    void selectionDrop;
    const edge = this.#edges.get(hyperedgeId);
    if (edge === undefined || !edge.factorIds.includes(factorId)) throw new RangeError("unknown edge or factor");
    throw new Error("one summary cannot establish minimality; record four trusted matched intervention pairs");
  }

  compressMotifs(): readonly FactorMotifV1[] {
    const subsetUse = new Map<string, string[]>();
    for (const edge of this.#edges.values()) {
      if (edge.factorIds.length < 2) continue;
      for (let left = 0; left < edge.factorIds.length; left += 1) {
        for (let right = left + 1; right < edge.factorIds.length; right += 1) {
          const subset = [edge.factorIds[left]!, edge.factorIds[right]!];
          const key = subset.join("\u0000");
          const list = subsetUse.get(key) ?? [];
          list.push(edge.hyperedgeId);
          subsetUse.set(key, list);
        }
      }
    }
    for (const [key, edgeIds] of subsetUse) {
      if (edgeIds.length < 3) continue;
      const factorIds = key.split("\u0000");
      const raw = edgeIds.map((id) => this.#edges.get(id)!.factorIds);
      const uncompressedJsonBytes = deterministicBytes(raw);
      const compressedJsonBytes = deterministicBytes({ factorIds, edgeIds });
      const reductionFraction = 1 - compressedJsonBytes / uncompressedJsonBytes;
      if (reductionFraction < 0.20) continue;
      const existing = [...this.#motifs.values()].find((motif) => JSON.stringify(motif.factorIds) === JSON.stringify(factorIds));
      if (existing !== undefined) continue;
      this.#motifSequence += 1;
      const motif: FactorMotifV1 = {
        motifId: `factor-motif-${this.#motifSequence.toString().padStart(6, "0")}`,
        factorIds, referencedHyperedgeIds: [...edgeIds].sort(),
        uncompressedJsonBytes, compressedJsonBytes, reductionFraction,
      };
      this.#motifs.set(motif.motifId, motif);
    }
    return [...this.#motifs.values()].map((motif) => structuredClone(motif));
  }

  canonicalExpandedQueryState(): readonly unknown[] {
    return [...this.#edges.values()]
      .map((edge) => ({
        hyperedgeId: edge.hyperedgeId,
        factorIds: [...edge.factorIds],
        interventionKey: edge.interventionKey,
        target: [...edge.targetR2Basin.coordinate],
        support: edge.supportStrength,
        contradiction: edge.contradictionStrength,
      }))
      .sort((left, right) => left.hyperedgeId.localeCompare(right.hyperedgeId));
  }

  relationsForAudit(): readonly CausalHyperedgeV3[] {
    return this.exportState().hyperedges;
  }

  productionRelationsForAudit(): readonly CausalHyperedgeV3[] {
    return Object.freeze([...this.#edges.values()]
      .filter((edge) => productionEligibleEdge(edge) && this.#edgeOutcome(edge) !== null)
      .map((edge) => this.#cloneEdge(edge))
      .sort((left, right) => left.hyperedgeId.localeCompare(right.hyperedgeId)));
  }

  activationAudit(perception: Float64Array): readonly R2AActivationAuditV1[] {
    return this.activationAudits([perception])[0]!;
  }

  /** Evaluate several public perceptions against one immutable instant of the
   * physical factor graph.  Basin survival belongs to the factor node, not to
   * an individual perception, so it is sampled once per node and reused
   * without changing any similarity or physical-support equation. */
  activationAudits(perceptions: readonly Float64Array[]): readonly (readonly R2AActivationAuditV1[])[] {
    const nodes = [...this.#nodes.values()];
    const physicalSupport = new Map(nodes.map((node) => {
      const basin = this.#medium.sampleBasins(
        node.physicalBasin.pageId,
        new Float64Array(node.physicalBasin.coordinate),
        1,
      )[0];
      return [node.factorId, basin === undefined ? 0 : currentR2aPhysicalSupport(basin)] as const;
    }));
    return perceptions.map((perception, perceptionIndex) => {
      const field = this.#encoder.encode(`activation-audit-${perceptionIndex}`, perception);
      return nodes.map((node) => {
        const analysis = this.#workspace.residualAgainst(field, node.commonInput);
        return {
        factorId: node.factorId,
        state: node.state,
        fullSimilarity: cosine(analysis.residual.values, node.residualPrototype),
        sparseSimilarity: sparseSimilarity(analysis.residual.values, node.sparseTokenConditions),
        contextMatch: node.commonInput.length === 0 ? 1 : analysis.contextMatch,
          physicalSupport: physicalSupport.get(node.factorId)!,
        };
      }).sort((left, right) => Math.max(right.fullSimilarity, right.sparseSimilarity)
        - Math.max(left.fullSimilarity, left.sparseSimilarity) || left.factorId.localeCompare(right.factorId));
    });
  }

  exportState(): CausalFactorGraphStateV3 {
    return {
      version: "CausalFactorGraphStateV3",
      outcomeIdentityVersion: "ActiveR2BasinMembershipV1",
      evidenceContextIdentityVersion: this.#evidenceContextIdentityVersion,
      legacySceneFingerprintsMigrated: false,
      legacyOutcomeModesMigrated: false,
      r2aMedium: this.#medium.snapshot(),
      factorNodes: [...this.#nodes.values()].map((node) => this.#cloneNode(node)).sort((left, right) => left.factorId.localeCompare(right.factorId)),
      hyperedges: [...this.#edges.values()].map((edge) => this.#cloneEdge(edge)).sort((left, right) => left.hyperedgeId.localeCompare(right.hyperedgeId)),
      motifs: [...this.#motifs.values()].map((motif) => structuredClone(motif)).sort((left, right) => left.motifId.localeCompare(right.motifId)),
      provisionalCandidates: [...this.#provisional.values()].map((item) => ({
        ...structuredClone(item),
        sourceEventIds: [...item.sourceEventIds].sort(),
        sourceContextIds: [...item.sourceContextIds].sort(),
      })).sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
      pendingCandidatePools: [...this.#pending.values()].map(({ version: _version, ...item }) => structuredClone(item)).sort((left, right) => left.ticketId.localeCompare(right.ticketId)),
      eventSummaries: this.#events.map((event) => structuredClone(event)),
      testedSubsets: [...this.#testedSubsets].sort(),
      controlledExperimentPairs: [...this.#controlledPairs.values()]
        .map((pair) => structuredClone(pair))
        .sort((left, right) => left.pairId.localeCompare(right.pairId)),
      factorSequence: this.#factorSequence,
      hyperedgeSequence: this.#hyperedgeSequence,
      motifSequence: this.#motifSequence,
      ticketSequence: this.#ticketSequence,
      logicalTime: this.#logicalTime,
    };
  }

  #fieldFromValues(anchorId: string, values: readonly number[]): EncodedTokenField {
    const state = this.#encoder.exportState();
    const publicValues = Float64Array.from({ length: 256 }, (_unused, index) => (
      state.inputMean[index]! + (values[index] ?? 0) * state.inputDeviation[index]!
    ));
    return this.#encoder.encode(anchorId, publicValues);
  }

  #createNode(ticket: FrozenFactorCandidatePoolV1, field: EncodedTokenField, residual: ResidualFieldState): string {
    this.#factorSequence += 1;
    const factorId = `causal-factor-${this.#factorSequence.toString().padStart(6, "0")}`;
    const pageId = this.#medium.createPage();
    const coordinate = strongestCoordinate(field, residual);
    const conditions = sparseConditions(residual);
    this.#medium.depositVisit(pageId, coordinate, 1, ticket.anchorId);
    const node: MutableNode = {
      factorId,
      physicalBasin: { pageId, coordinate: [...coordinate] },
      sparseTokenConditions: conditions,
      residualPrototype: [...residual.values],
      commonInput: cloneCommon(ticket.commonInput),
      sourceEventIds: [], sourceContextIds: [],
      supportStrength: 0, contradictionStrength: 0,
      activationConsistency: 0, r2SelectionGain: 0,
      state: "provisional", lastAccessTime: ticket.observedAt,
    };
    this.#nodes.set(factorId, node);
    const candidateId = `provisional-${factorId}`;
    this.#provisional.set(candidateId, {
      candidateId, factorId, physicalBasin: cloneBasin(node.physicalBasin),
      sparseTokenConditions: conditions.map((item) => ({ ...item })),
      sourceEventIds: [], sourceContextIds: [], supportStrength: 0,
      contradictionStrength: 0, state: "provisional", lastAccessTime: ticket.observedAt,
    });
    return factorId;
  }

  #depositProvisionalObservation(ticket: FrozenFactorCandidatePoolV1, field: EncodedTokenField): void {
    const residual: ResidualFieldState = {
      values: [...ticket.residualValues],
      magnitude: magnitude(ticket.residualValues),
    };
    if (residual.magnitude <= 0.25) return;
    const existing = [...this.#provisional.values()]
      .filter((candidate) => !this.#nodes.has(candidate.factorId))
      .map((candidate) => ({
        candidate,
        similarity: sparseSimilarity(residual.values, candidate.sparseTokenConditions),
      }))
      .filter((item) => item.similarity >= 0.80)
      .sort((left, right) => right.similarity - left.similarity
        || left.candidate.candidateId.localeCompare(right.candidate.candidateId))[0]?.candidate;
    if (existing !== undefined) {
      this.#medium.depositVisit(
        existing.physicalBasin.pageId,
        new Float64Array(existing.physicalBasin.coordinate),
        1,
        ticket.anchorId,
      );
      const eventId = `event-${ticket.eventNumber.toString().padStart(6, "0")}`;
      this.#provisional.set(existing.candidateId, {
        ...existing,
        sourceEventIds: [...new Set([...existing.sourceEventIds, eventId])].sort(),
        sourceContextIds: [...new Set([
          ...existing.sourceContextIds,
          ticket.sourceContextId,
        ])].sort(),
        supportStrength: existing.supportStrength + (existing.sourceEventIds.includes(eventId) ? 0 : 1),
        lastAccessTime: ticket.observedAt,
      });
      return;
    }
    const candidateId = `provisional-observation-${ticket.eventNumber.toString().padStart(6, "0")}`;
    const pageId = this.#medium.createPage();
    const coordinate = strongestCoordinate(field, residual);
    this.#medium.depositVisit(pageId, coordinate, 1, ticket.anchorId);
    this.#provisional.set(candidateId, {
      candidateId,
      factorId: `unresolved-${candidateId}`,
      physicalBasin: { pageId, coordinate: [...coordinate] },
      sparseTokenConditions: sparseConditions(residual),
      sourceEventIds: [`event-${ticket.eventNumber.toString().padStart(6, "0")}`],
      sourceContextIds: [ticket.sourceContextId],
      supportStrength: 1,
      contradictionStrength: 0,
      state: "provisional",
      lastAccessTime: ticket.observedAt,
    });
  }

  /**
   * The pool membership is already frozen. R2 is used here only as the
   * post-outcome learning signal that tells which pre-event residuals recur
   * with a distinct physical result basin; it never changes retrieval.
   */
  #discoverPredictiveFactors(interventionKey: string): void {
    const historicalCohort = this.#events.filter((event) => event.interventionKey === interventionKey);
    if (historicalCohort.length < MIN_COHORT) return;
    // Discovery must use the same bounded pre-outcome neighborhood as the
    // frozen candidate pool.  A mean over the entire lifetime would make a
    // harmless session/layout shift dominate the residual and hide the local
    // public condition that predicts a different physical result.
    const cohort = historicalCohort.slice(-(MAX_NEIGHBORS + 1));
    const overallMean = Array.from({ length: 256 }, (_unused, index) => (
      cohort.reduce((sum, event) => sum + event.encodedValues[index]!, 0) / cohort.length
    ));
    const commonField = this.#fieldFromValues(`common-${interventionKey}`, overallMean);
    const commonInput: CommonFieldToken[] = commonField.tokens.map((token) => ({
      tokenIndex: token.tokenIndex,
      coordinate: clone3(token.coordinate),
      standardizedValue: token.standardizedValue,
      coverage: 1,
    }));
    const residualRows = cohort.map((event) => ({
      event,
      values: event.encodedValues.map((value, index) => value - overallMean[index]!),
    }));
    let clusters: { rows: typeof residualRows; prototype: number[] }[] = [];
    const passiveDiscovery = interventionKey === "passive-observation";
    for (const row of residualRows) {
      const matched = passiveDiscovery
        ? clusters
          .map((cluster) => ({ cluster, similarity: cosine(row.values, cluster.prototype) }))
          .filter((item) => this.#samePhysicalOutcome(
            item.cluster.rows[0]!.event.r2VisitId,
            row.event.r2VisitId,
          ) && item.similarity >= PASSIVE_INPUT_SIMILARITY_MIN)
          .sort((left, right) => right.similarity - left.similarity)[0]?.cluster
        : clusters
          .map((cluster) => ({ cluster, similarity: cosine(row.values, cluster.prototype) }))
          .filter((item) => item.similarity >= FACTOR_SIMILARITY_MIN)
          .sort((left, right) => right.similarity - left.similarity)[0]?.cluster;
      if (matched === undefined) clusters.push({ rows: [row], prototype: [...row.values] });
      else {
        matched.rows.push(row);
        matched.prototype = matched.prototype.map((value, index) => (
          (value * (matched.rows.length - 1) + row.values[index]!) / matched.rows.length
        ));
      }
    }
    if (passiveDiscovery) {
      // Noise can fragment a real result-conditioned input mode into several
      // tiny greedy clusters.  Preserve open-ended submodes when they have the
      // required eight-event evidence, but fall back to the complete physical
      // outcome cohort when fragmentation leaves most observations uncovered.
      const outcomeGroups: (typeof residualRows)[] = [];
      for (const row of residualRows) {
        const group = outcomeGroups.find((candidate) => this.#samePhysicalOutcome(
          candidate[0]!.event.r2VisitId,
          row.event.r2VisitId,
        ));
        if (group === undefined) outcomeGroups.push([row]);
        else group.push(row);
      }
      const stronglyClustered = new Set(clusters
        .filter((cluster) => cluster.rows.length >= STABLE_EVENT_MIN)
        .flatMap((cluster) => cluster.rows.map((row) => row.event.anchorId)));
      for (const group of outcomeGroups) {
        const covered = group.filter((row) => stronglyClustered.has(row.event.anchorId)).length;
        if (group.length < STABLE_EVENT_MIN || covered / group.length >= 0.5) continue;
        clusters.push({
          rows: [...group],
          prototype: Array.from({ length: 256 }, (_unused, index) => (
            group.reduce((sum, row) => sum + row.values[index]!, 0) / group.length
          )),
        });
      }
    } else {
      // Greedy residual clustering may split one repeatable public condition
      // by irrelevant layout noise. Trusted R1/R2 outcomes are allowed only
      // here, after retrieval was frozen, to test whether those pre-event
      // residual fragments predict the same physical result road. They never
      // enter candidate retrieval or query input.
      const outcomeGroups: (typeof residualRows)[] = [];
      for (const row of residualRows) {
        const group = outcomeGroups.find((candidate) => this.#samePhysicalOutcome(
          candidate[0]!.event.r2VisitId,
          row.event.r2VisitId,
        ));
        if (group === undefined) outcomeGroups.push([row]);
        else group.push(row);
      }
      const qualified = outcomeGroups
        .filter((group) => group.length >= STABLE_EVENT_MIN)
        .map((rows) => ({
          rows,
          prototype: Array.from({ length: 256 }, (_unused, index) => (
            rows.reduce((sum, row) => sum + row.values[index]!, 0) / rows.length
          )),
        }));
      const inputsAreDistinguishable = qualified.length >= 2 && qualified.every((left, leftIndex) => (
        qualified.every((right, rightIndex) => leftIndex === rightIndex
          || cosine(left.prototype, right.prototype) < FACTOR_SIMILARITY_MIN)
      ));
      if (inputsAreDistinguishable) {
        clusters = qualified.map((group, groupIndex) => ({
          rows: group.rows,
          prototype: invariantDiscriminativePrototype(
            group.rows,
            qualified.filter((_candidate, candidateIndex) => candidateIndex !== groupIndex)
              .flatMap((candidate) => candidate.rows),
          ),
        }));
      }
    }
    if (clusters.length < 2) return;
    // One broad provisional residual must not swallow several independently
    // recurring modes of the same exact intervention. A node can explain at
    // most one cluster in this deterministic discovery pass; subsequent
    // passes reuse the resulting one-to-one mode assignments.
    const claimedFactorIds = new Set<string>();
    for (const cluster of clusters.filter((candidate) => candidate.rows.length >= (passiveDiscovery ? STABLE_EVENT_MIN : 2))) {
      const clusterEvents = cluster.rows.map((row) => row.event);
      const modeMean = Array.from({ length: 256 }, (_unused, index) => (
        clusterEvents.reduce((sum, event) => sum + event.encodedValues[index]!, 0) / clusterEvents.length
      ));
      const residualValues = [...cluster.prototype];
      const residual: ResidualFieldState = { values: residualValues, magnitude: magnitude(residualValues) };
      if (residual.magnitude <= 0.25) continue;
      const mergeThreshold = passiveDiscovery ? 0.65 : FACTOR_SIMILARITY_MIN;
      let node = [...this.#nodes.values()]
        .filter((candidate) => !claimedFactorIds.has(candidate.factorId))
        .filter((candidate) => {
          const candidateEdges = [...this.#edges.values()]
            .filter((edge) => edge.factorIds.includes(candidate.factorId));
          const categories = candidateEdges.map((edge) => edge.interventionKey === "passive-observation");
          if (!(categories.length === 0 || categories.includes(passiveDiscovery))) return false;
          if (candidateEdges.length === 0) return true;
          if (!passiveDiscovery) {
            const sameInterventionEdges = candidateEdges.filter((edge) => edge.interventionKey === interventionKey);
            // Factor nodes describe event-before public conditions, not action
            // identities or results.  A matching residual may therefore be
            // shared by a new exact intervention; that intervention gets its
            // own outcome hyperedge below.  Requiring a pre-existing edge for
            // the new intervention made sharing circular and duplicated an
            // otherwise identical physical factor once per action.
            //
            // Within an intervention, however, trusted outcomes remain the
            // post-outcome learning signal that keeps distinct result modes
            // separated.  They never participate in frozen retrieval.
            if (sameInterventionEdges.length === 0) return true;
            return sameInterventionEdges.some((edge) => this.#samePhysicalOutcome(
              edge.targetR2VisitId,
              clusterEvents[0]!.r2VisitId,
            ));
          }
          // The result is allowed to validate or split a pre-outcome candidate,
          // but it never participated in retrieval.  A passive factor already
          // tied to a different physical R2 basin must not be silently merged
          // into the new result-conditioned factor.
          return candidateEdges.some((edge) => edge.interventionKey === interventionKey
            && this.#samePhysicalOutcome(edge.targetR2VisitId, clusterEvents[0]!.r2VisitId));
        })
        .map((candidate) => ({ candidate, similarity: cosine(residualValues, candidate.residualPrototype) }))
        .filter((item) => item.similarity >= mergeThreshold)
        .sort((left, right) => right.similarity - left.similarity || left.candidate.factorId.localeCompare(right.candidate.factorId))[0]?.candidate;
      if (node === undefined) {
        const first = clusterEvents[0]!;
        const synthetic: FrozenFactorCandidatePoolV1 = {
          version: "FrozenFactorCandidatePoolV1",
          ticketId: `discovery-${first.anchorId}`,
          anchorId: first.anchorId,
          eventNumber: first.eventNumber,
          observedAt: first.observedAt,
          interventionKey: first.interventionKey,
          sourceContextId: first.sourceContextId,
          publicR1Signature: first.publicR1Signature,
          encodedValues: [...first.encodedValues],
          commonInput,
          residualValues,
          candidateFactorIds: [],
          cohortAnchorIds: cohort.map((event) => event.anchorId),
        };
        const factorId = this.#createNode(synthetic, this.#fieldFromValues(first.anchorId, modeMean), residual);
        node = this.#nodes.get(factorId)!;
      }
      claimedFactorIds.add(node.factorId);
      if (node.commonInput.length === 0 || node.supportStrength === 0) node.commonInput = cloneCommon(commonInput);
      for (const event of clusterEvents) {
        const index = this.#events.findIndex((candidate) => candidate.anchorId === event.anchorId);
        if (index < 0) continue;
        // A provisional broad match is exploration evidence, not a proven
        // component of the newly separated mode. Retain only already-stable
        // factors that also match this cluster's residual; otherwise the
        // provisional factor would turn every split into an unresolved
        // composite and prevent the physical single-factor evidence from ever
        // reaching its unchanged promotion gate.
        const retainedStableFactors = event.assignedFactorIds.filter((factorId) => {
          const existing = this.#nodes.get(factorId);
          return existing?.state === "stable"
            && cosine(residualValues, existing.residualPrototype) >= FACTOR_SIMILARITY_MIN;
        });
        const factors = canonicalFactors([...retainedStableFactors, node.factorId]);
        this.#events[index] = { ...event, assignedFactorIds: factors };
        const synthetic: FrozenFactorCandidatePoolV1 = {
          version: "FrozenFactorCandidatePoolV1", ticketId: `replay-${event.anchorId}`,
          anchorId: event.anchorId, eventNumber: event.eventNumber, observedAt: event.observedAt,
          interventionKey: event.interventionKey, sourceContextId: event.sourceContextId,
          publicR1Signature: event.publicR1Signature, encodedValues: [...event.encodedValues],
          commonInput, residualValues, candidateFactorIds: factors, cohortAnchorIds: cohort.map((item) => item.anchorId),
        };
        const eventResidualValues = maskToPrototype(
          event.encodedValues.map((value, valueIndex) => value - overallMean[valueIndex]!),
          residualValues,
        );
        this.#reinforceNode(node.factorId, synthetic, this.#fieldFromValues(event.anchorId, event.encodedValues), {
          values: eventResidualValues,
          magnitude: magnitude(eventResidualValues),
        });
        const eventId = `event-${event.eventNumber.toString().padStart(6, "0")}`;
        const edge = this.#upsertEdge(factors, interventionKey, event.r2VisitId,
          eventId, event.sourceContextId, true);
        if (edge !== null) this.#refreshEvidence(factors, interventionKey, edge.hyperedgeId);
      }
    }
  }

  #reinforceNode(factorId: string, ticket: FrozenFactorCandidatePoolV1, field: EncodedTokenField, residual: ResidualFieldState): void {
    const node = this.#nodes.get(factorId)!;
    const eventId = `event-${ticket.eventNumber.toString().padStart(6, "0")}`;
    if (node.sourceEventIds.includes(eventId)) return;
    const previous = node.supportStrength;
    node.residualPrototype = node.residualPrototype.map((value, index) => (
      (value * previous + residual.values[index]!) / (previous + 1)
    ));
    node.supportStrength += 1;
    node.sourceEventIds.push(eventId);
    if (!node.sourceContextIds.includes(ticket.sourceContextId)) node.sourceContextIds.push(ticket.sourceContextId);
    node.lastAccessTime = ticket.observedAt;
    this.#medium.depositVisit(node.physicalBasin.pageId, new Float64Array(node.physicalBasin.coordinate), 1, ticket.anchorId);
    const candidate = this.#provisional.get(`provisional-${factorId}`);
    if (candidate !== undefined) {
      this.#provisional.set(candidate.candidateId, {
        ...candidate,
        sourceEventIds: [...node.sourceEventIds],
        sourceContextIds: [...node.sourceContextIds],
        supportStrength: node.supportStrength,
        contradictionStrength: node.contradictionStrength,
        lastAccessTime: ticket.observedAt,
      });
    }
  }

  #upsertEdge(
    factors: readonly string[], intervention: string, targetR2VisitId: string,
    eventId: string, scene: string, supported: boolean,
  ): MutableEdge | null {
    const outcome = this.#activeOutcome(targetR2VisitId);
    if (outcome === null) return null;
    const canonical = canonicalFactors(factors);
    let edge = [...this.#edges.values()].find((candidate) => {
      const candidateOutcome = this.#edgeOutcome(candidate);
      return candidate.interventionKey === intervention
        && JSON.stringify(candidate.factorIds) === JSON.stringify(canonical)
        && candidateOutcome !== null && candidateOutcome.key === outcome.key;
    });
    if (edge === undefined) {
      this.#hyperedgeSequence += 1;
      edge = {
        hyperedgeId: `causal-hyperedge-${this.#hyperedgeSequence.toString().padStart(6, "0")}`,
        factorIds: canonical, interventionKey: intervention, targetR2VisitId,
        targetR2Basin: {
          pageId: outcome.membership.pageId,
          coordinate: [...outcome.membership.coordinate],
        },
        supportStrength: 0, contradictionStrength: 0, controlledExperimentCoverage: 0,
        relationStrength: 0, sourceEventIds: [], sourceContextIds: [],
        retainedValidationContextIds: [], retainedValidationFailureCount: 0,
        state: canonical.length > 1 ? "unresolved-composite" : "provisional",
      };
      this.#edges.set(edge.hyperedgeId, edge);
    } else {
      // Keep a recently observed real member as the representative; the
      // membership itself is always re-resolved and never cached as a class.
      edge.targetR2VisitId = targetR2VisitId;
      edge.targetR2Basin = {
        pageId: outcome.membership.pageId,
        coordinate: [...outcome.membership.coordinate],
      };
    }
    const isNewEvent = !edge.sourceEventIds.includes(eventId);
    if (isNewEvent && supported) edge.supportStrength += 1;
    else if (isNewEvent) edge.contradictionStrength += 1;
    if (isNewEvent) edge.sourceEventIds.push(eventId);
    const newContext = !edge.sourceContextIds.includes(scene);
    // The fourth distinct context is retained from the first three-context
    // provisional relation and validates it online; the production gate still
    // requires four total distinct contexts.
    const initialContextEstablished = edge.sourceContextIds.length >= STABLE_SCENE_MIN - 1;
    if (newContext) {
      edge.sourceContextIds.push(scene);
      if (initialContextEstablished) {
        if (supported) edge.retainedValidationContextIds.push(scene);
        else edge.retainedValidationFailureCount += 1;
      }
    }
    edge.relationStrength = (edge.supportStrength + 0.5)
      / (edge.supportStrength + edge.contradictionStrength + 1);
    return edge;
  }

  #refreshEvidence(factors: readonly string[], intervention: string, selectedEdgeId: string): void {
    const siblings = [...this.#edges.values()].filter((edge) => edge.interventionKey === intervention
      && JSON.stringify(edge.factorIds) === JSON.stringify(canonicalFactors(factors)));
    for (const edge of siblings) {
      const outcome = this.#edgeOutcome(edge);
      edge.contradictionStrength = siblings
        .filter((candidate) => {
          if (candidate.hyperedgeId === edge.hyperedgeId) return false;
          const candidateOutcome = this.#edgeOutcome(candidate);
          // Physically merged edges are now one result and cannot be used as
          // counterevidence against each other. Invalid provenance remains a
          // fail-closed edge and is excluded from production separately.
          return outcome !== null && candidateOutcome !== null && candidateOutcome.key !== outcome.key;
        })
        .reduce((sum, candidate) => sum + candidate.supportStrength, 0);
      edge.relationStrength = (edge.supportStrength + 0.5)
        / (edge.supportStrength + edge.contradictionStrength + 1);
    }
    void selectedEdgeId;
  }

  #refreshNodeStates(): void {
    const assignedCounts = new Map([...this.#nodes.keys()].map((factorId) => [factorId,
      this.#events.filter((event) => event.assignedFactorIds.includes(factorId)).length]));
    const provenanceOwners = new Map<string, string>();
    for (const node of this.#nodes.values()) {
      const key = [...node.sourceEventIds].sort().join("|");
      const current = provenanceOwners.get(key);
      if (current === undefined || (assignedCounts.get(node.factorId) ?? 0) > (assignedCounts.get(current) ?? 0)
        || ((assignedCounts.get(node.factorId) ?? 0) === (assignedCounts.get(current) ?? 0)
          && node.factorId.localeCompare(current) < 0)) provenanceOwners.set(key, node.factorId);
    }
    for (const node of this.#nodes.values()) {
      // A node's source-event provenance is immutable evidence about the
      // physical residual that created it.  `assignedFactorIds` is a mutable
      // query/refinement membership and may legitimately be replaced when a
      // later residual is more specific.  Using that membership here erased
      // the original evidence and could prevent a repeatedly observed factor
      // from ever becoming stable.
      const sourceKey = [...node.sourceEventIds].sort().join("|");
      const assignedEvents = this.#events.filter((event) => event.assignedFactorIds.includes(node.factorId));
      const sourceEventIds = new Set(node.sourceEventIds);
      // If a later, more specific factor owns the exact same source set, the
      // stale broad node may not double-count those events.  A uniquely
      // sourced node, however, retains its evidence even if query refinement
      // later removes its mutable membership.
      const nodeEvents = assignedEvents.length > 0 ? assignedEvents
        : provenanceOwners.get(sourceKey) === node.factorId
          ? this.#events.filter((event) => sourceEventIds.has(
            `event-${event.eventNumber.toString().padStart(6, "0")}`,
          )) : [];
      const byIntervention = new Map<string, OpenFactorEventSummaryV3[]>();
      for (const event of nodeEvents) {
        const group = byIntervention.get(event.interventionKey) ?? [];
        group.push(event);
        byIntervention.set(event.interventionKey, group);
      }
      // A pre-outcome residual match is only a provisional activation.  Once
      // trusted outcomes exist, events outside the dominant physical result
      // basin are counterevidence.  This is computed within intervention so a
      // shared factor may still participate in different action interactions.
      const predictiveContradictions = [...byIntervention.values()].reduce((sum, group) => (
        sum + group.length * (1 - this.#dominantPhysicalOutcomeFraction(group))
      ), 0);
      node.contradictionStrength = Math.max(node.contradictionStrength, predictiveContradictions);
      node.activationConsistency = node.supportStrength
        / Math.max(1, node.supportStrength + node.contradictionStrength);
      // Selection gain is evidence about repeatable current R2 basins. Basin
      // membership is resolved through the physical medium on every refresh;
      // neither cached coordinates nor an R1 storage-page identifier can
      // manufacture a result class.
      const conditioned = [...byIntervention.values()].map((events) => (
        this.#dominantPhysicalOutcomeFraction(events)
      ));
      const baseline = [...byIntervention.keys()].map((intervention) => {
        const all = this.#events.filter((event) => event.interventionKey === intervention);
        return this.#dominantPhysicalOutcomeFraction(all);
      });
      const conditionedAccuracy = conditioned.length === 0 ? 0
        : conditioned.reduce((sum, value) => sum + value, 0) / conditioned.length;
      const baselineAccuracy = baseline.length === 0 ? 0
        : baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
      node.r2SelectionGain = clamp01(conditionedAccuracy - baselineAccuracy);
      const contradictionRatio = node.contradictionStrength
        / Math.max(1, node.supportStrength + node.contradictionStrength);
      if (node.supportStrength >= STABLE_EVENT_MIN
        && node.sourceContextIds.length >= STABLE_SCENE_MIN
        && node.activationConsistency >= STABLE_CONSISTENCY_MIN
        && node.r2SelectionGain >= STABLE_GAIN_MIN
        && contradictionRatio <= MAX_CONTRADICTION_RATIO) {
        node.state = "stable";
        const candidate = this.#provisional.get(`provisional-${node.factorId}`);
        if (candidate !== undefined) this.#provisional.set(candidate.candidateId, { ...candidate, state: "promoted" });
      } else if (node.state === "stable") {
        node.state = "provisional";
        const candidate = this.#provisional.get(`provisional-${node.factorId}`);
        if (candidate !== undefined) this.#provisional.set(candidate.candidateId, { ...candidate, state: "provisional" });
      }
    }
  }

  #refreshEdgeStates(): void {
    const refreshed = new Set<string>();
    for (const edge of this.#edges.values()) {
      const key = `${edge.interventionKey}\u0000${edge.factorIds.join("\u0000")}`;
      if (refreshed.has(key)) continue;
      refreshed.add(key);
      this.#refreshEvidence(edge.factorIds, edge.interventionKey, edge.hyperedgeId);
    }
    for (const edge of this.#edges.values()) {
      const outcome = this.#edgeOutcome(edge);
      if (outcome === null) {
        edge.state = "recovered";
        continue;
      }
      const sourceIds = new Set(edge.sourceEventIds);
      const representative = [...this.#events]
        .filter((event) => sourceIds.has(`event-${event.eventNumber.toString().padStart(6, "0")}`)
          && this.#activeOutcome(event.r2VisitId) !== null)
        .sort((left, right) => left.eventNumber - right.eventNumber)[0];
      if (representative === undefined) {
        edge.state = "recovered";
        continue;
      }
      edge.targetR2VisitId = representative.r2VisitId;
      edge.targetR2Basin = {
        pageId: outcome.membership.pageId,
        coordinate: [...outcome.membership.coordinate],
      };
      const nodes = edge.factorIds.map((factorId) => this.#nodes.get(factorId));
      if (nodes.some((node) => node === undefined || node.state === "recovered")) {
        edge.state = "recovered";
        continue;
      }
      const allNodesStable = nodes.every((node) => node!.state === "stable");
      const consistency = edge.supportStrength / Math.max(1, edge.supportStrength + edge.contradictionStrength);
      const contradictionRatio = edge.contradictionStrength
        / Math.max(1, edge.supportStrength + edge.contradictionStrength);
      const baseQualified = allNodesStable
        && edge.supportStrength >= STABLE_EVENT_MIN
        && edge.sourceContextIds.length >= STABLE_SCENE_MIN
        && consistency >= STABLE_CONSISTENCY_MIN
        && nodes.every((node) => node!.r2SelectionGain >= STABLE_GAIN_MIN)
        && contradictionRatio <= MAX_CONTRADICTION_RATIO;
      if (edge.factorIds.length === 1) {
        const qualified = baseQualified
          && edge.retainedValidationContextIds.length >= 1
          && edge.retainedValidationFailureCount === 0;
        if (qualified) edge.state = "stable";
        else if (edge.state === "stable" || edge.state === "minimal-under-tested-interventions") edge.state = "degraded";
        else if (edge.state !== "recovered") edge.state = "provisional";
        continue;
      }
      const selectionRate = edge.supportStrength
        / Math.max(1, edge.supportStrength + edge.contradictionStrength);
      const controlledQualified = edge.controlledExperimentCoverage >= edge.factorIds.length * 4
        && selectionRate >= 0.75
        && edge.factorIds.every((factorId) => this.#testedSubsets.has(`${edge.hyperedgeId}\u0000${factorId}`));
      if (baseQualified && controlledQualified) edge.state = "minimal-under-tested-interventions";
      else if (edge.state === "minimal-under-tested-interventions") edge.state = "degraded";
      else if (edge.state !== "recovered") edge.state = "unresolved-composite";
    }
  }

  #cloneNode(node: MutableNode): CausalFactorNodeV2 {
    return {
      ...node, physicalBasin: cloneBasin(node.physicalBasin),
      sparseTokenConditions: node.sparseTokenConditions.map((item) => ({ ...item })),
      residualPrototype: [...node.residualPrototype], commonInput: cloneCommon(node.commonInput),
      sourceEventIds: [...node.sourceEventIds].sort(), sourceContextIds: [...node.sourceContextIds].sort(),
    };
  }

  #cloneEdge(edge: MutableEdge): CausalHyperedgeV3 {
    return {
      ...edge, factorIds: [...edge.factorIds], targetR2Basin: cloneBasin(edge.targetR2Basin),
      sourceEventIds: [...edge.sourceEventIds].sort(), sourceContextIds: [...edge.sourceContextIds].sort(),
      retainedValidationContextIds: [...edge.retainedValidationContextIds].sort(),
    };
  }

  #mutableNode(node: CausalFactorNodeV2): MutableNode {
    return {
      ...node, physicalBasin: cloneBasin(node.physicalBasin),
      sparseTokenConditions: node.sparseTokenConditions.map((item) => ({ ...item })),
      residualPrototype: [...node.residualPrototype], commonInput: cloneCommon(node.commonInput),
      sourceEventIds: [...node.sourceEventIds], sourceContextIds: [...node.sourceContextIds],
    };
  }

  #mutableEdge(edge: CausalHyperedgeV3): MutableEdge {
    return {
      ...edge, factorIds: [...edge.factorIds], targetR2Basin: cloneBasin(edge.targetR2Basin),
      sourceEventIds: [...edge.sourceEventIds], sourceContextIds: [...edge.sourceContextIds],
      retainedValidationContextIds: [...edge.retainedValidationContextIds],
    };
  }
}
