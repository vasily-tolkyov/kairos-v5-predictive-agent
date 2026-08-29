import type {
  CausalContrastStateV2,
  CommonFieldToken,
  ContrastRelationState,
  ExperienceAnchor,
  OutcomeModeState,
  R3FactorMatch,
  ResidualFieldState,
  ResidualModeState,
  Vec3,
} from "../contracts.js";
import { fnv1a64 } from "../serialization.js";
import { clone3, distanceSquared3, dot3, vec3 } from "../vector.js";
import { ExperienceMapStore } from "./experience-map.js";
import {
  DeterministicTokenFieldEncoder,
  PhysicalCommonalityWorkspace,
  RESIDUAL_MODE_SIMILARITY_MIN,
  residualSimilarity,
} from "./token-field.js";

const MAX_NEIGHBORS = 7;
const MIN_COHORT = 8;
const UPDATE_INTERVAL = 8;
const OUTCOME_MODE_RADIUS = 0.32;
const QUERY_CONTEXT_MIN = 0.80;
const QUERY_RESIDUAL_MIN = 0.65;
const DIRICHLET_ALPHA = 1;

interface MutableResidualMode {
  modeId: string;
  prototype: Float64Array;
  count: number;
  sourceAnchorIds: string[];
  positiveSourceAnchorIds: string[];
  negativeSourceAnchorIds: string[];
}

interface MutableOutcomeMode {
  modeId: string;
  coordinate: Vec3;
  count: number;
  sourceAnchorIds: string[];
}

export interface R3CausalEvaluation {
  readonly scoreByOutcomeMode: ReadonlyMap<string, number>;
  readonly outcomeCoordinates: ReadonlyMap<string, Vec3>;
  readonly matches: readonly R3FactorMatch[];
  readonly relationIds: readonly string[];
  readonly scoreByExperienceAnchor?: ReadonlyMap<string, {
    readonly score: number;
    readonly matchId: string;
  }>;
}

function contextDistance(left: ExperienceAnchor, right: ExperienceAnchor): number {
  const coordinate = distanceSquared3(left.contextCoordinate, right.contextCoordinate);
  const origin = distanceSquared3(left.contextOrigin, right.contextOrigin);
  const tangent = Math.max(-1, Math.min(1, dot3(left.initialTangent, right.initialTangent)));
  const speed = Math.abs(left.initialSpeed - right.initialSpeed);
  const temporal = Math.abs(left.observedAt - right.observedAt);
  return coordinate + 0.08 * origin + 0.35 * (1 - tangent) + 0.2 * speed + 0.002 * temporal;
}

function meanCoordinate(values: readonly Vec3[]): Vec3 {
  const result = vec3();
  for (const value of values) {
    result[0] = result[0]! + value[0]!;
    result[1] = result[1]! + value[1]!;
    result[2] = result[2]! + value[2]!;
  }
  result[0] = result[0]! / values.length;
  result[1] = result[1]! / values.length;
  result[2] = result[2]! / values.length;
  return result;
}

function subtractCoordinate(value: Vec3, common: Vec3): Vec3 {
  return vec3(value[0]! - common[0]!, value[1]! - common[1]!, value[2]! - common[2]!);
}

function dominantBipolarPattern(
  anchors: readonly ExperienceAnchor[],
  residuals: ReadonlyMap<string, ResidualFieldState>,
): { readonly pattern: ResidualFieldState; readonly poles: ReadonlyMap<string, -1 | 1> } {
  const rows = anchors.map((anchor) => {
    const residual = residuals.get(anchor.anchorId);
    if (residual === undefined) throw new Error("commonality workspace omitted an anchor residual");
    return new Float64Array(residual.values);
  });
  if (rows.length !== 8) throw new RangeError("the first R2A pilot requires eight retrieved experiments");
  let left = new Float64Array(rows[0]!.length);
  let right = new Float64Array(rows[0]!.length);
  const assignments = new Uint8Array(rows.length);
  let bestSeparation = Number.NEGATIVE_INFINITY;
  for (let mask = 0; mask < 1 << rows.length; mask += 1) {
    if ((mask & 1) !== 0) continue;
    let selected = 0;
    for (let bit = 0; bit < rows.length; bit += 1) selected += (mask >>> bit) & 1;
    if (selected !== rows.length / 2) continue;
    const candidateLeft = new Float64Array(rows[0]!.length);
    const candidateRight = new Float64Array(rows[0]!.length);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const target = ((mask >>> rowIndex) & 1) === 0 ? candidateLeft : candidateRight;
      for (let index = 0; index < target.length; index += 1) {
        target[index] = target[index]! + rows[rowIndex]![index]! / (rows.length / 2);
      }
    }
    let separation = 0;
    for (let index = 0; index < candidateLeft.length; index += 1) {
      separation += (candidateRight[index]! - candidateLeft[index]!) ** 2;
    }
    if (separation > bestSeparation) {
      bestSeparation = separation;
      left = candidateLeft;
      right = candidateRight;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        assignments[rowIndex] = ((mask >>> rowIndex) & 1) as 0 | 1;
      }
    }
  }
  const axis = new Float64Array(left.length);
  let magnitude = 0;
  for (let index = 0; index < axis.length; index += 1) {
    axis[index] = right[index]! - left[index]!;
    magnitude += axis[index]! ** 2;
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude <= 1e-12) throw new Error("retrieved experiments do not identify a residual axis");
  for (let index = 0; index < axis.length; index += 1) axis[index] = axis[index]! / magnitude;
  const firstNonzero = axis.find((value) => Math.abs(value) > 1e-12) ?? 1;
  const orientation: -1 | 1 = firstNonzero >= 0 ? 1 : -1;
  if (orientation < 0) for (let index = 0; index < axis.length; index += 1) axis[index] = -axis[index]!;
  const poles = new Map<string, -1 | 1>();
  anchors.forEach((anchor, index) => {
    const clusterPole: -1 | 1 = assignments[index] === 1 ? 1 : -1;
    poles.set(anchor.anchorId, (clusterPole * orientation) as -1 | 1);
  });
  return { pattern: { values: [...axis], magnitude: 1 }, poles };
}

function mergePattern(
  mode: MutableResidualMode,
  pattern: ResidualFieldState,
  anchors: readonly ExperienceAnchor[],
  poles: ReadonlyMap<string, -1 | 1>,
  orientation: -1 | 1,
): void {
  const newAnchors = anchors.filter((anchor) => !mode.sourceAnchorIds.includes(anchor.anchorId));
  if (newAnchors.length === 0) return;
  const previousCount = mode.count;
  const nextCount = previousCount + newAnchors.length;
  for (let index = 0; index < mode.prototype.length; index += 1) {
    mode.prototype[index] = (mode.prototype[index]! * previousCount
      + orientation * pattern.values[index]! * newAnchors.length) / nextCount;
  }
  const magnitude = Math.hypot(...mode.prototype);
  for (let index = 0; index < mode.prototype.length; index += 1) {
    mode.prototype[index] = mode.prototype[index]! / Math.max(magnitude, 1e-12);
  }
  mode.count = nextCount;
  for (const anchor of newAnchors) {
    const localPole = poles.get(anchor.anchorId)!;
    const pole = (localPole * orientation) as -1 | 1;
    mode.sourceAnchorIds.push(anchor.anchorId);
    (pole > 0 ? mode.positiveSourceAnchorIds : mode.negativeSourceAnchorIds).push(anchor.anchorId);
  }
}

function residualState(prototype: Float64Array): ResidualFieldState {
  let energy = 0;
  for (const value of prototype) energy += value * value;
  return { values: [...prototype], magnitude: Math.sqrt(energy) };
}

function cloneRelation(relation: ContrastRelationState): ContrastRelationState {
  return structuredClone(relation) as ContrastRelationState;
}

function evidenceSummary(
  evidence: ContrastRelationState["evidence"],
  inputModeIds: readonly string[],
  outcomeModeIds: readonly string[],
): { readonly supportCount: number; readonly contradictionCount: number; readonly confidence: number } {
  let supportCount = 0;
  let contradictionCount = 0;
  for (const inputModeId of inputModeIds) {
    for (const pole of [-1, 1] as const) {
      const counts = outcomeModeIds.map((outcomeModeId) => evidence
        .filter((edge) => edge.inputModeId === inputModeId && edge.inputPole === pole
          && edge.outcomeModeId === outcomeModeId)
        .reduce((sum, edge) => sum + edge.count, 0));
      const total = counts.reduce((sum, count) => sum + count, 0);
      const support = counts.length === 0 ? 0 : Math.max(...counts);
      supportCount += support;
      contradictionCount += total - support;
    }
  }
  const confidence = (supportCount + DIRICHLET_ALPHA)
    / (supportCount + contradictionCount + 2 * DIRICHLET_ALPHA)
    * ((supportCount + contradictionCount) / (supportCount + contradictionCount + 4));
  return { supportCount, contradictionCount, confidence };
}

function mergeRelations(
  existing: ContrastRelationState,
  incoming: ContrastRelationState,
): ContrastRelationState {
  const existingCount = existing.sourceAnchorIds.length;
  const incomingCount = incoming.sourceAnchorIds.length;
  const commonByToken = new Map(existing.commonInput.map((token) => [token.tokenIndex, { ...token, coordinate: [...token.coordinate] }]));
  for (const token of incoming.commonInput) {
    const current = commonByToken.get(token.tokenIndex);
    if (current === undefined) {
      commonByToken.set(token.tokenIndex, { ...token, coordinate: [...token.coordinate] });
      continue;
    }
    current.standardizedValue = (current.standardizedValue * existingCount
      + token.standardizedValue * incomingCount) / (existingCount + incomingCount);
    current.coverage = (current.coverage * existingCount + token.coverage * incomingCount)
      / (existingCount + incomingCount);
    current.coordinate = current.coordinate.map((value, axis) => (
      (value * existingCount + token.coordinate[axis]! * incomingCount) / (existingCount + incomingCount)
    ));
  }
  const commonOutcome = new Float64Array(existing.commonOutcomeCoordinate);
  const incomingCommon = new Float64Array(incoming.commonOutcomeCoordinate);
  const mutableOutcomes: MutableOutcomeMode[] = existing.outcomeModes.map((mode) => ({
    modeId: mode.modeId,
    coordinate: vec3(
      commonOutcome[0]! + mode.coordinate[0]!,
      commonOutcome[1]! + mode.coordinate[1]!,
      commonOutcome[2]! + mode.coordinate[2]!,
    ),
    count: mode.count,
    sourceAnchorIds: [...mode.sourceAnchorIds],
  }));
  const incomingModeMap = new Map<string, string>();
  for (const mode of incoming.outcomeModes) {
    const absolute = vec3(
      incomingCommon[0]! + mode.coordinate[0]!,
      incomingCommon[1]! + mode.coordinate[1]!,
      incomingCommon[2]! + mode.coordinate[2]!,
    );
    let target: MutableOutcomeMode | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of mutableOutcomes) {
      const distance = distanceSquared3(candidate.coordinate, absolute);
      if (distance < nearest) {
        nearest = distance;
        target = candidate;
      }
    }
    if (target === null || nearest > OUTCOME_MODE_RADIUS * OUTCOME_MODE_RADIUS) {
      target = {
        modeId: `outcome-mode-${(mutableOutcomes.length + 1).toString().padStart(3, "0")}`,
        coordinate: absolute,
        count: 0,
        sourceAnchorIds: [],
      };
      mutableOutcomes.push(target);
    }
    const nextCount = target.count + mode.count;
    for (let axis = 0; axis < 3; axis += 1) {
      target.coordinate[axis] = (target.coordinate[axis]! * target.count + absolute[axis]! * mode.count)
        / nextCount;
    }
    target.count = nextCount;
    target.sourceAnchorIds.push(...mode.sourceAnchorIds.filter((id) => !target!.sourceAnchorIds.includes(id)));
    incomingModeMap.set(mode.modeId, target.modeId);
  }
  const evidence = new Map<string, number>();
  for (const edge of existing.evidence) {
    evidence.set(`${edge.inputModeId}\u0000${edge.inputPole}\u0000${edge.outcomeModeId}`, edge.count);
  }
  for (const edge of incoming.evidence) {
    const outcomeModeId = incomingModeMap.get(edge.outcomeModeId)!;
    const key = `${edge.inputModeId}\u0000${edge.inputPole}\u0000${outcomeModeId}`;
    evidence.set(key, (evidence.get(key) ?? 0) + edge.count);
  }
  const evidenceState = [...evidence.entries()].map(([key, count]) => {
    const [inputModeId, inputPole, outcomeModeId] = key.split("\u0000");
    return { inputModeId: inputModeId!, inputPole: Number(inputPole) as -1 | 1, outcomeModeId: outcomeModeId!, count };
  }).sort((left, right) => left.inputModeId.localeCompare(right.inputModeId)
    || left.inputPole - right.inputPole || left.outcomeModeId.localeCompare(right.outcomeModeId));
  const summary = evidenceSummary(
    evidenceState,
    existing.inputModes.map((mode) => mode.modeId),
    mutableOutcomes.map((mode) => mode.modeId),
  );
  return {
    relationId: existing.relationId,
    commonInput: [...commonByToken.values()].sort((left, right) => left.tokenIndex - right.tokenIndex),
    commonOutcomeCoordinate: [...commonOutcome],
    inputModes: incoming.inputModes,
    outcomeModes: mutableOutcomes.map((mode) => ({
      modeId: mode.modeId,
      coordinate: [...subtractCoordinate(mode.coordinate, commonOutcome)],
      count: mode.count,
      sourceAnchorIds: [...mode.sourceAnchorIds].sort(),
    })),
    evidence: evidenceState,
    ...summary,
    sourceAnchorIds: [...new Set([...existing.sourceAnchorIds, ...incoming.sourceAnchorIds])].sort(),
    cohortHash: fnv1a64([existing.cohortHash, incoming.cohortHash].sort()),
  };
}

function entropy(probabilities: readonly number[]): number {
  let value = 0;
  for (const probability of probabilities) {
    if (probability > 0) value -= probability * Math.log(probability);
  }
  return value;
}

export class SimilarityRetriever {
  retrieve(anchorId: string, store: ExperienceMapStore): readonly ExperienceAnchor[] {
    const current = store.get(anchorId);
    const neighbors = store.all()
      .filter((candidate) => candidate.anchorId !== anchorId)
      .map((candidate) => ({ candidate, distance: contextDistance(current, candidate) }))
      .sort((left, right) => left.distance - right.distance
        || left.candidate.anchorId.localeCompare(right.candidate.anchorId))
      .slice(0, MAX_NEIGHBORS)
      .map((item) => item.candidate);
    return [...neighbors, current].sort((left, right) => left.anchorId.localeCompare(right.anchorId));
  }
}

export class CausalContrastR2A {
  readonly #encoder: DeterministicTokenFieldEncoder;
  readonly #workspace = new PhysicalCommonalityWorkspace();
  readonly #retriever = new SimilarityRetriever();
  readonly #relations: ContrastRelationState[] = [];
  readonly #inputPatterns: MutableResidualMode[] = [];
  readonly #processed = new Set<string>();
  #relationSequence = 0;
  #inputModeSequence = 0;

  constructor(encoder: DeterministicTokenFieldEncoder, state?: CausalContrastStateV2) {
    this.#encoder = encoder;
    if (state === undefined) return;
    this.#relationSequence = state.relationSequence;
    this.#inputModeSequence = state.inputModeSequence;
    for (const pattern of state.inputPatterns) {
      this.#inputPatterns.push({
        modeId: pattern.modeId,
        prototype: new Float64Array(pattern.prototype),
        count: pattern.count,
        sourceAnchorIds: [...pattern.sourceAnchorIds],
        positiveSourceAnchorIds: [...pattern.positiveSourceAnchorIds],
        negativeSourceAnchorIds: [...pattern.negativeSourceAnchorIds],
      });
    }
    for (const hash of state.processedCohortHashes) this.#processed.add(hash);
    for (const relation of state.relations) this.#relations.push(cloneRelation(relation));
  }

  learnFromAnchor(anchorId: string, store: ExperienceMapStore): number {
    if (store.size < MIN_COHORT || store.size % UPDATE_INTERVAL !== 0) return 0;
    const cohort = this.#retriever.retrieve(anchorId, store);
    if (cohort.length < MIN_COHORT) return 0;
    const cohortHash = fnv1a64(cohort.map((anchor) => anchor.anchorId));
    if (this.#processed.has(cohortHash)) return 0;
    const analysis = this.#workspace.analyze(
      cohort.map((anchor) => this.#encoder.encode(anchor.anchorId, anchor.perception)),
    );
    const dominant = dominantBipolarPattern(cohort, analysis.residuals);
    let best: MutableResidualMode | null = null;
    let bestSimilarity = 0;
    for (const mode of this.#inputPatterns) {
      const similarity = residualSimilarity(dominant.pattern, residualState(mode.prototype));
      if (Math.abs(similarity) > Math.abs(bestSimilarity)) {
        bestSimilarity = similarity;
        best = mode;
      }
    }
    if (best === null || Math.abs(bestSimilarity) < RESIDUAL_MODE_SIMILARITY_MIN) {
      this.#inputModeSequence += 1;
      const positive = cohort.filter((anchor) => dominant.poles.get(anchor.anchorId) === 1).map((anchor) => anchor.anchorId);
      const negative = cohort.filter((anchor) => dominant.poles.get(anchor.anchorId) === -1).map((anchor) => anchor.anchorId);
      best = {
        modeId: `input-mode-${this.#inputModeSequence.toString().padStart(6, "0")}`,
        prototype: new Float64Array(dominant.pattern.values),
        count: cohort.length,
        sourceAnchorIds: cohort.map((anchor) => anchor.anchorId),
        positiveSourceAnchorIds: positive,
        negativeSourceAnchorIds: negative,
      };
      this.#inputPatterns.push(best);
      bestSimilarity = 1;
    } else {
      mergePattern(best, dominant.pattern, cohort, dominant.poles, bestSimilarity >= 0 ? 1 : -1);
    }
    const inputModeId = best.modeId;
    const inputPoleByAnchor = new Map<string, -1 | 1>();
    for (const anchor of cohort) {
      const localPole = dominant.poles.get(anchor.anchorId)!;
      inputPoleByAnchor.set(
        anchor.anchorId,
        (localPole * (bestSimilarity >= 0 ? 1 : -1)) as -1 | 1,
      );
    }
    const commonOutcome = meanCoordinate(cohort.map((anchor) => anchor.r2Coordinate));
    const outcomeModes: MutableOutcomeMode[] = [];
    const outcomeModeByAnchor = new Map<string, string>();
    for (const anchor of cohort) {
      const residual = subtractCoordinate(anchor.r2Coordinate, commonOutcome);
      let best: MutableOutcomeMode | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const mode of outcomeModes) {
        const distance = distanceSquared3(residual, mode.coordinate);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = mode;
        }
      }
      if (best === null || bestDistance > OUTCOME_MODE_RADIUS * OUTCOME_MODE_RADIUS) {
        const mode: MutableOutcomeMode = {
          modeId: `outcome-mode-${(outcomeModes.length + 1).toString().padStart(3, "0")}`,
          coordinate: clone3(residual),
          count: 1,
          sourceAnchorIds: [anchor.anchorId],
        };
        outcomeModes.push(mode);
        outcomeModeByAnchor.set(anchor.anchorId, mode.modeId);
      } else {
        const nextCount = best.count + 1;
        for (let axis = 0; axis < 3; axis += 1) {
          best.coordinate[axis] = best.coordinate[axis]!
            + (residual[axis]! - best.coordinate[axis]!) / nextCount;
        }
        best.count = nextCount;
        best.sourceAnchorIds.push(anchor.anchorId);
        outcomeModeByAnchor.set(anchor.anchorId, best.modeId);
      }
    }
    const evidence = new Map<string, number>();
    for (const anchor of cohort) {
      const outcomeModeId = outcomeModeByAnchor.get(anchor.anchorId)!;
      const key = `${inputModeId}\u0000${inputPoleByAnchor.get(anchor.anchorId)!}\u0000${outcomeModeId}`;
      evidence.set(key, (evidence.get(key) ?? 0) + 1);
    }
    let supportCount = 0;
    let contradictionCount = 0;
    for (const pole of [-1, 1] as const) {
      const counts = outcomeModes.map((outcome) => evidence.get(`${inputModeId}\u0000${pole}\u0000${outcome.modeId}`) ?? 0);
      const total = counts.reduce((sum, count) => sum + count, 0);
      const support = counts.length === 0 ? 0 : Math.max(...counts);
      supportCount += support;
      contradictionCount += total - support;
    }
    const confidence = (supportCount + DIRICHLET_ALPHA)
      / (supportCount + contradictionCount + 2 * DIRICHLET_ALPHA)
      * ((supportCount + contradictionCount) / (supportCount + contradictionCount + 4));
    const existingRelationIndex = this.#relations.findIndex((candidate) => (
      candidate.inputModes.some((mode) => mode.modeId === inputModeId)
    ));
    if (existingRelationIndex < 0) this.#relationSequence += 1;
    const relationId = existingRelationIndex < 0
      ? `contrast-relation-${this.#relationSequence.toString().padStart(6, "0")}`
      : this.#relations[existingRelationIndex]!.relationId;
    const relation: ContrastRelationState = {
      relationId,
      commonInput: analysis.commonInput.map((token) => ({
        tokenIndex: token.tokenIndex,
        coordinate: [...token.coordinate],
        standardizedValue: token.standardizedValue,
        coverage: token.coverage,
      })),
      commonOutcomeCoordinate: [...commonOutcome],
      inputModes: [{
        modeId: best.modeId,
        prototype: [...best.prototype],
        count: best.count,
        sourceAnchorIds: [...best.sourceAnchorIds].sort(),
        positiveSourceAnchorIds: [...best.positiveSourceAnchorIds].sort(),
        negativeSourceAnchorIds: [...best.negativeSourceAnchorIds].sort(),
      }],
      outcomeModes: outcomeModes.map((mode): OutcomeModeState => ({
        modeId: mode.modeId,
        coordinate: [...mode.coordinate],
        count: mode.count,
        sourceAnchorIds: [...mode.sourceAnchorIds].sort(),
      })),
      evidence: [...evidence.entries()].map(([key, count]) => {
        const [inputModeId, inputPole, outcomeModeId] = key.split("\u0000");
        return { inputModeId: inputModeId!, inputPole: Number(inputPole) as -1 | 1, outcomeModeId: outcomeModeId!, count };
      }).sort((left, right) => left.inputModeId.localeCompare(right.inputModeId)
        || left.inputPole - right.inputPole
        || left.outcomeModeId.localeCompare(right.outcomeModeId)),
      supportCount,
      contradictionCount,
      confidence,
      sourceAnchorIds: cohort.map((anchor) => anchor.anchorId),
      cohortHash,
    };
    if (existingRelationIndex < 0) this.#relations.push(relation);
    else this.#relations[existingRelationIndex] = mergeRelations(this.#relations[existingRelationIndex]!, relation);
    this.#processed.add(cohortHash);
    return 1;
  }

  evaluate(perception: Float64Array, eligibleAnchorIds?: ReadonlySet<string>): R3CausalEvaluation {
    const matches: R3FactorMatch[] = [];
    const scored: Array<{
      relation: ContrastRelationState;
      inputMode: ResidualModeState;
      inputPole: -1 | 1;
      residualMatch: number;
      contextMatch: number;
      relationReliability: number;
      confidence: number;
    }> = [];
    for (const relation of this.#relations) {
      const commonInput: CommonFieldToken[] = relation.commonInput.map((token) => ({
        ...token,
        coordinate: new Float64Array(token.coordinate),
      }));
      const { residual, contextMatch } = this.#workspace.residualAgainst(
        this.#encoder.encode("query", perception),
        commonInput,
      );
      if (contextMatch < QUERY_CONTEXT_MIN) continue;
      let bestMode: ResidualModeState | null = null;
      let bestSimilarity = 0;
      for (const storedMode of relation.inputModes) {
        const globalMode = this.#inputPatterns.find((candidate) => candidate.modeId === storedMode.modeId);
        const mode: ResidualModeState = globalMode === undefined ? storedMode : {
          modeId: globalMode.modeId,
          prototype: [...globalMode.prototype],
          count: globalMode.count,
          sourceAnchorIds: globalMode.sourceAnchorIds,
          positiveSourceAnchorIds: globalMode.positiveSourceAnchorIds,
          negativeSourceAnchorIds: globalMode.negativeSourceAnchorIds,
        };
        const similarity = residualSimilarity(residual, {
          values: mode.prototype,
          magnitude: Math.hypot(...mode.prototype),
        });
        if (Math.abs(similarity) > Math.abs(bestSimilarity)) {
          bestSimilarity = similarity;
          bestMode = mode;
        }
      }
      if (bestMode === null || Math.abs(bestSimilarity) < QUERY_RESIDUAL_MIN) continue;
      const inputPole: -1 | 1 = bestSimilarity >= 0 ? 1 : -1;
      const evidenceCount = (pole: -1 | 1, outcome: OutcomeModeState): number => {
        if (eligibleAnchorIds === undefined) {
          return relation.evidence
            .filter((edge) => edge.inputModeId === bestMode!.modeId && edge.inputPole === pole
              && edge.outcomeModeId === outcome.modeId)
            .reduce((sum, edge) => sum + edge.count, 0);
        }
        const poleSources = new Set(pole > 0
          ? bestMode!.positiveSourceAnchorIds
          : bestMode!.negativeSourceAnchorIds);
        const outcomeSources = new Set(outcome.sourceAnchorIds);
        return relation.sourceAnchorIds.reduce((count, anchorId) => count + (
          eligibleAnchorIds.has(anchorId) && poleSources.has(anchorId) && outcomeSources.has(anchorId) ? 1 : 0
        ), 0);
      };
      const outcomeCounts = relation.outcomeModes.map((outcome) => evidenceCount(inputPole, outcome));
      let conditionalSupport = 0;
      let conditionalContradiction = 0;
      for (const pole of [-1, 1] as const) {
        const counts = relation.outcomeModes.map((outcome) => evidenceCount(pole, outcome));
        const evidenceTotal = counts.reduce((sum, count) => sum + count, 0);
        const supported = counts.length === 0 ? 0 : Math.max(...counts);
        conditionalSupport += supported;
        conditionalContradiction += evidenceTotal - supported;
      }
      const conditionalReliability = eligibleAnchorIds === undefined
        ? relation.confidence
        : (conditionalSupport + DIRICHLET_ALPHA)
          / (conditionalSupport + conditionalContradiction + 2 * DIRICHLET_ALPHA)
          * ((conditionalSupport + conditionalContradiction)
            / (conditionalSupport + conditionalContradiction + 4));
      const total = outcomeCounts.reduce((sum, count) => sum + count, 0);
      const probabilities = outcomeCounts.map((count) => (
        (count + DIRICHLET_ALPHA) / (total + DIRICHLET_ALPHA * relation.outcomeModes.length)
      ));
      const normalizedEntropy = relation.outcomeModes.length <= 1 ? 0
        : entropy(probabilities) / Math.log(relation.outcomeModes.length);
      const confidence = conditionalReliability * Math.abs(bestSimilarity) * contextMatch
        * (1 - 0.25 * normalizedEntropy);
      scored.push({
        relation,
        inputMode: bestMode,
        inputPole,
        residualMatch: Math.abs(bestSimilarity),
        contextMatch,
        relationReliability: conditionalReliability,
        confidence,
      });
    }
    const bestByPattern = new Map<string, typeof scored[number]>();
    for (const item of scored) {
      const current = bestByPattern.get(item.inputMode.modeId);
      const strength = item.confidence * item.residualMatch * item.contextMatch;
      const currentStrength = current === undefined ? Number.NEGATIVE_INFINITY
        : current.confidence * current.residualMatch * current.contextMatch;
      if (current === undefined || strength > currentStrength
        || (strength === currentStrength && item.relation.relationId < current.relation.relationId)) {
        bestByPattern.set(item.inputMode.modeId, item);
      }
    }
    const uniqueScored = [...bestByPattern.values()];
    uniqueScored.sort((left, right) => (
      right.confidence * right.residualMatch * right.contextMatch
      - left.confidence * left.residualMatch * left.contextMatch
    ) || left.relation.relationId.localeCompare(right.relation.relationId));
    const selected = uniqueScored.slice(0, 4);
    const scoreByOutcomeMode = new Map<string, number>();
    const outcomeCoordinates = new Map<string, Vec3>();
    for (const item of selected) {
      matches.push({
        matchId: `${item.relation.relationId}\u0001${item.inputMode.modeId}`,
        relationId: item.relation.relationId,
        inputModeId: item.inputMode.modeId,
        inputPole: item.inputPole,
        relationReliability: item.relationReliability,
        contextMatch: item.contextMatch,
        residualMatch: item.residualMatch,
        relationApplicability: Math.min(
          item.relationReliability,
          item.contextMatch,
          item.residualMatch,
        ),
        confidence: item.confidence,
      });
      const conditionalCountFor = (pole: -1 | 1, outcome: OutcomeModeState): number => {
        if (eligibleAnchorIds === undefined) {
          return item.relation.evidence
            .filter((edge) => edge.inputModeId === item.inputMode.modeId && edge.inputPole === pole
              && edge.outcomeModeId === outcome.modeId)
            .reduce((sum, edge) => sum + edge.count, 0);
        }
        const poleSources = new Set(pole > 0
          ? item.inputMode.positiveSourceAnchorIds
          : item.inputMode.negativeSourceAnchorIds);
        const outcomeSources = new Set(outcome.sourceAnchorIds);
        return item.relation.sourceAnchorIds.reduce((count, anchorId) => count + (
          eligibleAnchorIds.has(anchorId) && poleSources.has(anchorId) && outcomeSources.has(anchorId) ? 1 : 0
        ), 0);
      };
      const modeTotal = item.relation.outcomeModes
        .reduce((sum, outcome) => sum + conditionalCountFor(item.inputPole, outcome), 0);
      const oppositeTotal = item.relation.outcomeModes
        .reduce((sum, outcome) => sum + conditionalCountFor(-item.inputPole as -1 | 1, outcome), 0);
      for (const outcome of item.relation.outcomeModes) {
        const conditionalCount = conditionalCountFor(item.inputPole, outcome);
        const oppositeCount = conditionalCountFor(-item.inputPole as -1 | 1, outcome);
        const opposite = (oppositeCount + DIRICHLET_ALPHA)
          / (oppositeTotal + DIRICHLET_ALPHA * item.relation.outcomeModes.length);
        const conditional = (conditionalCount + DIRICHLET_ALPHA)
          / (modeTotal + DIRICHLET_ALPHA * item.relation.outcomeModes.length);
        const score = item.confidence * Math.log(conditional / opposite);
        const key = `${item.relation.relationId}\u0001${item.inputMode.modeId}\u0000${outcome.modeId}`;
        scoreByOutcomeMode.set(key, score);
        const common = new Float64Array(item.relation.commonOutcomeCoordinate);
        const residual = new Float64Array(outcome.coordinate);
        outcomeCoordinates.set(key, vec3(
          common[0]! + residual[0]!,
          common[1]! + residual[1]!,
          common[2]! + residual[2]!,
        ));
      }
    }
    return {
      scoreByOutcomeMode,
      outcomeCoordinates,
      matches,
      relationIds: selected.map((item) => item.relation.relationId),
    };
  }

  relationsForAudit(): readonly ContrastRelationState[] {
    return this.#relations.map(cloneRelation);
  }

  exportState(): CausalContrastStateV2 {
    return {
      relationSequence: this.#relationSequence,
      inputModeSequence: this.#inputModeSequence,
      inputPatterns: this.#inputPatterns.map((mode) => ({
        modeId: mode.modeId,
        prototype: [...mode.prototype],
        count: mode.count,
        sourceAnchorIds: [...mode.sourceAnchorIds].sort(),
        positiveSourceAnchorIds: [...mode.positiveSourceAnchorIds].sort(),
        negativeSourceAnchorIds: [...mode.negativeSourceAnchorIds].sort(),
      })),
      processedCohortHashes: [...this.#processed].sort(),
      relations: this.#relations.map(cloneRelation),
    };
  }
}
