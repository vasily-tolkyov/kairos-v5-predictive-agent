import { R2A_CONFIG, R2_CONFIG } from '../config.js';
import type { MediumSnapshot, TokenFieldEncoderStateV2, Vec3 } from '../contracts.js';
import { PhysicalMedium3D } from '../physics/physical-medium.js';
import { DeterministicTokenFieldEncoder } from './token-field.js';
import { R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
  type R2ContinuousEventV1 } from './r2-continuous-event.js';
import { R2_ATOM_EQUIVALENT_RESOLUTION_V1 } from './r2-atom-measurement.js';
import { sha } from '../../util.js';

/**
 * One R2 measurement is repeatable within the adapter's narrow equivalence
 * resolution.  A repeated event pattern is wider: it is an ordered,
 * complete-link physical road corridor. Event-local public transition
 * identities remain per-observation audit evidence; they are deliberately not
 * a second discrete pattern key that can override the physical road.
 */
export const R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1 = R2_ATOM_EQUIVALENT_RESOLUTION_V1;
/**
 * This is a comparison guard, not a pattern-membership radius.  The R2 atom
 * adapter promises only that protected-near observations remain nearby; it
 * does not promise that the whole band contains one outcome mode.
 */
export const R2_STABLE_PATTERN_COARSE_PHYSICAL_CORRIDOR_V1 = R2_CONFIG.kernelWidth * .75;
export const R2_STABLE_PATTERN_MINIMUM_CORE_V1 = Math.ceil(.8 * 8);
const STANDALONE_QUALIFIED_R2_ADAPTER_IDENTITY_V1 = sha('standalone-qualified-R2-coordinate-evidence-v1');

export interface R2StablePatternTopologyV1 {
  readonly version: 'R2StablePatternTopologyV5';
  readonly coordinateSystem: typeof R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1;
  readonly source: 'R2-physical-road-density-partition-with-public-transition-audit-only';
  readonly atomEquivalenceMaximum: typeof R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1;
  readonly coarsePhysicalCorridorMaximum: number;
  readonly partitionAlgorithm: 'deterministic-complete-link-persistent-gap-v1';
  readonly minimumCoreEvidence: typeof R2_STABLE_PATTERN_MINIMUM_CORE_V1;
  readonly minimumCoreFraction: .8;
  readonly sourceAdapterIdentitySha256: string;
  readonly identitySha256: string;
}

function stablePatternTopology(sourceAdapterIdentitySha256: string): R2StablePatternTopologyV1 {
  if (!/^[0-9a-f]{64}$/i.test(sourceAdapterIdentitySha256)) {
    throw new Error('R2A-source-adapter-identity-invalid');
  }
  const identity = {
    version: 'R2StablePatternTopologyV5' as const,
    coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
    source: 'R2-physical-road-density-partition-with-public-transition-audit-only' as const,
    atomEquivalenceMaximum: R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1,
    coarsePhysicalCorridorMaximum: R2_STABLE_PATTERN_COARSE_PHYSICAL_CORRIDOR_V1,
    partitionAlgorithm: 'deterministic-complete-link-persistent-gap-v1' as const,
    minimumCoreEvidence: R2_STABLE_PATTERN_MINIMUM_CORE_V1,
    minimumCoreFraction: .8 as const,
    sourceAdapterIdentitySha256,
  };
  return { ...identity, identitySha256: sha(identity) };
}

export type R2AEvidenceGradeV1 = 'single-observation' | 'repeated-correlation' | 'predictive-stable'
  | 'causal-hypothesis' | 'intervention-supported';

export interface R2PatternEvidenceInputV1 {
  readonly version: 'R2PatternEvidenceInputV1';
  readonly event: R2ContinuousEventV1;
  readonly contextId: string;
  /** Public perception immediately before each corresponding R1 atom. */
  readonly atomPrePerceptions: readonly Float64Array[];
  readonly trustedActualObservation: true;
}

export interface R2StablePatternV1 {
  readonly version: 'R2StablePatternV4';
  readonly patternId: string;
  readonly prototypeCoordinates: readonly (readonly number[])[];
  readonly orderedExperienceIdentities: readonly string[];
  /** Founding observation retained for audit only; it is not membership. */
  readonly orderedTransitionTopologyIds: readonly string[];
  /** Number of actually observed public-transition variants at each atom. */
  readonly orderedTransitionTopologyVariantCounts: readonly number[];
  readonly memberEventIds: readonly string[];
  readonly coreEventIds: readonly string[];
  readonly peripheralEventIds: readonly string[];
  readonly partitionStatus: 'resolved' | 'representation-ambiguous';
  readonly physicalDiameter: number;
  readonly separationMargin: number | null;
  readonly patternRevisionSha256: string;
  readonly contextIds: readonly string[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly contradictionEventIds: readonly string[];
  readonly orderedCorridorConsistency: number;
  readonly grade: R2AEvidenceGradeV1;
  readonly physicalTraceIds: readonly string[];
}

export interface R2AOpaqueFactorNodeV1 {
  readonly version: 'R2AOpaqueFactorNodeV1';
  readonly factorId: string;
  readonly tokenIndex: number;
  readonly expectedStandardizedValue: number;
  readonly tolerance: number;
  readonly physicalVisitIds: readonly string[];
  readonly supportingEventIds: readonly string[];
}

export interface R2AContrastPatternAdmissionV1 {
  readonly version: 'R2AContrastPatternAdmissionV1';
  readonly patternId: string;
  /** The relation did not classify this branch before this real event. */
  readonly admittedAtEventId: string;
}

export interface R2AStablePatternHyperedgeV2 {
  readonly version: 'R2AStablePatternHyperedgeV2';
  readonly relationId: string;
  readonly factorIds: readonly string[];
  readonly branchAtomIndex: number;
  readonly exactNextActionIdentity: string;
  readonly targetPatternId: string;
  /** Non-null only for a minimal relation identified by intervention tests of
   * a larger candidate. The child still starts a fresh prospective boundary. */
  readonly derivedFromRelationId: string | null;
  /** The one physical alternative suffix against which this factor relation
   * was discovered.  A different physical branch is a different pairwise
   * comparison that may share factor nodes, never an automatic enlargement
   * of this relation. */
  readonly contrastPatternIds: readonly string[];
  /** Prospective boundary for the pairwise contrast. */
  readonly contrastPatternAdmissions: readonly R2AContrastPatternAdmissionV1[];
  readonly supportEventIds: readonly string[];
  readonly contradictionEventIds: readonly string[];
  readonly interventionPairIds: readonly string[];
  readonly interventionEventPairs: readonly string[];
  readonly interventionSuccessCount: number;
  readonly removalSelectionDrops: readonly number[];
  /** Prospective intervention evidence belongs to the exact opaque factor
   * set that was changed.  A multi-factor set is one joint measurement unit;
   * its members are never credited as independently causal. */
  readonly factorSetInterventions: readonly {
    readonly factorSetId: string;
    readonly factorIds: readonly string[];
    readonly pairIds: readonly string[];
    readonly branchChangeCount: number;
    readonly removalSelectionDrops: readonly number[];
  }[];
  readonly formedAtEventId: string;
  /** First prospective event at which the relation itself satisfied the
   * predictive gate.  Earlier observations are training, never later causal
   * confirmation material. */
  readonly predictiveSinceEventId: string | null;
  readonly validationEventIds: readonly string[];
  /** Actual branch identity captured when each validation event was observed.
   * This is parallel to validationEventIds and makes target/contrast coverage
   * reproducible without consulting the relation's later-expanded scope. */
  readonly validationPatternIds: readonly string[];
  readonly validationCorrectCount: number;
  readonly validationContextIds: readonly string[];
  readonly naturalMatchedContrasts: readonly R2ANaturalMatchedContrastV1[];
  readonly grade: R2AEvidenceGradeV1;
}

/** Source compatibility name; every writable relation is V2. */
export type R2AStablePatternHyperedgeV1 = R2AStablePatternHyperedgeV2;

export interface R2ANaturalMatchedContrastV1 {
  readonly version: 'R2ANaturalMatchedContrastV1';
  readonly contrastId: string;
  readonly factorId: string;
  readonly earlierEventId: string;
  readonly laterEventId: string;
  readonly matchedContextId: string;
  readonly directionallyConsistent: boolean;
}

export interface R2AInterventionEvidenceV1 {
  readonly version: 'R2AInterventionEvidenceV1';
  readonly pairId: string;
  readonly protocolId: string;
  readonly relationId: string;
  readonly baselineEventId: string;
  readonly interventionEventId: string;
  readonly changedFactorIds: readonly string[];
  readonly trustedActualObservation: true;
}

export interface R2AFormationMatchedPairV1 {
  readonly targetEventId: string;
  readonly contrastEventId: string;
}

export interface R2AMeasurementBoundaryChannelV1 {
  readonly tokenIndex: number;
  /** Sign of target minus contrast in the preregistered real pairs. */
  readonly direction: -1 | 1;
  readonly minimumAbsoluteDelta: number;
  readonly maximumAbsoluteDelta: number;
}

export interface R2AUnresolvedMeasurementChannelV1 {
  readonly tokenIndex: number;
  readonly maximumAbsoluteDelta: number;
}

export interface R2AInterventionMeasurementBoundaryV1 {
  readonly version: 'R2AInterventionMeasurementBoundaryV1';
  readonly sourcePairs: readonly R2AFormationMatchedPairV1[];
  readonly changedChannels: readonly R2AMeasurementBoundaryChannelV1[];
  readonly invariantTokenIndices: readonly number[];
  readonly unresolvedChannels: readonly R2AUnresolvedMeasurementChannelV1[];
  readonly identitySha256: string;
}

export interface R2AInterventionProtocolV1 {
  readonly version: 'R2AInterventionProtocolV3';
  readonly protocolId: string;
  readonly relationId: string;
  readonly factorSetId: string;
  readonly changedFactorIds: readonly string[];
  readonly predictiveBoundaryEventId: string;
  /** Captured internally when the protocol is registered, before either
   * member of the matched pair is observed. */
  readonly registeredAfterEventId: string;
  readonly registeredEvidenceCount: number;
  readonly measurementBoundary: R2AInterventionMeasurementBoundaryV1;
}

/** The singular field is accepted only as a source-level compatibility
 * adapter.  Persisted protocols always contain the canonical array form. */
export type R2AInterventionProtocolRegistrationV3 = {
  readonly protocolId: string;
  readonly relationId: string;
  readonly changedFactorIds: readonly string[];
  readonly changedFactorId?: never;
  readonly formationMatchedPairs: readonly R2AFormationMatchedPairV1[];
} | {
  readonly protocolId: string;
  readonly relationId: string;
  readonly changedFactorId: string;
  readonly changedFactorIds?: never;
  readonly formationMatchedPairs: readonly R2AFormationMatchedPairV1[];
};

export interface R2ACurrentFactorComparisonV1 {
  readonly version: 'R2ACurrentFactorComparisonV1';
  readonly relationId: string;
  readonly targetPatternId: string;
  /** Complete opaque factor set required by this relation.  This is exposed so
   * a projected state can be checked against the whole relation rather than
   * treating one changed factor as if it completed the parent condition. */
  readonly requiredFactorIds: readonly string[];
  readonly matchedFactorIds: readonly string[];
  readonly conflictedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  /** Physical support for the target R2A pattern at the instant of the real
   * comparison.  A projected factor delta cannot recreate recovered support. */
  readonly physicalPatternActive: boolean;
  readonly applicability: number;
  readonly evidenceGrade: R2AEvidenceGradeV1;
  readonly predictionEligible: boolean;
  readonly highConfidenceActionEligible: boolean;
}

/** Factor-state information actually exposed by a physical rollout.  These
 * identifiers remain opaque; the query neither receives nor reconstructs
 * public semantic names, world coordinates, or an answer label. */
export interface R2AProjectedFactorDeltaV1 {
  readonly version: 'R2AProjectedFactorDeltaV1';
  readonly activatedFactorIds: readonly string[];
  readonly deactivatedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  /** The rollout is useful only while the physical R1/R2 evidence that
   * generated it remains active. */
  readonly sourceR1Active: boolean;
  readonly sourceR2Active: boolean;
}

export interface R2AProjectedRelationComparisonV1 {
  readonly version: 'R2AProjectedRelationComparisonV1';
  readonly relationId: string;
  readonly targetPatternId: string;
  readonly requiredFactorIds: readonly string[];
  readonly matchedFactorIds: readonly string[];
  readonly conflictedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  /** Categorical completeness of the parent relation, not a calibrated
   * probability.  It is non-zero only when every required factor is known to
   * match and the target pattern still has physical support. */
  readonly applicability: number;
  readonly evidenceGrade: R2AEvidenceGradeV1;
  readonly predictionEligible: boolean;
  readonly productionEligible: boolean;
}

export interface R2AProjectedRelationSelectionV1 {
  readonly version: 'R2AProjectedRelationSelectionV1';
  readonly memberResults: readonly R2AProjectedRelationComparisonV1[];
  readonly selectedRelationId: string | null;
  readonly selected: R2AProjectedRelationComparisonV1 | null;
}

function canonicalFactorIdsForProjection(values: readonly string[], label: string): readonly string[] {
  if (values.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`projected-factor-state-${label}-identity-invalid`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`projected-factor-state-${label}-identity-duplicated`);
  }
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

/** Pure, read-only composition of a real current R3 comparison with the
 * factor state actually reached by a PredictionClone sample.  Unknown current
 * factors are sticky because a rollout cannot recreate recovered R2A physical
 * evidence.  Projected unknown also dominates an asserted activation. */
export function compareProjectedR2ARelationV1(
  current: R2ACurrentFactorComparisonV1,
  delta: R2AProjectedFactorDeltaV1,
): R2AProjectedRelationComparisonV1 {
  const required = canonicalFactorIdsForProjection(current.requiredFactorIds, 'required');
  if (required.length === 0) throw new RangeError('projected-factor-state-relation-has-no-factors');
  const currentMatched = new Set(canonicalFactorIdsForProjection(current.matchedFactorIds, 'current-matched'));
  const currentConflicted = new Set(canonicalFactorIdsForProjection(current.conflictedFactorIds, 'current-conflicted'));
  const currentUnknown = new Set(canonicalFactorIdsForProjection(current.unknownFactorIds, 'current-unknown'));
  const currentMembership = [...currentMatched, ...currentConflicted, ...currentUnknown];
  if (new Set(currentMembership).size !== currentMembership.length
    || required.some(factorId => !currentMembership.includes(factorId))
    || currentMembership.some(factorId => !required.includes(factorId))) {
    throw new Error('projected-factor-state-current-partition-invalid');
  }
  const activated = new Set(canonicalFactorIdsForProjection(delta.activatedFactorIds, 'activated'));
  const deactivated = new Set(canonicalFactorIdsForProjection(delta.deactivatedFactorIds, 'deactivated'));
  const projectedUnknown = new Set(canonicalFactorIdsForProjection(delta.unknownFactorIds, 'unknown'));
  const projectedMembership = [...activated, ...deactivated, ...projectedUnknown];
  if (new Set(projectedMembership).size !== projectedMembership.length) {
    throw new Error('projected-factor-state-delta-partition-invalid');
  }

  const matched: string[] = [], conflicted: string[] = [], unknown: string[] = [];
  for (const factorId of required) {
    // A factor whose R2A physical basis has disappeared is unknown in the real
    // comparison and cannot be restored by a hypothetical trajectory.
    if (currentUnknown.has(factorId) || projectedUnknown.has(factorId)) unknown.push(factorId);
    else if (deactivated.has(factorId)) conflicted.push(factorId);
    else if (activated.has(factorId)) matched.push(factorId);
    else if (currentMatched.has(factorId)) matched.push(factorId);
    else conflicted.push(factorId);
  }
  const complete = current.physicalPatternActive && conflicted.length === 0 && unknown.length === 0
    && matched.length === required.length;
  const applicability = complete ? 1 : 0;
  const upstreamActive = delta.sourceR1Active && delta.sourceR2Active;
  const predictionEligible = upstreamActive && applicability > 0
    && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(current.evidenceGrade);
  const productionEligible = upstreamActive && applicability > 0
    && current.evidenceGrade === 'intervention-supported';
  return { version: 'R2AProjectedRelationComparisonV1', relationId: current.relationId,
    targetPatternId: current.targetPatternId, requiredFactorIds: required,
    matchedFactorIds: matched, conflictedFactorIds: conflicted, unknownFactorIds: unknown,
    applicability, evidenceGrade: current.evidenceGrade, predictionEligible, productionEligible };
}

/** Lossless multi-relation wrapper using the same production-first,
 * applicability-second, stable-identity-last ordering as current-condition
 * selection.  All member results remain available for audit. */
export function selectProjectedR2ARelationV1(
  current: readonly R2ACurrentFactorComparisonV1[],
  delta: R2AProjectedFactorDeltaV1,
): R2AProjectedRelationSelectionV1 {
  const memberResults = current.map(value => compareProjectedR2ARelationV1(value, delta));
  const selected = [...memberResults].sort((left, right) =>
    Number(right.productionEligible) - Number(left.productionEligible)
    || right.applicability - left.applicability
    || left.relationId.localeCompare(right.relationId, 'en'))[0] ?? null;
  return { version: 'R2AProjectedRelationSelectionV1', memberResults,
    selectedRelationId: selected?.relationId ?? null, selected };
}

export interface R2AContinuationAssessmentV1 {
  readonly version: 'R2AContinuationAssessmentV1';
  readonly patternId: string;
  readonly prefixFit: number;
  readonly nextCoordinateIndex: number | null;
  readonly matchedRelationIds: readonly string[];
  readonly applicability: number;
  readonly predictionEligible: boolean;
  readonly reason: string | null;
}

interface PatternEvidenceStateV1 {
  readonly eventId: string;
  readonly endedAt: number;
  readonly contextId: string;
  readonly patternId: string;
  readonly membership: 'core' | 'peripheral';
  readonly orderedExperienceIdentities: readonly string[];
  readonly orderedTransitionTopologyIds: readonly string[];
  readonly atomPrePerceptions: readonly (readonly number[])[];
  readonly orderedCoordinates: readonly (readonly number[])[];
}

interface AssessedInterventionV1 {
  readonly relation: R2AStablePatternHyperedgeV1;
  readonly factorSetId: string;
  readonly changedFactorIds: readonly string[];
  readonly pairKey: string;
  readonly branchChanged: boolean;
  readonly removalDrop: number;
  readonly contradictionEventId: string | null;
}

export interface R2AStablePatternGraphStateV1 {
  readonly version: 'R2AStablePatternGraphV11';
  readonly topology: R2StablePatternTopologyV1;
  readonly r2aMedium: MediumSnapshot;
  readonly patternPageId: string;
  readonly factorPageId: string;
  readonly encoder: TokenFieldEncoderStateV2;
  readonly patterns: readonly R2StablePatternV1[];
  readonly factors: readonly R2AOpaqueFactorNodeV1[];
  readonly relations: readonly R2AStablePatternHyperedgeV1[];
  readonly evidence: readonly PatternEvidenceStateV1[];
  readonly interventionRecords: readonly R2AInterventionEvidenceV1[];
  readonly interventionProtocols: readonly R2AInterventionProtocolV1[];
  readonly processedEventIds: readonly string[];
  readonly logicalTime: number;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function publicContextFingerprint(perception: Float64Array): string {
  if (perception.length !== 256 || perception.some(value => !Number.isFinite(value))) {
    throw new Error('R2A-public-context-perception-invalid');
  }
  // A caller-supplied scene label is not evidence that two experiences came
  // from independent public situations.  Coarse public values form the
  // reproducible context fingerprint; no event/session/world coordinate is
  // included here.
  return `public-context-${sha(Array.from(perception, value => Math.round(value * 4) / 4))}`;
}
function patternContextFingerprint(perceptions: readonly Float64Array[]): string {
  if (perceptions.length < 2) throw new Error('R2A-pattern-context-requires-complete-R2-atom-perceptions');
  return `public-R2-context-${sha(perceptions.map(perception => {
    publicContextFingerprint(perception);
    return Array.from(perception, value => Math.round(value * 4) / 4);
  }))}`;
}

function relationValidationContextId(
  field: ReturnType<DeterministicTokenFieldEncoder['encode']>,
  excludedTokenIndices: ReadonlySet<number>,
): string {
  return `relation-context-${sha(field.tokens.flatMap((token, tokenIndex) => excludedTokenIndices.has(tokenIndex)
    ? [] : [Math.round(token.standardizedValue * 4) / 4]))}`;
}
function sameOrderedIdentities(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameOrderedTransitionTopologies(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function canonicalFactorSet(factorIds: readonly string[]): readonly string[] {
  if (!Array.isArray(factorIds) || factorIds.length === 0
    || factorIds.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error('intervention-factor-set-invalid');
  }
  return [...new Set(factorIds)].sort((left, right) => left.localeCompare(right, 'en'));
}
function factorSetIdentity(factorIds: readonly string[]): string {
  return `opaque-factor-set-${sha(canonicalFactorSet(factorIds))}`;
}
const R2A_INTERVENTION_INVARIANT_TOLERANCE_V1 = .25;
function measurementBoundaryIdentity(value: Omit<R2AInterventionMeasurementBoundaryV1,
  'identitySha256'>): string {
  return sha(value);
}
function registrationFactorIds(input: R2AInterventionProtocolRegistrationV3): readonly string[] {
  return canonicalFactorSet('changedFactorIds' in input && input.changedFactorIds !== undefined
    ? input.changedFactorIds : [input.changedFactorId]);
}
function vectorDistance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(...left.map((value, axis) => value - right[axis]!));
}

export interface R2PhysicalRoadPartitionInputV1 {
  readonly eventId: string;
  readonly endedAt: number;
  readonly orderedExperienceIdentities: readonly string[];
  readonly orderedCoordinates: readonly (readonly number[])[];
}

export interface R2PhysicalRoadPartitionV1 {
  readonly version: 'R2PhysicalRoadPartitionV1';
  readonly coreEventIds: readonly string[];
  readonly peripheralEventIds: readonly string[];
  readonly medoidEventId: string;
  readonly physicalDiameter: number;
  readonly separationMargin: number | null;
  readonly status: 'resolved' | 'representation-ambiguous';
  readonly revisionSha256: string;
}

interface CompleteLinkRoadNodeV1 {
  readonly leaves: readonly R2PhysicalRoadPartitionInputV1[];
  readonly height: number;
  readonly signature: string;
  readonly left: CompleteLinkRoadNodeV1 | null;
  readonly right: CompleteLinkRoadNodeV1 | null;
}

function physicalRoadFingerprint(value: R2PhysicalRoadPartitionInputV1): string {
  return sha({ orderedExperienceIdentities: value.orderedExperienceIdentities,
    orderedCoordinates: value.orderedCoordinates.map(point => point.map(axis => Number(axis.toFixed(12)))) });
}

function physicalRoadDistance(left: R2PhysicalRoadPartitionInputV1,
  right: R2PhysicalRoadPartitionInputV1): number {
  if (!sameOrderedIdentities(left.orderedExperienceIdentities, right.orderedExperienceIdentities)
    || left.orderedCoordinates.length !== right.orderedCoordinates.length) return Number.POSITIVE_INFINITY;
  return Math.max(...left.orderedCoordinates.map((point, atomIndex) =>
    vectorDistance(point, right.orderedCoordinates[atomIndex]!)));
}

function canonicalRoadOrder(left: R2PhysicalRoadPartitionInputV1,
  right: R2PhysicalRoadPartitionInputV1): number {
  return physicalRoadFingerprint(left).localeCompare(physicalRoadFingerprint(right), 'en')
    || left.endedAt - right.endedAt || left.eventId.localeCompare(right.eventId, 'en');
}

function completeLinkDistance(left: CompleteLinkRoadNodeV1, right: CompleteLinkRoadNodeV1): number {
  return Math.max(...left.leaves.flatMap(a => right.leaves.map(b => physicalRoadDistance(a, b))));
}

function completeLinkRoadTree(values: readonly R2PhysicalRoadPartitionInputV1[]): CompleteLinkRoadNodeV1 {
  if (values.length === 0) throw new Error('R2-physical-road-partition-empty');
  const nodes: CompleteLinkRoadNodeV1[] = [...values].sort(canonicalRoadOrder).map(value => ({
    leaves: [value], height: 0, signature: `leaf-${physicalRoadFingerprint(value)}-${value.eventId}`,
    left: null, right: null,
  }));
  while (nodes.length > 1) {
    let selectedLeft = -1, selectedRight = -1, selectedDistance = Number.POSITIVE_INFINITY;
    let selectedKey = '';
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex++) {
        const left = nodes[leftIndex]!, right = nodes[rightIndex]!;
        const distance = completeLinkDistance(left, right);
        const key = [left.signature, right.signature].sort().join('|');
        if (distance < selectedDistance - 1e-12
          || (Math.abs(distance - selectedDistance) <= 1e-12 && (selectedKey === '' || key < selectedKey))) {
          selectedLeft = leftIndex; selectedRight = rightIndex; selectedDistance = distance; selectedKey = key;
        }
      }
    }
    const first = nodes[selectedLeft]!, second = nodes[selectedRight]!;
    const [left, right] = first.signature < second.signature ? [first, second] : [second, first];
    const merged: CompleteLinkRoadNodeV1 = { leaves: [...left.leaves, ...right.leaves].sort(canonicalRoadOrder),
      height: selectedDistance, signature: `node-${sha([left.signature, right.signature])}`, left, right };
    nodes.splice(selectedRight, 1); nodes.splice(selectedLeft, 1); nodes.push(merged);
    nodes.sort((a, b) => a.signature.localeCompare(b.signature, 'en'));
  }
  return nodes[0]!;
}

function coreMedoid(values: readonly R2PhysicalRoadPartitionInputV1[]): R2PhysicalRoadPartitionInputV1 {
  return [...values].sort((left, right) => {
    const leftDistances = values.map(value => physicalRoadDistance(left, value));
    const rightDistances = values.map(value => physicalRoadDistance(right, value));
    return Math.max(...leftDistances) - Math.max(...rightDistances)
      || leftDistances.reduce((sum, value) => sum + value, 0)
        - rightDistances.reduce((sum, value) => sum + value, 0)
      || canonicalRoadOrder(left, right);
  })[0]!;
}

/**
 * Extract repeated modes from physical R2 roads.  The protected-near band is
 * never used as a class label: it only bounds a possible peripheral.  Stable
 * cores are separated by a persistent complete-link gap larger than the
 * adapter's actual equivalence resolution.  No public transition, result,
 * perception, goal or fixture identity is read here.
 */
export function derivePhysicalRoadPartitionV1(
  values: readonly R2PhysicalRoadPartitionInputV1[],
): readonly R2PhysicalRoadPartitionV1[] {
  if (values.length === 0) return [];
  const identities = values[0]!.orderedExperienceIdentities;
  if (identities.length < 2 || values.some(value => !sameOrderedIdentities(
    identities, value.orderedExperienceIdentities) || value.orderedCoordinates.length !== identities.length)) {
    throw new Error('R2-physical-road-partition-requires-one-exact-action-sequence');
  }
  const root = completeLinkRoadTree(values);
  const coreNodes: CompleteLinkRoadNodeV1[] = [];
  const peripheralCandidates: R2PhysicalRoadPartitionInputV1[] = [];
  const visit = (node: CompleteLinkRoadNodeV1): void => {
    if (node.left === null || node.right === null) { coreNodes.push(node); return; }
    const gap = node.height - Math.max(node.left.height, node.right.height);
    if (gap <= R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1 + 1e-12) {
      coreNodes.push(node); return;
    }
    const leftSize = node.left.leaves.length, rightSize = node.right.leaves.length;
    if (leftSize >= R2_STABLE_PATTERN_MINIMUM_CORE_V1
      && rightSize >= R2_STABLE_PATTERN_MINIMUM_CORE_V1) {
      visit(node.left); visit(node.right); return;
    }
    const [large, small] = leftSize >= rightSize ? [node.left, node.right] : [node.right, node.left];
    if (large.leaves.length >= 8) {
      if (small.leaves.length <= Math.floor(large.leaves.length * .25)) {
        visit(large); peripheralCandidates.push(...small.leaves); return;
      }
      // One independently productive mode plus a sizeable new island must
      // remain two branches.  The smaller branch stays non-production until
      // it earns its own real support; it is not absorbed as nuisance.
      visit(large); visit(small); return;
    }
    // A geometric notch is not yet an independently repeated physical mode. Splitting on
    // every sub-resolution gap fragmented one repeated outcome into its
    // nuisance-context subclusters.  Until both children independently meet
    // the physical evidence floor, retain their common parent corridor.  A
    // later real repetition can make both children eligible and then the
    // deterministic rebuild will expose the split without relabelling old
    // evidence.
    coreNodes.push(node);
  };
  visit(root);
  const mutable = coreNodes.map(node => ({ core: [...node.leaves].sort(canonicalRoadOrder),
    peripheral: [] as R2PhysicalRoadPartitionInputV1[],
    ambiguous: node.height > R2_STABLE_PATTERN_COARSE_PHYSICAL_CORRIDOR_V1 + 1e-12 }));
  for (const value of peripheralCandidates.sort(canonicalRoadOrder)) {
    const candidates = mutable.map((cluster, index) => ({ index,
      distance: Math.max(...cluster.core.map(core => physicalRoadDistance(value, core))) }))
      .filter(candidate => candidate.distance <= R2_STABLE_PATTERN_COARSE_PHYSICAL_CORRIDOR_V1 + 1e-12)
      .sort((left, right) => left.distance - right.distance || left.index - right.index);
    const best = candidates[0], second = candidates[1];
    if (best && (!second || second.distance - best.distance > R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1 + 1e-12)) {
      const cluster = mutable[best.index]!;
      if (cluster.core.length / (cluster.core.length + cluster.peripheral.length + 1) >= .8 - 1e-12) {
        cluster.peripheral.push(value); continue;
      }
    }
    mutable.push({ core: [value], peripheral: [], ambiguous: true });
  }
  const provisional = mutable.map(cluster => {
    const core = [...cluster.core].sort(canonicalRoadOrder), peripheral = [...cluster.peripheral].sort(canonicalRoadOrder);
    const medoid = coreMedoid(core);
    const diameter = core.length < 2 ? 0 : Math.max(...core.flatMap((left, leftIndex) =>
      core.slice(leftIndex + 1).map(right => physicalRoadDistance(left, right))));
    return { core, peripheral, medoid, diameter, ambiguous: cluster.ambiguous };
  });
  return provisional.map((cluster, clusterIndex) => {
    const otherCore = provisional.flatMap((other, otherIndex) => otherIndex === clusterIndex ? [] : other.core);
    const nearestOther = otherCore.length === 0 ? null : Math.min(...cluster.core.flatMap(left =>
      otherCore.map(right => physicalRoadDistance(left, right))));
    const separationMargin = nearestOther === null ? null : nearestOther - cluster.diameter;
    const status = cluster.ambiguous || (separationMargin !== null
      && separationMargin <= R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1 + 1e-12)
      ? 'representation-ambiguous' as const : 'resolved' as const;
    const coreEventIds = cluster.core.map(value => value.eventId), peripheralEventIds = cluster.peripheral.map(value => value.eventId);
    const revisionSha256 = sha({ algorithm: 'deterministic-complete-link-persistent-gap-v1',
      orderedExperienceIdentities: identities,
      corePhysicalFingerprints: cluster.core.map(physicalRoadFingerprint).sort(),
      peripheralPhysicalFingerprints: cluster.peripheral.map(physicalRoadFingerprint).sort(), status });
    return { version: 'R2PhysicalRoadPartitionV1' as const, coreEventIds, peripheralEventIds,
      medoidEventId: cluster.medoid.eventId, physicalDiameter: cluster.diameter,
      separationMargin, status, revisionSha256 };
  }).sort((left, right) => left.revisionSha256.localeCompare(right.revisionSha256, 'en'));
}

function r2AtomWithinStablePatternCorridor(left: readonly number[], right: readonly number[]): boolean {
  return vectorDistance(left, right) <= R2_STABLE_PATTERN_COARSE_PHYSICAL_CORRIDOR_V1 + 1e-9;
}
function r2ObservedBranchDifferent(left: readonly number[], right: readonly number[]): boolean {
  // The wide corridor groups repeated roads; it is not the resolution of an
  // observed successor. A public-transition hash is audit evidence, not a
  // result label: a branch exists only when the calibrated physical R2
  // measurements cease to be resampling-equivalent.
  return vectorDistance(left, right) > R2_STABLE_PATTERN_TOPOLOGY_RESOLUTION_V1 + 1e-9;
}
function clonePattern(value: R2StablePatternV1): R2StablePatternV1 {
  return { ...value, prototypeCoordinates: value.prototypeCoordinates.map(point => [...point]),
    orderedExperienceIdentities: [...value.orderedExperienceIdentities],
    orderedTransitionTopologyIds: [...value.orderedTransitionTopologyIds],
    orderedTransitionTopologyVariantCounts: [...value.orderedTransitionTopologyVariantCounts],
    memberEventIds: [...value.memberEventIds], coreEventIds: [...value.coreEventIds],
    peripheralEventIds: [...value.peripheralEventIds], contextIds: [...value.contextIds],
    contradictionEventIds: [...value.contradictionEventIds], physicalTraceIds: [...value.physicalTraceIds] };
}
function cloneFactor(value: R2AOpaqueFactorNodeV1): R2AOpaqueFactorNodeV1 {
  return { ...value, physicalVisitIds: [...value.physicalVisitIds], supportingEventIds: [...value.supportingEventIds] };
}
function cloneRelation(value: R2AStablePatternHyperedgeV1): R2AStablePatternHyperedgeV1 {
  return { ...value, factorIds: [...value.factorIds], contrastPatternIds: [...value.contrastPatternIds],
    contrastPatternAdmissions: value.contrastPatternAdmissions.map(item => ({ ...item })),
    supportEventIds: [...value.supportEventIds],
    contradictionEventIds: [...value.contradictionEventIds], interventionPairIds: [...value.interventionPairIds],
    interventionEventPairs: [...value.interventionEventPairs],
    removalSelectionDrops: [...value.removalSelectionDrops],
    factorSetInterventions: value.factorSetInterventions.map(item => ({ ...item,
      factorIds: [...item.factorIds], pairIds: [...item.pairIds],
      removalSelectionDrops: [...item.removalSelectionDrops] })), validationEventIds: [...value.validationEventIds],
    validationPatternIds: [...value.validationPatternIds],
    validationContextIds: [...value.validationContextIds],
    naturalMatchedContrasts: value.naturalMatchedContrasts.map(item => ({ ...item })) };
}

function relationIsPredictive(
  relation: R2AStablePatternHyperedgeV1,
  patternGrade: R2AEvidenceGradeV1,
): boolean {
  const patternIsPredictive = ['predictive-stable', 'causal-hypothesis', 'intervention-supported']
    .includes(patternGrade);
  const contradictionRatio = relation.contradictionEventIds.length
    / Math.max(1, relation.supportEventIds.length + relation.contradictionEventIds.length);
  const validationAccuracy = relation.validationCorrectCount / Math.max(1, relation.validationEventIds.length);
  const targetCovered = relation.validationPatternIds.includes(relation.targetPatternId);
  const everyContrastCovered = relation.contrastPatternIds.every(patternId =>
    relation.validationPatternIds.includes(patternId));
  return relation.supportEventIds.length >= 8 && contradictionRatio <= .2
    && patternIsPredictive && relation.validationEventIds.length >= 4
    && new Set(relation.validationContextIds).size >= 2 && validationAccuracy >= .8
    && targetCovered && everyContrastCovered;
}

function naturalMatchedContextId(
  left: ReturnType<DeterministicTokenFieldEncoder['encode']>,
  right: ReturnType<DeterministicTokenFieldEncoder['encode']>,
  excludedTokenIndex: number,
): string {
  return `natural-match-${sha(left.tokens.flatMap((token, tokenIndex) => tokenIndex === excludedTokenIndex
    ? [] : [Math.round(((token.standardizedValue + right.tokens[tokenIndex]!.standardizedValue) / 2) * 4) / 4]))}`;
}

function alignedCorridorFraction(left: readonly (readonly number[])[], right: readonly (readonly number[])[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  let within = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (r2AtomWithinStablePatternCorridor(left[index]!, right[index]!)) within++;
  }
  return within / left.length;
}

/**
 * A stable ordered road is the conjunction of its exact action sequence and
 * all of its R2 atom corridors. Public transition identities are retained on
 * each evidence item for audit, but cannot override the physical geometry.
 * Membership remains complete-link so one genuinely different atom cannot
 * hide behind nine matching atoms.
 */
function orderedStableRoadCompatible(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
): boolean {
  return left.length === right.length && left.length >= 2
    && left.every((point, index) => r2AtomWithinStablePatternCorridor(point, right[index]!));
}

function orderedPrefixCompatible(
  leftIdentities: readonly string[],
  rightIdentities: readonly string[],
  leftCoordinates: readonly (readonly number[])[],
  rightCoordinates: readonly (readonly number[])[],
  branchAtomIndex: number,
): boolean {
  if (!Number.isSafeInteger(branchAtomIndex) || branchAtomIndex < 0
    || branchAtomIndex >= leftIdentities.length || branchAtomIndex >= rightIdentities.length
    || branchAtomIndex >= leftCoordinates.length || branchAtomIndex >= rightCoordinates.length
    || leftIdentities[branchAtomIndex] !== rightIdentities[branchAtomIndex]) return false;
  for (let index = 0; index < branchAtomIndex; index++) {
    // A comparable prefix is the same real action in the same physical R2
    // corridor.  Extra public transitions are deliberately not required to
    // match here: they remain in each pattern and in the branch pre-perception
    // so R2A can test them as candidate conditions instead of using them to
    // forbid the comparison that would reveal the condition.
    if (leftIdentities[index] !== rightIdentities[index]
      || !r2AtomWithinStablePatternCorridor(leftCoordinates[index]!, rightCoordinates[index]!)) return false;
  }
  return true;
}

function patternCoordinate(path: readonly (readonly number[])[]): Vec3 {
  let arc = 0, turn = 0;
  for (let index = 1; index < path.length; index += 1) arc += vectorDistance(path[index]!, path[index - 1]!);
  for (let index = 2; index < path.length; index += 1) {
    const a = path[index - 1]!.map((value, axis) => value - path[index - 2]![axis]!);
    const b = path[index]!.map((value, axis) => value - path[index - 1]![axis]!);
    const ma = Math.hypot(...a), mb = Math.hypot(...b);
    if (ma > 1e-12 && mb > 1e-12) turn += 1 - a.reduce((sum, value, axis) => sum + value * b[axis]!, 0) / (ma * mb);
  }
  const displacement = vectorDistance(path[0]!, path.at(-1)!);
  // These are intrinsic shape moments of an R2 road. They are neither R2
  // coordinates copied into R2A nor world coordinates.
  return new Float64Array([Math.tanh(arc / 4) * 20 - 10,
    Math.tanh(displacement / 4) * 20 - 10, Math.tanh(turn / 4) * 20 - 10]);
}

function grade(pattern: Pick<R2StablePatternV1, 'supportCount' | 'contextIds' | 'orderedCorridorConsistency'
  | 'contradictionCount' | 'partitionStatus' | 'coreEventIds'>): R2AEvidenceGradeV1 {
  const contradictionRatio = pattern.contradictionCount / Math.max(1, pattern.supportCount + pattern.contradictionCount);
  if (pattern.partitionStatus === 'resolved' && pattern.supportCount >= 8
    && pattern.coreEventIds.length >= R2_STABLE_PATTERN_MINIMUM_CORE_V1
    && new Set(pattern.contextIds).size >= 4
    && pattern.orderedCorridorConsistency >= .8 && contradictionRatio <= .2) return 'predictive-stable';
  if (pattern.supportCount >= 2) return 'repeated-correlation';
  return 'single-observation';
}

function relationGrade(relation: R2AStablePatternHyperedgeV1, patternGrade: R2AEvidenceGradeV1): R2AEvidenceGradeV1 {
  const predictive = relationIsPredictive(relation, patternGrade);
  const supportedSets = relation.factorSetInterventions.filter(item => {
    if (item.pairIds.length < 4) return false;
    const successRate = item.branchChangeCount / item.pairIds.length;
    const minimumDrop = item.removalSelectionDrops.length === 0 ? 0 : Math.min(...item.removalSelectionDrops);
    return successRate >= .75 && minimumDrop >= .25;
  });
  const supportedFactorIds = new Set(supportedSets.flatMap(value => value.factorIds));
  const everyFactorCoveredBySupportedSet = relation.factorIds.length > 0
    && relation.factorIds.every(factorId => supportedFactorIds.has(factorId));
  if (everyFactorCoveredBySupportedSet && predictive) {
    return 'intervention-supported';
  }
  // Natural matches are observational evidence, never do(F).  They can only
  // elevate an already prospective predictive relation to a causal hypothesis
  // after every factor in the candidate relation has independently crossed its
  // band while all other measured public tokens stayed within the preregistered
  // tolerance.  Five non-reused pairs across two contexts, with >= 80%
  // directional agreement, make the claim falsifiable while leaving hidden
  // confounding explicitly unresolved.
  const everyCompetingFactorTested = relation.factorIds.length > 0 && relation.factorIds.every(factorId => {
    const contrasts = relation.naturalMatchedContrasts.filter(value => value.factorId === factorId);
    return contrasts.length >= 5 && new Set(contrasts.map(value => value.matchedContextId)).size >= 2
      && contrasts.filter(value => value.directionallyConsistent).length / contrasts.length >= .8;
  });
  if (everyCompetingFactorTested && predictive) return 'causal-hypothesis';
  if (predictive) return 'predictive-stable';
  if (relation.supportEventIds.length >= 2) return 'repeated-correlation';
  return 'single-observation';
}

/**
 * Delayed R2A learner. A first complete R2 event creates audit evidence only;
 * physical R2A deposition starts only after an independently repeated ordered
 * road exists. Factor edges target a stable-pattern identity, never one R2
 * endpoint/visit.
 */
export class R2AStablePatternLearnerV1 {
  readonly #encoder: DeterministicTokenFieldEncoder;
  readonly #medium: PhysicalMedium3D;
  readonly #patternPageId: string;
  readonly #factorPageId: string;
  readonly #patterns: R2StablePatternV1[] = [];
  readonly #factors: R2AOpaqueFactorNodeV1[] = [];
  readonly #relations: R2AStablePatternHyperedgeV1[] = [];
  readonly #evidence: PatternEvidenceStateV1[] = [];
  readonly #interventionRecords: R2AInterventionEvidenceV1[] = [];
  readonly #interventionProtocols: R2AInterventionProtocolV1[] = [];
  readonly #processed = new Set<string>();
  readonly #sourceAdapterIdentitySha256: string;
  #logicalTime = 0;

  constructor(encoder: DeterministicTokenFieldEncoder, state?: R2AStablePatternGraphStateV1,
    sourceAdapterIdentitySha256 = STANDALONE_QUALIFIED_R2_ADAPTER_IDENTITY_V1) {
    if (!encoder.isFrozen()) throw new Error('R2A-requires-frozen-public-factor-encoder');
    const expectedTopology = stablePatternTopology(sourceAdapterIdentitySha256);
    this.#sourceAdapterIdentitySha256 = sourceAdapterIdentitySha256;
    this.#encoder = encoder;
    if (!state) {
      this.#medium = new PhysicalMedium3D(R2A_CONFIG);
      this.#patternPageId = this.#medium.createPage(); this.#factorPageId = this.#medium.createPage(); return;
    }
    const persistedVersion = (state as unknown as { readonly version: string }).version;
    if (persistedVersion !== 'R2AStablePatternGraphV11'
      || sha(state.topology) !== sha(expectedTopology)
      || state.r2aMedium.config.name !== 'R2A') {
      throw new Error('legacy-R2A-graph-is-audit-only');
    }
    if (sha(state.r2aMedium.config) !== sha(R2A_CONFIG)
      || !Number.isFinite(state.logicalTime) || state.logicalTime < 0
      || state.r2aMedium.logicalTime !== state.logicalTime) {
      throw new Error('R2A-checkpoint-config-or-time-mismatch');
    }
    if (sha(state.encoder) !== sha(encoder.exportState())) throw new Error('R2A-factor-encoder-identity-mismatch');
    this.#medium = PhysicalMedium3D.fromSnapshot(state.r2aMedium);
    this.#patternPageId = state.patternPageId; this.#factorPageId = state.factorPageId;
    if (this.#patternPageId === this.#factorPageId || this.#medium.pageCount !== 2
      || ![this.#patternPageId, this.#factorPageId].every(pageId => this.#medium.pageIds().includes(pageId))) {
      throw new Error('R2A-checkpoint-page-missing');
    }
    if (!Array.isArray(state.interventionRecords) || !Array.isArray(state.interventionProtocols)) {
      throw new Error('legacy-R2A-intervention-aggregates-are-audit-only');
    }
    this.#patterns.push(...state.patterns.map(clonePattern)); this.#factors.push(...state.factors.map(cloneFactor));
    this.#evidence.push(...structuredClone(state.evidence));
    this.#relations.push(...state.relations.map(cloneRelation));
    this.#interventionRecords.push(...structuredClone(state.interventionRecords));
    this.#interventionProtocols.push(...structuredClone(state.interventionProtocols));
    state.processedEventIds.forEach(id => this.#processed.add(id)); this.#logicalTime = state.logicalTime;
    this.#validateRestoredState();
  }

  #validateRestoredState(): void {
    const unique = (values: readonly string[], error: string): void => {
      if (values.some(value => typeof value !== 'string' || value.length === 0)
        || new Set(values).size !== values.length) throw new Error(error);
    };
    const validIdentitySequence = (values: readonly string[]): boolean => values.length >= 2
      && values.every(value => typeof value === 'string' && value.length > 0);
    const evidenceIds = this.#evidence.map(value => value.eventId);
    unique(evidenceIds, 'R2A-checkpoint-evidence-identity-invalid');
    for (let evidenceIndex = 0; evidenceIndex < this.#evidence.length; evidenceIndex++) {
      const evidence = this.#evidence[evidenceIndex]!;
      if (!Number.isFinite(evidence.endedAt) || evidence.endedAt < 0
        || evidence.endedAt > this.#logicalTime
        || (evidenceIndex > 0 && evidence.endedAt < this.#evidence[evidenceIndex - 1]!.endedAt)
        || typeof evidence.patternId !== 'string' || evidence.patternId.length === 0
        || !['core', 'peripheral'].includes(evidence.membership)
        || !validIdentitySequence(evidence.orderedExperienceIdentities)
        || !validIdentitySequence(evidence.orderedTransitionTopologyIds)
        || evidence.orderedTransitionTopologyIds.length !== evidence.orderedExperienceIdentities.length
        || evidence.atomPrePerceptions.length !== evidence.orderedExperienceIdentities.length
        || evidence.atomPrePerceptions.some(perception => perception.length !== 256
          || perception.some(value => !Number.isFinite(value)))
        || evidence.orderedCoordinates.length !== evidence.orderedExperienceIdentities.length
        || evidence.orderedCoordinates.some(point => point.length !== 3
          || point.some((value, axis) => !Number.isFinite(value)
            || value < R2_CONFIG.boundary.min[axis]! || value > R2_CONFIG.boundary.max[axis]!))
        || evidence.contextId !== patternContextFingerprint(evidence.atomPrePerceptions
          .map(perception => new Float64Array(perception)))) {
        throw new Error('R2A-checkpoint-public-context-evidence-invalid');
      }
    }
    if (sha([...this.#processed].sort()) !== sha([...evidenceIds].sort())) {
      throw new Error('R2A-checkpoint-processed-evidence-mismatch');
    }
    const evidenceSet = new Set(evidenceIds);
    const evidenceById = new Map(this.#evidence.map(value => [value.eventId, value]));
    unique(this.#interventionRecords.map(value => value.pairId),
      'R2A-checkpoint-intervention-record-identity-invalid');
    unique(this.#interventionRecords.flatMap(value => [value.baselineEventId, value.interventionEventId]),
      'R2A-checkpoint-intervention-event-reused-across-graph');
    unique(this.#interventionProtocols.map(value => value.protocolId),
      'R2A-checkpoint-intervention-protocol-identity-invalid');
    const patternIds = this.#patterns.map(value => value.patternId), factorIds = this.#factors.map(value => value.factorId);
    const relationIds = this.#relations.map(value => value.relationId);
    unique(patternIds, 'R2A-checkpoint-pattern-identity-invalid');
    unique(factorIds, 'R2A-checkpoint-factor-identity-invalid');
    unique(relationIds, 'R2A-checkpoint-relation-identity-invalid');
    for (const protocol of this.#interventionProtocols) {
      const registeredIndex = evidenceIds.indexOf(protocol.registeredAfterEventId);
      const predictiveIndex = evidenceIds.indexOf(protocol.predictiveBoundaryEventId);
      const relation = this.#relations.find(value => value.relationId === protocol.relationId);
      const normalized = canonicalFactorSet(protocol.changedFactorIds);
      const expectedBoundary = relation
        ? this.#deriveInterventionMeasurementBoundary(relation, protocol.measurementBoundary?.sourcePairs ?? [])
        : null;
      if (protocol.version !== 'R2AInterventionProtocolV3' || !relationIds.includes(protocol.relationId)
        || normalized.some(id => !factorIds.includes(id))
        || !sameOrderedIdentities(protocol.changedFactorIds, normalized)
        || protocol.factorSetId !== factorSetIdentity(normalized) || registeredIndex < 0
        || normalized.some(id => !relation?.factorIds.includes(id)) || predictiveIndex < 0
        || registeredIndex < predictiveIndex || protocol.registeredEvidenceCount !== registeredIndex + 1
        || expectedBoundary === null || sha(protocol.measurementBoundary) !== sha(expectedBoundary)) {
        throw new Error('R2A-checkpoint-intervention-protocol-invalid');
      }
    }
    const assignedPatternEvents = new Set<string>();
    const patternPhysicalIds = new Set(this.#medium.traceIds(this.#patternPageId));
    const expectedPartitions = new Map<string, R2PhysicalRoadPartitionV1>();
    const partitionGroups = new Map<string, PatternEvidenceStateV1[]>();
    for (const evidence of this.#evidence) {
      const key = sha(evidence.orderedExperienceIdentities);
      const group = partitionGroups.get(key) ?? [];
      group.push(evidence); partitionGroups.set(key, group);
    }
    for (const group of partitionGroups.values()) for (const partition of derivePhysicalRoadPartitionV1(group)) {
      if (expectedPartitions.has(partition.revisionSha256)) {
        throw new Error('R2A-checkpoint-physical-partition-revision-collision');
      }
      expectedPartitions.set(partition.revisionSha256, partition);
    }
    for (const pattern of this.#patterns) {
      unique(pattern.memberEventIds, 'R2A-checkpoint-pattern-member-invalid');
      unique(pattern.coreEventIds, 'R2A-checkpoint-pattern-core-invalid');
      unique(pattern.peripheralEventIds, 'R2A-checkpoint-pattern-peripheral-invalid');
      unique(pattern.contextIds, 'R2A-checkpoint-pattern-context-invalid');
      unique(pattern.contradictionEventIds, 'R2A-checkpoint-pattern-contradiction-invalid');
      unique(pattern.physicalTraceIds, 'R2A-checkpoint-pattern-physical-identity-invalid');
      const expectedPartition = expectedPartitions.get(pattern.patternRevisionSha256);
      const memberEvidence = pattern.memberEventIds.map(eventId => evidenceById.get(eventId));
      const completeMemberEvidence = memberEvidence.filter(
        (value): value is PatternEvidenceStateV1 => value !== undefined);
      const medoid = expectedPartition ? evidenceById.get(expectedPartition.medoidEventId) : undefined;
      const expectedMemberIds = expectedPartition
        ? [...expectedPartition.coreEventIds, ...expectedPartition.peripheralEventIds]
          .sort((left, right) => evidenceIds.indexOf(left) - evidenceIds.indexOf(right)) : [];
      const expectedCoreIds = expectedPartition?.coreEventIds
        .slice().sort((left, right) => evidenceIds.indexOf(left) - evidenceIds.indexOf(right)) ?? [];
      const expectedPeripheralIds = expectedPartition?.peripheralEventIds
        .slice().sort((left, right) => evidenceIds.indexOf(left) - evidenceIds.indexOf(right)) ?? [];
      const expectedPhysicalTraceIds = expectedCoreIds.map(eventId => `r2a-pattern-evidence-${sha({ eventId })}`)
        .filter(id => patternPhysicalIds.has(id));
      const expectedContextIds = [...new Set(completeMemberEvidence.map(value => value.contextId))].sort();
      const expectedTopologyVariantCounts = pattern.prototypeCoordinates.map((_point, atomIndex) =>
        new Set(completeMemberEvidence.map(value => value.orderedTransitionTopologyIds[atomIndex]!)).size);
      if (!expectedPartition || !medoid || pattern.version !== 'R2StablePatternV4'
        || pattern.supportCount !== pattern.memberEventIds.length
        || completeMemberEvidence.length !== memberEvidence.length
        || pattern.contradictionCount !== pattern.contradictionEventIds.length
        || pattern.prototypeCoordinates.length < 2
        || !validIdentitySequence(pattern.orderedExperienceIdentities)
        || !validIdentitySequence(pattern.orderedTransitionTopologyIds)
        || !['resolved', 'representation-ambiguous'].includes(pattern.partitionStatus)
        || pattern.orderedTransitionTopologyVariantCounts.length !== pattern.prototypeCoordinates.length
        || pattern.orderedTransitionTopologyVariantCounts.some(value => !Number.isSafeInteger(value) || value < 1)
        || pattern.orderedExperienceIdentities.length !== pattern.prototypeCoordinates.length
        || pattern.orderedTransitionTopologyIds.length !== pattern.prototypeCoordinates.length
        || pattern.prototypeCoordinates.some(point => point.length !== 3
          || point.some((value, axis) => !Number.isFinite(value)
            || value < R2_CONFIG.boundary.min[axis]! || value > R2_CONFIG.boundary.max[axis]!))
        || !Number.isFinite(pattern.orderedCorridorConsistency)
        || pattern.orderedCorridorConsistency < 0 || pattern.orderedCorridorConsistency > 1
        || !Number.isFinite(pattern.physicalDiameter) || pattern.physicalDiameter < 0
        || (pattern.separationMargin !== null && !Number.isFinite(pattern.separationMargin))
        || pattern.grade !== grade(pattern)
        || pattern.physicalTraceIds.some(id => !patternPhysicalIds.has(id))
        || pattern.memberEventIds.some(id => !evidenceSet.has(id))
        || pattern.contradictionEventIds.some(id => !evidenceSet.has(id))
        || sha(pattern.memberEventIds) !== sha(expectedMemberIds)
        || sha(pattern.coreEventIds) !== sha(expectedCoreIds)
        || sha(pattern.peripheralEventIds) !== sha(expectedPeripheralIds)
        || pattern.partitionStatus !== expectedPartition.status
        || pattern.physicalDiameter !== expectedPartition.physicalDiameter
        || pattern.separationMargin !== expectedPartition.separationMargin
        || !sameOrderedIdentities(pattern.orderedExperienceIdentities, medoid.orderedExperienceIdentities)
        || !sameOrderedTransitionTopologies(pattern.orderedTransitionTopologyIds,
          medoid.orderedTransitionTopologyIds)
        || sha(pattern.orderedTransitionTopologyVariantCounts) !== sha(expectedTopologyVariantCounts)
        || sha(pattern.prototypeCoordinates) !== sha(medoid.orderedCoordinates)
        || pattern.orderedCorridorConsistency !== expectedCoreIds.length / Math.max(1, expectedMemberIds.length)
        || sha(pattern.physicalTraceIds) !== sha(expectedPhysicalTraceIds)
        || sha(pattern.contextIds) !== sha(expectedContextIds)) {
        throw new Error('R2A-checkpoint-pattern-invariant-failed');
      }
      for (const eventId of pattern.memberEventIds) {
        if (assignedPatternEvents.has(eventId)) throw new Error('R2A-evidence-assigned-to-multiple-patterns');
        const evidence = evidenceById.get(eventId)!;
        if (!sameOrderedIdentities(pattern.orderedExperienceIdentities, evidence.orderedExperienceIdentities)
          || evidence.patternId !== pattern.patternId
          || evidence.membership !== (pattern.coreEventIds.includes(eventId) ? 'core' : 'peripheral')) {
          throw new Error('R2A-checkpoint-pattern-ordered-identity-mismatch');
        }
        assignedPatternEvents.add(eventId);
      }
    }
    if (assignedPatternEvents.size !== this.#evidence.length
      || this.#patterns.length !== expectedPartitions.size) {
      throw new Error('R2A-checkpoint-physical-partition-coverage-invalid');
    }
    const factorPhysicalIds = new Set(this.#medium.traceIds(this.#factorPageId));
    for (const factor of this.#factors) {
      unique(factor.physicalVisitIds, 'R2A-checkpoint-factor-physical-identity-invalid');
      unique(factor.supportingEventIds, 'R2A-checkpoint-factor-support-invalid');
      if (factor.version !== 'R2AOpaqueFactorNodeV1'
        || !Number.isSafeInteger(factor.tokenIndex) || factor.tokenIndex < 0 || factor.tokenIndex >= 256
        || !Number.isFinite(factor.expectedStandardizedValue)
        || !Number.isFinite(factor.tolerance) || factor.tolerance <= 0
        || factor.physicalVisitIds.length !== factor.supportingEventIds.length
        || factor.physicalVisitIds.some(id => !factorPhysicalIds.has(id))
        || factor.supportingEventIds.some(id => !evidenceSet.has(id))) {
        throw new Error('R2A-checkpoint-factor-invariant-failed');
      }
    }
    const patternById = new Map(this.#patterns.map(value => [value.patternId, value]));
    if (this.#evidence.some(value => !patternById.get(value.patternId)?.memberEventIds.includes(value.eventId))) {
      throw new Error('R2A-checkpoint-evidence-pattern-membership-invalid');
    }
    const factorSet = new Set(factorIds);
    for (const relation of this.#relations) {
      unique(relation.factorIds, 'R2A-checkpoint-relation-factor-invalid');
      unique(relation.contrastPatternIds, 'R2A-checkpoint-relation-contrast-pattern-invalid');
      unique(relation.contrastPatternAdmissions.map(value => value.patternId),
        'R2A-checkpoint-relation-contrast-admission-invalid');
      unique(relation.supportEventIds, 'R2A-checkpoint-relation-support-invalid');
      unique(relation.contradictionEventIds, 'R2A-checkpoint-relation-contradiction-invalid');
      unique(relation.interventionPairIds, 'R2A-checkpoint-intervention-pair-invalid');
      unique(relation.interventionEventPairs, 'R2A-checkpoint-intervention-events-invalid');
      unique(relation.validationEventIds, 'R2A-checkpoint-validation-event-invalid');
      unique(relation.validationContextIds, 'R2A-checkpoint-validation-context-invalid');
      unique(relation.naturalMatchedContrasts.map(value => value.contrastId),
        'R2A-checkpoint-natural-contrast-identity-invalid');
      const pattern = patternById.get(relation.targetPatternId);
      if (relation.version !== 'R2AStablePatternHyperedgeV2'
        || !pattern || relation.factorIds.length === 0 || relation.factorIds.some(id => !factorSet.has(id))
        || !Number.isSafeInteger(relation.branchAtomIndex) || relation.branchAtomIndex < 0
        || relation.branchAtomIndex >= pattern.orderedExperienceIdentities.length
        || relation.exactNextActionIdentity !== pattern.orderedExperienceIdentities[relation.branchAtomIndex]
        || (relation.derivedFromRelationId !== null && (relation.derivedFromRelationId === relation.relationId
          || !relationIds.includes(relation.derivedFromRelationId)))
        || relation.contrastPatternIds.length !== 1
        || relation.contrastPatternIds.some(id => id === relation.targetPatternId || !patternById.has(id))
        || relation.contrastPatternAdmissions.length !== relation.contrastPatternIds.length
        || relation.contrastPatternAdmissions.some(value =>
          value.version !== 'R2AContrastPatternAdmissionV1'
          || !relation.contrastPatternIds.includes(value.patternId)
          || !evidenceSet.has(value.admittedAtEventId))
        || relation.supportEventIds.some(id => !evidenceSet.has(id))
        || relation.contradictionEventIds.some(id => !evidenceSet.has(id))
        || relation.validationEventIds.some(id => !evidenceSet.has(id))
        || relation.validationPatternIds.length !== relation.validationEventIds.length
        || relation.validationPatternIds.some(id => id !== relation.targetPatternId
          && !relation.contrastPatternIds.includes(id))
        || !evidenceSet.has(relation.formedAtEventId)
        || (relation.predictiveSinceEventId !== null && !evidenceSet.has(relation.predictiveSinceEventId))
        || relation.validationCorrectCount < 0
        || relation.validationCorrectCount > relation.validationEventIds.length
        || new Set(relation.factorSetInterventions.map(value => value.factorSetId)).size
          !== relation.factorSetInterventions.length
        || relation.factorSetInterventions.some(value => value.factorIds.length === 0
          || !sameOrderedIdentities(value.factorIds, canonicalFactorSet(value.factorIds))
          || value.factorSetId !== factorSetIdentity(value.factorIds)
          || value.factorIds.some(factorId => !relation.factorIds.includes(factorId))
          || new Set(value.pairIds).size !== value.pairIds.length
          || value.pairIds.some(pairId => !relation.interventionPairIds.includes(pairId))
          || value.branchChangeCount < 0 || value.branchChangeCount > value.pairIds.length
          || value.removalSelectionDrops.length !== value.pairIds.length
          || value.removalSelectionDrops.some(drop => !Number.isFinite(drop) || drop < 0 || drop > 1))
        || relation.interventionPairIds.length !== relation.interventionEventPairs.length
        || new Set(relation.factorSetInterventions.flatMap(value => value.pairIds)).size
          !== relation.interventionPairIds.length
        || relation.factorSetInterventions.flatMap(value => value.pairIds).some(pairId =>
          !relation.interventionPairIds.includes(pairId))
        || relation.factorSetInterventions.reduce((sum, value) => sum + value.branchChangeCount, 0)
          !== relation.interventionSuccessCount
        || relation.naturalMatchedContrasts.some(value => value.version !== 'R2ANaturalMatchedContrastV1'
          || !relation.factorIds.includes(value.factorId)
          || !evidenceSet.has(value.earlierEventId) || !evidenceSet.has(value.laterEventId)
          || typeof value.matchedContextId !== 'string' || value.matchedContextId.length === 0
          || typeof value.directionallyConsistent !== 'boolean')
        || relation.removalSelectionDrops.length !== relation.interventionPairIds.length
        || relation.interventionSuccessCount < 0
        || relation.interventionSuccessCount > relation.interventionPairIds.length
        || relation.relationId !== `r2a-relation-${sha({ factorIds: [...relation.factorIds].sort(),
          branchAtomIndex: relation.branchAtomIndex, action: relation.exactNextActionIdentity,
          targetPatternId: relation.targetPatternId,
          contrastPatternIds: [...relation.contrastPatternIds].sort(),
          derivedFromRelationId: relation.derivedFromRelationId })}`
        || relation.grade !== relationGrade(relation, pattern.grade)) {
        throw new Error('R2A-checkpoint-relation-invariant-failed');
      }
      for (const contrastPatternId of relation.contrastPatternIds) {
        const contrast = patternById.get(contrastPatternId)!;
        if (!orderedPrefixCompatible(pattern.orderedExperienceIdentities, contrast.orderedExperienceIdentities,
          pattern.prototypeCoordinates, contrast.prototypeCoordinates,
          relation.branchAtomIndex)
          || !r2ObservedBranchDifferent(pattern.prototypeCoordinates[relation.branchAtomIndex]!,
            contrast.prototypeCoordinates[relation.branchAtomIndex]!)) {
          throw new Error('R2A-checkpoint-relation-branch-contract-invalid');
        }
      }
      if (relation.supportEventIds.some(eventId => !this.#evidenceTestsRelation(
        this.#evidence.find(value => value.eventId === eventId)!, relation))
        || relation.contradictionEventIds.some(eventId => !this.#evidenceTestsRelation(
          this.#evidence.find(value => value.eventId === eventId)!, relation))) {
        throw new Error('R2A-checkpoint-relation-evidence-branch-mismatch');
      }
      const evidenceIndex = new Map(this.#evidence.map((value, index) => [value.eventId, index]));
      const formedIndex = evidenceIndex.get(relation.formedAtEventId)!;
      if (relation.contrastPatternAdmissions.some(value =>
        evidenceIndex.get(value.admittedAtEventId)! < formedIndex)) {
        throw new Error('R2A-checkpoint-contrast-admission-precedes-relation');
      }
      const predictiveSinceIndex = relation.predictiveSinceEventId === null
        ? -1 : evidenceIndex.get(relation.predictiveSinceEventId)!;
      const factorTokenIndices = new Set(relation.factorIds.map(factorId =>
        this.#factors.find(value => value.factorId === factorId)!.tokenIndex));
      const expectedValidation = this.#evidence.slice(formedIndex + 1)
        .filter(value => this.#evidenceTestsRelation(value, relation));
      let expectedCorrect = 0;
      const expectedValidationContexts = new Set<string>();
      for (const evidence of expectedValidation) {
        const field = this.#fieldAt(evidence, relation.branchAtomIndex);
        const predictedTarget = relation.factorIds.every(factorId => {
          const factor = this.#factors.find(value => value.factorId === factorId)!;
          return Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
            - factor.expectedStandardizedValue) <= factor.tolerance;
        });
        const actualTarget = pattern.memberEventIds.includes(evidence.eventId);
        expectedCorrect += Number(predictedTarget === actualTarget);
        expectedValidationContexts.add(relationValidationContextId(field, factorTokenIndices));
      }
      if (sha(relation.validationEventIds) !== sha(expectedValidation.map(value => value.eventId))
        || sha(relation.validationPatternIds) !== sha(expectedValidation.map(value => value.patternId))
        || relation.validationCorrectCount !== expectedCorrect
        || sha([...relation.validationContextIds].sort()) !== sha([...expectedValidationContexts].sort())) {
        throw new Error(`R2A-checkpoint-heldout-validation-not-reproducible:${relation.relationId}`
          + `:stored=${relation.validationEventIds.length}/${relation.validationCorrectCount}`
          + `:expected=${expectedValidation.length}/${expectedCorrect}`
          + `:storedEvents=${sha(relation.validationEventIds)}`
          + `:expectedEvents=${sha(expectedValidation.map(value => value.eventId))}`);
      }
      if (relationIsPredictive(relation, pattern.grade)) {
        if (predictiveSinceIndex <= formedIndex || !relation.validationEventIds.includes(relation.predictiveSinceEventId!)) {
          throw new Error('R2A-checkpoint-predictive-boundary-invalid');
        }
        const boundaryValidation = expectedValidation.filter(value => evidenceIndex.get(value.eventId)! <= predictiveSinceIndex);
        const boundaryContexts = new Set<string>(); let boundaryCorrect = 0;
        for (const evidence of boundaryValidation) {
          const field = this.#fieldAt(evidence, relation.branchAtomIndex);
          const predictedTarget = relation.factorIds.every(factorId => {
            const factor = this.#factors.find(value => value.factorId === factorId)!;
            return Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
              - factor.expectedStandardizedValue) <= factor.tolerance;
          });
          boundaryCorrect += Number(predictedTarget === (evidence.patternId === pattern.patternId));
          boundaryContexts.add(relationValidationContextId(field, factorTokenIndices));
        }
        const supportAtBoundary = relation.supportEventIds.filter(id => evidenceIndex.get(id)! <= predictiveSinceIndex);
        const contradictionsAtBoundary = relation.contradictionEventIds.filter(id => evidenceIndex.get(id)! <= predictiveSinceIndex);
        const patternMembersAtBoundary = pattern.memberEventIds.filter(id => evidenceIndex.get(id)! <= predictiveSinceIndex);
        const patternContradictionsAtBoundary = pattern.contradictionEventIds
          .filter(id => evidenceIndex.get(id)! <= predictiveSinceIndex);
        const patternCoreAtBoundary = pattern.coreEventIds.filter(id => evidenceIndex.get(id)! <= predictiveSinceIndex);
        const patternContextsAtBoundary = patternMembersAtBoundary.map(id => this.#evidence[evidenceIndex.get(id)!]!.contextId);
        const patternGradeAtBoundary = grade({ supportCount: patternMembersAtBoundary.length,
          contextIds: patternContextsAtBoundary,
          orderedCorridorConsistency: patternCoreAtBoundary.length / Math.max(1, patternMembersAtBoundary.length),
          contradictionCount: patternContradictionsAtBoundary.length,
          partitionStatus: pattern.partitionStatus, coreEventIds: patternCoreAtBoundary });
        const relationAtBoundary = { ...relation, supportEventIds: supportAtBoundary,
          contradictionEventIds: contradictionsAtBoundary,
          validationEventIds: boundaryValidation.map(value => value.eventId), validationCorrectCount: boundaryCorrect,
          validationPatternIds: boundaryValidation.map(value => value.patternId),
          validationContextIds: [...boundaryContexts], naturalMatchedContrasts: [], interventionPairIds: [],
          interventionEventPairs: [], interventionSuccessCount: 0, removalSelectionDrops: [],
          factorSetInterventions: [] } satisfies R2AStablePatternHyperedgeV1;
        if (!relationIsPredictive(relationAtBoundary, patternGradeAtBoundary)) {
          throw new Error('R2A-checkpoint-predictive-boundary-precedes-actual-threshold');
        }
      } else if (relation.predictiveSinceEventId !== null || relation.naturalMatchedContrasts.length > 0) {
        throw new Error('R2A-checkpoint-nonpredictive-relation-retained-confirmation-evidence');
      }
      const usedByFactor = new Map<string, Set<string>>();
      for (const contrast of relation.naturalMatchedContrasts) {
        const earlierIndex = evidenceIndex.get(contrast.earlierEventId)!;
        const laterIndex = evidenceIndex.get(contrast.laterEventId)!;
        const used = usedByFactor.get(contrast.factorId) ?? new Set<string>();
        if (earlierIndex <= predictiveSinceIndex || laterIndex <= earlierIndex
          || used.has(contrast.earlierEventId) || used.has(contrast.laterEventId)) {
          throw new Error('R2A-checkpoint-natural-contrast-order-or-reuse-invalid');
        }
        used.add(contrast.earlierEventId); used.add(contrast.laterEventId);
        usedByFactor.set(contrast.factorId, used);
        const earlier = this.#evidence[earlierIndex]!, later = this.#evidence[laterIndex]!;
        const factor = this.#factors.find(value => value.factorId === contrast.factorId)!;
        const earlierField = this.#fieldAt(earlier, relation.branchAtomIndex);
        const laterField = this.#fieldAt(later, relation.branchAtomIndex);
        const earlierMatches = Math.abs(earlierField.tokens[factor.tokenIndex]!.standardizedValue
          - factor.expectedStandardizedValue) <= factor.tolerance;
        const laterMatches = Math.abs(laterField.tokens[factor.tokenIndex]!.standardizedValue
          - factor.expectedStandardizedValue) <= factor.tolerance;
        const allOtherPublicTokensMatched = earlierField.tokens.every((token, tokenIndex) =>
          tokenIndex === factor.tokenIndex || Math.abs(token.standardizedValue
            - laterField.tokens[tokenIndex]!.standardizedValue) <= .25);
        const otherRelationFactorsStayedOnSameSide = relation.factorIds.filter(id => id !== factor.factorId)
          .every(factorId => {
            const otherFactor = this.#factors.find(value => value.factorId === factorId)!;
            const earlierActive = Math.abs(earlierField.tokens[otherFactor.tokenIndex]!.standardizedValue
              - otherFactor.expectedStandardizedValue) <= otherFactor.tolerance;
            const laterActive = Math.abs(laterField.tokens[otherFactor.tokenIndex]!.standardizedValue
              - otherFactor.expectedStandardizedValue) <= otherFactor.tolerance;
            return earlierActive === laterActive;
          });
        const comparablePrefix = orderedPrefixCompatible(earlier.orderedExperienceIdentities,
          later.orderedExperienceIdentities, earlier.orderedCoordinates, later.orderedCoordinates,
          relation.branchAtomIndex);
        const earlierTarget = earlier.patternId === pattern.patternId;
        const laterTarget = later.patternId === pattern.patternId;
        const comparedOnlyRegisteredBranches = [earlier, later].every(value => value.patternId === pattern.patternId
          || relation.contrastPatternIds.includes(value.patternId)) && earlierTarget !== laterTarget;
        const expectedContrastId = `natural-contrast-${sha({ relationId: relation.relationId,
          factorId: factor.factorId, earlierEventId: earlier.eventId, laterEventId: later.eventId })}`;
        if (!this.#evidenceTestsRelation(earlier, relation) || !this.#evidenceTestsRelation(later, relation)
          || earlierMatches === laterMatches || !allOtherPublicTokensMatched || !otherRelationFactorsStayedOnSameSide
          || !comparablePrefix || !comparedOnlyRegisteredBranches
          || contrast.matchedContextId !== naturalMatchedContextId(earlierField, laterField, factor.tokenIndex)
          || contrast.directionallyConsistent !== (earlierTarget === earlierMatches && laterTarget === laterMatches)
          || contrast.contrastId !== expectedContrastId) {
          throw new Error('R2A-checkpoint-natural-contrast-content-invalid');
        }
      }
      if (relation.derivedFromRelationId !== null) {
        const parent = this.#relations.find(value => value.relationId === relation.derivedFromRelationId)!;
        // A joint-set intervention proves only the whole set.  It cannot be
        // reused to derive one of its members as an independently causal edge.
        const supported = parent.factorSetInterventions.filter(item => item.factorIds.length === 1
          && item.pairIds.length >= 4 && item.branchChangeCount / item.pairIds.length >= .75
          && item.removalSelectionDrops.length >= 4 && Math.min(...item.removalSelectionDrops) >= .25)
          .flatMap(item => item.factorIds).sort();
        const nullFactors = parent.factorSetInterventions.filter(item => item.factorIds.length === 1
          && item.pairIds.length >= 4 && item.branchChangeCount === 0
          && item.removalSelectionDrops.length >= 4
          && item.removalSelectionDrops.every(drop => Math.abs(drop) <= 1e-12))
          .flatMap(item => item.factorIds);
        if (parent.targetPatternId !== relation.targetPatternId
          || parent.branchAtomIndex !== relation.branchAtomIndex
          || parent.exactNextActionIdentity !== relation.exactNextActionIdentity
          || supported.length === 0 || supported.length >= parent.factorIds.length
          || supported.length + nullFactors.length !== parent.factorIds.length
          || !sameOrderedIdentities([...relation.factorIds].sort(), supported)
          || sha(parent.contrastPatternIds) !== sha(relation.contrastPatternIds)) {
          throw new Error('R2A-checkpoint-derived-relation-not-supported-by-real-interventions');
        }
        const expectedSupport: string[] = [], expectedContradictions: string[] = [];
        for (const evidence of this.#evidence.filter(value => this.#evidenceTestsRelation(value, relation))) {
          const field = this.#fieldAt(evidence, relation.branchAtomIndex);
          const predictedTarget = relation.factorIds.every(factorId => {
            const factor = this.#factors.find(value => value.factorId === factorId)!;
            return Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
              - factor.expectedStandardizedValue) <= factor.tolerance;
          });
          const actualTarget = evidence.patternId === relation.targetPatternId;
          if (predictedTarget && actualTarget) expectedSupport.push(evidence.eventId);
          else if (predictedTarget !== actualTarget) expectedContradictions.push(evidence.eventId);
        }
        if (sha([...relation.supportEventIds].sort()) !== sha([...new Set(expectedSupport)].sort())
          || sha([...relation.contradictionEventIds].sort())
            !== sha([...new Set(expectedContradictions)].sort())) {
          throw new Error('R2A-checkpoint-derived-relation-real-evidence-not-reproducible');
        }
      }
      const interventionRecords = this.#interventionRecords.filter(value => value.relationId === relation.relationId);
      const assessedInterventions = interventionRecords.map(value => this.#assessIntervention(value));
      if (sha(relation.interventionPairIds) !== sha(interventionRecords.map(value => value.pairId))
        || sha(relation.interventionEventPairs) !== sha(assessedInterventions.map(value => value.pairKey))
        || relation.interventionSuccessCount !== assessedInterventions.filter(value => value.branchChanged).length
        || sha(relation.removalSelectionDrops) !== sha(assessedInterventions.map(value => value.removalDrop))) {
        throw new Error('R2A-checkpoint-intervention-aggregate-not-reproducible');
      }
      for (const factorSummary of relation.factorSetInterventions) {
        const records = interventionRecords.filter(value => sameOrderedIdentities(
          canonicalFactorSet(value.changedFactorIds), factorSummary.factorIds));
        const assessments = records.map(value => assessedInterventions[interventionRecords.indexOf(value)]!);
        if (sha(factorSummary.pairIds) !== sha(records.map(value => value.pairId))
          || factorSummary.branchChangeCount !== assessments.filter(value => value.branchChanged).length
          || sha(factorSummary.removalSelectionDrops) !== sha(assessments.map(value => value.removalDrop))) {
          throw new Error('R2A-checkpoint-factor-intervention-aggregate-not-reproducible');
        }
      }
    }
    if (this.#interventionRecords.some(value => !relationIds.includes(value.relationId))) {
      throw new Error('R2A-checkpoint-intervention-record-relation-missing');
    }
    if (this.#interventionRecords.some(value => !this.#interventionProtocols.some(protocol =>
      protocol.protocolId === value.protocolId && protocol.relationId === value.relationId
      && sameOrderedIdentities(protocol.changedFactorIds, canonicalFactorSet(value.changedFactorIds))))) {
      throw new Error('R2A-checkpoint-intervention-record-protocol-missing');
    }
  }

  advanceTo(activeSeconds: number): void {
    if (!Number.isFinite(activeSeconds) || activeSeconds < this.#logicalTime) throw new Error('R2A-time-reversed');
    const elapsed = activeSeconds - this.#logicalTime;
    if (elapsed > 0) { this.#medium.recover(elapsed); this.#logicalTime = activeSeconds; }
  }

  get logicalTime(): number { return this.#logicalTime; }

  #fieldAt(evidence: PatternEvidenceStateV1, atomIndex: number) {
    const perception = evidence.atomPrePerceptions[atomIndex];
    if (!perception) throw new Error('R2A-branch-atom-perception-missing');
    return this.#encoder.encode(`${evidence.eventId}:atom:${atomIndex}`, new Float64Array(perception));
  }

  #evidenceTestsRelation(evidence: PatternEvidenceStateV1,
    relation: R2AStablePatternHyperedgeV1): boolean {
    const target = this.#patterns.find(value => value.patternId === relation.targetPatternId);
    if (!target || (evidence.patternId !== target.patternId
      && !relation.contrastPatternIds.includes(evidence.patternId))) return false;
    if (evidence.patternId !== target.patternId) {
      const admission = relation.contrastPatternAdmissions.find(value => value.patternId === evidence.patternId);
      const evidenceIndex = this.#evidence.findIndex(value => value.eventId === evidence.eventId);
      const admissionIndex = admission
        ? this.#evidence.findIndex(value => value.eventId === admission.admittedAtEventId) : -1;
      if (!admission || evidenceIndex < 0 || admissionIndex < 0 || evidenceIndex <= admissionIndex) return false;
    }
    return orderedPrefixCompatible(target.orderedExperienceIdentities, evidence.orderedExperienceIdentities,
      target.prototypeCoordinates, evidence.orderedCoordinates,
      relation.branchAtomIndex)
      && evidence.orderedExperienceIdentities[relation.branchAtomIndex] === relation.exactNextActionIdentity;
  }

  #reconcilePhysicalRoadPartitions(
    previousAssignments: ReadonlyMap<string, { readonly patternId: string; readonly membership: 'core' | 'peripheral' }>,
  ): ReadonlySet<string> {
    const previousPatterns = this.#patterns.map(clonePattern);
    const evidenceOrder = new Map(this.#evidence.map((value, index) => [value.eventId, index]));
    const mediumTraceIds = new Set(this.#medium.traceIds(this.#patternPageId));
    const groups = new Map<string, PatternEvidenceStateV1[]>();
    for (const evidence of this.#evidence) {
      const key = sha(evidence.orderedExperienceIdentities);
      const group = groups.get(key) ?? [];
      group.push(evidence); groups.set(key, group);
    }
    const reconciled: R2StablePatternV1[] = [];
    const usedPatternIds = new Set<string>();
    for (const group of groups.values()) {
      const partitions = derivePhysicalRoadPartitionV1(group);
      const old = previousPatterns.filter(pattern => sameOrderedIdentities(
        pattern.orderedExperienceIdentities, group[0]!.orderedExperienceIdentities));
      const usedOld = new Set<string>();
      const orderedPartitions = [...partitions].sort((left, right) =>
        right.coreEventIds.length - left.coreEventIds.length
        || left.revisionSha256.localeCompare(right.revisionSha256, 'en'));
      for (const partition of orderedPartitions) {
        const memberSet = new Set([...partition.coreEventIds, ...partition.peripheralEventIds]);
        const retained = old.filter(pattern => !usedOld.has(pattern.patternId)).map(pattern => ({ pattern,
          overlap: pattern.memberEventIds.filter(eventId => memberSet.has(eventId)).length }))
          .filter(value => value.overlap > 0)
          .sort((left, right) => right.overlap - left.overlap
            || left.pattern.patternId.localeCompare(right.pattern.patternId, 'en'))[0]?.pattern ?? null;
        let patternId = retained?.patternId ?? `r2-pattern-${sha({
          orderedExperienceIdentities: group[0]!.orderedExperienceIdentities,
          medoidPhysicalFingerprint: physicalRoadFingerprint(group.find(value =>
            value.eventId === partition.medoidEventId)!),
        })}`;
        if (usedPatternIds.has(patternId)) patternId = `r2-pattern-${sha({ patternId,
          revision: partition.revisionSha256 })}`;
        usedPatternIds.add(patternId); if (retained) usedOld.add(retained.patternId);
        const memberEventIds = [...memberSet].sort((left, right) => evidenceOrder.get(left)! - evidenceOrder.get(right)!);
        const coreEventIds = [...partition.coreEventIds].sort((left, right) => evidenceOrder.get(left)! - evidenceOrder.get(right)!);
        const peripheralEventIds = [...partition.peripheralEventIds]
          .sort((left, right) => evidenceOrder.get(left)! - evidenceOrder.get(right)!);
        const members = memberEventIds.map(eventId => this.#evidence[evidenceOrder.get(eventId)!]!);
        const medoid = this.#evidence[evidenceOrder.get(partition.medoidEventId)!]!;
        const contexts = [...new Set(members.map(value => value.contextId))].sort();
        const topologyVariantCounts = medoid.orderedCoordinates.map((_point, atomIndex) =>
          new Set(members.map(value => value.orderedTransitionTopologyIds[atomIndex]!)).size);
        const physicalTraceIds = coreEventIds.map(eventId => `r2a-pattern-evidence-${sha({ eventId })}`)
          .filter(traceId => mediumTraceIds.has(traceId));
        const contradictionEventIds = retained?.contradictionEventIds.filter(eventId => memberSet.has(eventId)) ?? [];
        const basis: R2StablePatternV1 = { version: 'R2StablePatternV4', patternId,
          prototypeCoordinates: medoid.orderedCoordinates.map(point => [...point]),
          orderedExperienceIdentities: [...medoid.orderedExperienceIdentities],
          orderedTransitionTopologyIds: [...medoid.orderedTransitionTopologyIds],
          orderedTransitionTopologyVariantCounts: topologyVariantCounts,
          memberEventIds, coreEventIds, peripheralEventIds,
          partitionStatus: partition.status, physicalDiameter: partition.physicalDiameter,
          separationMargin: partition.separationMargin, patternRevisionSha256: partition.revisionSha256,
          contextIds: contexts, supportCount: memberEventIds.length,
          contradictionCount: contradictionEventIds.length, contradictionEventIds,
          orderedCorridorConsistency: coreEventIds.length / Math.max(1, memberEventIds.length),
          grade: 'single-observation', physicalTraceIds };
        const pattern = { ...basis, grade: grade(basis) } satisfies R2StablePatternV1;
        reconciled.push(pattern);
        for (const evidence of members) Object.assign(evidence, { patternId,
          membership: partition.coreEventIds.includes(evidence.eventId) ? 'core' as const : 'peripheral' as const });
      }
    }
    this.#patterns.splice(0, this.#patterns.length,
      ...reconciled.sort((left, right) => left.patternId.localeCompare(right.patternId, 'en')));
    const affected = new Set<string>();
    for (const evidence of this.#evidence) {
      const previous = previousAssignments.get(evidence.eventId);
      if (previous && (previous.patternId !== evidence.patternId || previous.membership !== evidence.membership)) {
        affected.add(previous.patternId); affected.add(evidence.patternId);
      }
    }
    for (const pattern of previousPatterns) if (!this.#patterns.some(value => value.patternId === pattern.patternId)) {
      affected.add(pattern.patternId);
    }
    return affected;
  }

  #invalidateRelationsForRepartition(patternIds: ReadonlySet<string>): void {
    const invalid = new Set(this.#relations.filter(relation => patternIds.has(relation.targetPatternId)
      || relation.contrastPatternIds.some(patternId => patternIds.has(patternId)))
      .map(relation => relation.relationId));
    const patternById = new Map(this.#patterns.map(value => [value.patternId, value]));
    // Pattern membership can remain stable while a newly repeated physical
    // road changes the real medoid.  Keep a relation only if its physical
    // prefix/branch contract and its already recorded evidence are still true
    // under that current medoid.  This is invalidation, not a relabel or an
    // automatic relation repair.
    for (const relation of this.#relations) {
      const target = patternById.get(relation.targetPatternId);
      const geometryStillValid = target !== undefined
        && relation.branchAtomIndex >= 0
        && relation.branchAtomIndex < target.orderedExperienceIdentities.length
        && relation.exactNextActionIdentity === target.orderedExperienceIdentities[relation.branchAtomIndex]
        && relation.contrastPatternIds.every(patternId => {
          const contrast = patternById.get(patternId);
          return contrast !== undefined && orderedPrefixCompatible(
            target.orderedExperienceIdentities, contrast.orderedExperienceIdentities,
            target.prototypeCoordinates, contrast.prototypeCoordinates, relation.branchAtomIndex)
            && r2ObservedBranchDifferent(target.prototypeCoordinates[relation.branchAtomIndex]!,
              contrast.prototypeCoordinates[relation.branchAtomIndex]!);
        });
      const evidenceStillValid = geometryStillValid
        && [...relation.supportEventIds, ...relation.contradictionEventIds].every(eventId => {
          const evidence = this.#evidence.find(value => value.eventId === eventId);
          return evidence !== undefined && this.#evidenceTestsRelation(evidence, relation);
        });
      if (!geometryStillValid || !evidenceStillValid) invalid.add(relation.relationId);
    }
    if (invalid.size === 0) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const relation of this.#relations) if (relation.derivedFromRelationId
        && invalid.has(relation.derivedFromRelationId) && !invalid.has(relation.relationId)) {
        invalid.add(relation.relationId); changed = true;
      }
    }
    if (invalid.size === 0) return;
    if (this.#interventionProtocols.some(value => invalid.has(value.relationId))
      || this.#interventionRecords.some(value => invalid.has(value.relationId))) {
      throw new Error('R2A-physical-partition-changed-after-intervention');
    }
    for (let index = this.#relations.length - 1; index >= 0; index--) {
      if (invalid.has(this.#relations[index]!.relationId)) this.#relations.splice(index, 1);
    }
  }

  observe(input: R2PatternEvidenceInputV1,
    r2TraceActive: (pageId: string, traceId: string) => boolean): R2StablePatternV1 {
    if (input.version !== 'R2PatternEvidenceInputV1' || input.trustedActualObservation !== true
      || input.event.completion !== 'complete' || !input.event.learningEligible) throw new Error('R2A-rejects-incomplete-or-censored-event');
    if (this.#processed.has(input.event.eventId)) throw new Error('R2-event-already-processed-by-R2A');
    if (input.event.pageId === null || input.event.traceId === null
      || !r2TraceActive(input.event.pageId, input.event.traceId)) throw new Error('R2A-requires-active-R2-road');
    if (input.event.orderedExperienceIdentities.length !== input.event.atomIds.length
      || input.event.orderedTransitionTopologyIds.length !== input.event.atomIds.length
      || input.event.orderedTransitionTopologyIds.some(value => !/^[a-f0-9]{64}$/i.test(value))
      || input.atomPrePerceptions.length !== input.event.atomIds.length
      || input.atomPrePerceptions.some(value => value.length !== 256 || value.some(item => !Number.isFinite(item)))) {
      throw new Error('R2A-requires-one-public-pre-perception-per-R1-atom');
    }
    // Reject an out-of-order real event before touching the physical medium,
    // pattern prototypes, contradiction counters, or the processed-id set.
    // HierarchicalPhysicalMemory already stages R2A transactionally, but the
    // learner's own public boundary must be atomic as well.
    const previousEvidence = this.#evidence.at(-1);
    if (previousEvidence && input.event.endedAt < previousEvidence.endedAt) {
      throw new Error('R2A-evidence-real-time-order-reversed');
    }
    const contextId = patternContextFingerprint(input.atomPrePerceptions);
    // A real boundary can be observed after the final R1 atom ended. Delayed
    // evidence is deposited at the current physical time; it never reverses
    // recovery time to pretend it arrived earlier.
    if (input.event.endedAt > this.#logicalTime) this.advanceTo(input.event.endedAt);
    const previousAssignments = new Map(this.#evidence.map(value => [value.eventId,
      { patternId: value.patternId, membership: value.membership }] as const));
    const evidence: PatternEvidenceStateV1 = { eventId: input.event.eventId, endedAt: input.event.endedAt, contextId,
      patternId: '', membership: 'core', orderedExperienceIdentities: [...input.event.orderedExperienceIdentities],
      orderedTransitionTopologyIds: [...input.event.orderedTransitionTopologyIds],
      atomPrePerceptions: input.atomPrePerceptions.map(value => [...value]),
      orderedCoordinates: input.event.orderedCoordinates.map(point => [...point]) };
    this.#evidence.push(evidence);
    const affected = this.#reconcilePhysicalRoadPartitions(previousAssignments);
    this.#invalidateRelationsForRepartition(affected);
    let pattern = this.#patterns.find(value => value.patternId === evidence.patternId)!;
    // Physical mode evidence begins with the second genuinely repeated core
    // observation.  It is event-addressed so later physical reinterpretation
    // never requires rewriting a historical pattern-labelled visit.
    const visitId = `r2a-pattern-evidence-${sha({ eventId: input.event.eventId })}`;
    if (evidence.membership === 'core' && pattern.coreEventIds.length >= 2
      && !this.#medium.traceIds(this.#patternPageId).includes(visitId)) {
      this.#medium.depositVisit(this.#patternPageId, patternCoordinate(evidence.orderedCoordinates), 1, visitId);
      this.#reconcilePhysicalRoadPartitions(new Map(this.#evidence.map(value => [value.eventId,
        { patternId: value.patternId, membership: value.membership }] as const)));
      pattern = this.#patterns.find(value => value.patternId === evidence.patternId)!;
    }
    this.#processed.add(input.event.eventId);
    // A new event can complete the comparison evidence for either direction
    // of a repeated branch. Re-evaluate every extant target pattern rather
    // than only the pattern observed last; otherwise the learned factor
    // direction depends on presentation order (all A then all B learns only
    // B -> A). Prospective outcome grading still starts after formation.
    for (const candidateTarget of this.#patterns) {
      this.#discoverDifferentialRelations(candidateTarget, evidence);
    }
    this.#recordRelationOutcomes(pattern, evidence);
    return clonePattern(pattern);
  }

  #discoverDifferentialRelations(target: R2StablePatternV1, input: PatternEvidenceStateV1): void {
    for (const other of this.#patterns) {
      // Factors are differences between already stable repeated outcomes.
      // Provisional two-sample means are evidence for observing more, but
      // freezing them into an opaque factor would make factor identity depend
      // on presentation order.
      if (other.patternId === target.patternId
        || gradeRankForR2A(target.grade) < gradeRankForR2A('predictive-stable')
        || gradeRankForR2A(other.grade) < gradeRankForR2A('predictive-stable')) continue;
      const maximumBranchIndex = Math.min(target.orderedExperienceIdentities.length,
        other.orderedExperienceIdentities.length);
      for (let branchAtomIndex = 0; branchAtomIndex < maximumBranchIndex; branchAtomIndex++) {
        if (!orderedPrefixCompatible(target.orderedExperienceIdentities, other.orderedExperienceIdentities,
          target.prototypeCoordinates, other.prototypeCoordinates,
          branchAtomIndex)
          || !r2ObservedBranchDifferent(target.prototypeCoordinates[branchAtomIndex]!,
            other.prototypeCoordinates[branchAtomIndex]!)) continue;
        const exactNextActionIdentity = target.orderedExperienceIdentities[branchAtomIndex]!;
        if (this.#relations.some(value => value.derivedFromRelationId === null
          && value.targetPatternId === target.patternId
          && value.contrastPatternIds.includes(other.patternId)
          && value.branchAtomIndex === branchAtomIndex
          && value.exactNextActionIdentity === exactNextActionIdentity)) continue;
        const targetEvidence = this.#evidence.filter(value => target.memberEventIds.includes(value.eventId)
          && orderedPrefixCompatible(target.orderedExperienceIdentities, value.orderedExperienceIdentities,
            target.prototypeCoordinates, value.orderedCoordinates,
            branchAtomIndex));
        const otherEvidence = this.#evidence.filter(value => other.memberEventIds.includes(value.eventId)
          && orderedPrefixCompatible(target.orderedExperienceIdentities, value.orderedExperienceIdentities,
            target.prototypeCoordinates, value.orderedCoordinates,
            branchAtomIndex));
        if (targetEvidence.length < 2 || otherEvidence.length < 2) continue;
        const targetFields = targetEvidence.map(value => this.#fieldAt(value, branchAtomIndex));
        const otherFields = otherEvidence.map(value => this.#fieldAt(value, branchAtomIndex));
        const factorIds: string[] = [];
        for (let tokenIndex = 0; tokenIndex < 256; tokenIndex++) {
        const targetMean = targetFields.reduce((sum, field) => sum
          + field.tokens[tokenIndex]!.standardizedValue, 0) / targetFields.length;
        const otherMean = otherFields.reduce((sum, field) => sum
          + field.tokens[tokenIndex]!.standardizedValue, 0) / otherFields.length;
        if (Math.abs(targetMean - otherMean) < .5) continue;
        const targetConsistency = targetFields.filter(field => Math.abs(
          field.tokens[tokenIndex]!.standardizedValue - targetMean) <= .5).length / targetFields.length;
        const otherConsistency = otherFields.filter(field => Math.abs(
          field.tokens[tokenIndex]!.standardizedValue - otherMean) <= .5).length / otherFields.length;
        if (targetConsistency < .8 || otherConsistency < .8) continue;
        const expectedBand = Math.round(targetMean * 2) / 2;
        const factorId = `opaque-factor-${sha({ tokenIndex, expectedBand })}`;
        let factor = this.#factors.find(value => value.factorId === factorId);
        if (!factor) {
          factor = { version: 'R2AOpaqueFactorNodeV1', factorId, tokenIndex,
            expectedStandardizedValue: expectedBand, tolerance: .5,
            physicalVisitIds: [], supportingEventIds: [] };
          this.#factors.push(factor);
        }
        // Once the between-pattern residual is visible, deposit every
        // independent target-side observation exactly once.  This is delayed
        // physical evidence: no single R2 event can create or deepen a factor.
        for (let evidenceIndex = 0; evidenceIndex < targetEvidence.length; evidenceIndex++) {
          const evidence = targetEvidence[evidenceIndex]!;
          if (factor.supportingEventIds.includes(evidence.eventId)) continue;
          const token = targetFields[evidenceIndex]!.tokens[tokenIndex]!;
          if (Math.abs(token.standardizedValue - targetMean) > factor.tolerance) continue;
          const visitId = `r2a-factor-evidence-${sha({ factorId, eventId: evidence.eventId })}`;
          this.#medium.depositVisit(this.#factorPageId, token.coordinate, 1, visitId);
          Object.assign(factor, { physicalVisitIds: [...factor.physicalVisitIds, visitId],
            supportingEventIds: [...factor.supportingEventIds, evidence.eventId] });
        }
          factorIds.push(factorId);
        }
        if (factorIds.length === 0) continue;
        const normalized = [...new Set(factorIds)].sort();
        const contrastPatternIds = [other.patternId];
        const relationId = `r2a-relation-${sha({ factorIds: normalized, branchAtomIndex,
          action: exactNextActionIdentity, targetPatternId: target.patternId,
          contrastPatternIds, derivedFromRelationId: null })}`;
        let relation = this.#relations.find(value => value.relationId === relationId);
        if (!relation) {
          const supportingEventIds = targetEvidence.filter(evidence => {
          const field = this.#fieldAt(evidence, branchAtomIndex);
          return normalized.every(factorId => {
            const factor = this.#factors.find(value => value.factorId === factorId)!;
            return Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
              - factor.expectedStandardizedValue) <= factor.tolerance;
          });
        }).map(value => value.eventId);
          relation = { version: 'R2AStablePatternHyperedgeV2', relationId, factorIds: normalized,
          branchAtomIndex, exactNextActionIdentity, targetPatternId: target.patternId, derivedFromRelationId: null,
          contrastPatternIds,
          contrastPatternAdmissions: [{ version: 'R2AContrastPatternAdmissionV1',
            patternId: other.patternId, admittedAtEventId: input.eventId }],
          supportEventIds: [...new Set(supportingEventIds)].sort(), contradictionEventIds: [], interventionPairIds: [],
          interventionEventPairs: [], interventionSuccessCount: 0, removalSelectionDrops: [],
          factorSetInterventions: [], formedAtEventId: input.eventId, predictiveSinceEventId: null,
          validationEventIds: [], validationPatternIds: [], validationCorrectCount: 0, validationContextIds: [],
          naturalMatchedContrasts: [],
            grade: 'single-observation' };
          Object.assign(relation, { grade: relationGrade(relation, target.grade) });
          this.#relations.push(relation);
        } else {
          // The current event is handled exactly once by the prospective
          // outcome recorder below. Do not mutate formation support here.
          continue;
        }
      }
    }
  }

  #recordRelationOutcomes(actualPattern: R2StablePatternV1, input: PatternEvidenceStateV1): void {
    for (const relation of this.#relations.filter(value => this.#evidenceTestsRelation(input, value))) {
      if (relation.formedAtEventId === input.eventId) continue;
      const current = this.#fieldAt(input, relation.branchAtomIndex);
      const predictedTarget = relation.factorIds.every(factorId => {
        const factor = this.#factors.find(value => value.factorId === factorId)!;
        return Math.abs(current.tokens[factor.tokenIndex]!.standardizedValue
          - factor.expectedStandardizedValue) <= factor.tolerance;
      });
      const actualTarget = relation.targetPatternId === actualPattern.patternId;
      const correct = predictedTarget === actualTarget;
      const targetPattern = this.#patterns.find(value => value.patternId === relation.targetPatternId)!;
      const update: Partial<R2AStablePatternHyperedgeV1> = {
        validationEventIds: [...relation.validationEventIds, input.eventId],
        validationPatternIds: [...relation.validationPatternIds, input.patternId],
        validationCorrectCount: relation.validationCorrectCount + Number(correct),
        validationContextIds: [...new Set([...relation.validationContextIds,
          relationValidationContextId(current, new Set(relation.factorIds.map(factorId =>
            this.#factors.find(value => value.factorId === factorId)!.tokenIndex)))])].sort(),
      };
      if (actualTarget && predictedTarget && !relation.supportEventIds.includes(input.eventId)) {
        Object.assign(update, { supportEventIds: [...relation.supportEventIds, input.eventId] });
      } else if (!correct && !relation.contradictionEventIds.includes(input.eventId)) {
        Object.assign(update, { contradictionEventIds: [...relation.contradictionEventIds, input.eventId] });
      }
      Object.assign(relation, update);
      const nextGrade = relationGrade(relation, targetPattern.grade);
      if (gradeRankForR2A(nextGrade) < gradeRankForR2A('predictive-stable')) {
        Object.assign(relation, { predictiveSinceEventId: null, naturalMatchedContrasts: [], grade: nextGrade });
        continue;
      }
      if (relation.predictiveSinceEventId === null) Object.assign(relation, {
        predictiveSinceEventId: input.eventId,
      });
      Object.assign(relation, { grade: nextGrade });
      this.#recordNaturalMatchedContrasts(relation, input.eventId);
      Object.assign(relation, { grade: relationGrade(relation, targetPattern.grade) });
    }
  }

  #recordNaturalMatchedContrasts(relation: R2AStablePatternHyperedgeV1, laterEventId: string): void {
    if (gradeRankForR2A(relation.grade) < gradeRankForR2A('predictive-stable')
      || relation.predictiveSinceEventId === null) return;
    const laterIndex = this.#evidence.findIndex(value => value.eventId === laterEventId);
    const predictiveSinceIndex = this.#evidence.findIndex(value => value.eventId === relation.predictiveSinceEventId);
    if (laterIndex <= predictiveSinceIndex) return;
    const later = this.#evidence[laterIndex]!;
    if (!this.#evidenceTestsRelation(later, relation)) return;
    const laterField = this.#fieldAt(later, relation.branchAtomIndex);
    const targetPattern = this.#patterns.find(value => value.patternId === relation.targetPatternId)!;
    const laterTarget = later.patternId === targetPattern.patternId;
    if (!laterTarget && !relation.contrastPatternIds.includes(later.patternId)) return;
    const additions: R2ANaturalMatchedContrastV1[] = [];
    for (const factorId of relation.factorIds) {
      const factor = this.#factors.find(value => value.factorId === factorId)!;
      const existing = [...relation.naturalMatchedContrasts, ...additions]
        .filter(value => value.factorId === factorId);
      const used = new Set(existing.flatMap(value => [value.earlierEventId, value.laterEventId]));
      if (used.has(later.eventId)) continue;
      const laterMatches = Math.abs(laterField.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance;
      const earlier = this.#evidence.slice(predictiveSinceIndex + 1, laterIndex).find(candidate => {
        if (used.has(candidate.eventId) || !this.#evidenceTestsRelation(candidate, relation)) return false;
        const earlierTarget = candidate.patternId === targetPattern.patternId;
        if (earlierTarget === laterTarget || (!earlierTarget
          && !relation.contrastPatternIds.includes(candidate.patternId))) return false;
        if (!orderedPrefixCompatible(candidate.orderedExperienceIdentities, later.orderedExperienceIdentities,
          candidate.orderedCoordinates, later.orderedCoordinates,
          relation.branchAtomIndex)) return false;
        const earlierField = this.#fieldAt(candidate, relation.branchAtomIndex);
        const earlierMatches = Math.abs(earlierField.tokens[factor.tokenIndex]!.standardizedValue
          - factor.expectedStandardizedValue) <= factor.tolerance;
        if (earlierMatches === laterMatches) return false;
        const publicContextMatched = earlierField.tokens.every((token, tokenIndex) => tokenIndex === factor.tokenIndex
          || Math.abs(token.standardizedValue - laterField.tokens[tokenIndex]!.standardizedValue) <= .25);
        if (!publicContextMatched) return false;
        return relation.factorIds.filter(id => id !== factorId).every(otherFactorId => {
          const otherFactor = this.#factors.find(value => value.factorId === otherFactorId)!;
          const earlierActive = Math.abs(earlierField.tokens[otherFactor.tokenIndex]!.standardizedValue
            - otherFactor.expectedStandardizedValue) <= otherFactor.tolerance;
          const laterActive = Math.abs(laterField.tokens[otherFactor.tokenIndex]!.standardizedValue
            - otherFactor.expectedStandardizedValue) <= otherFactor.tolerance;
          return earlierActive === laterActive;
        });
      });
      if (!earlier) continue;
      const earlierField = this.#fieldAt(earlier, relation.branchAtomIndex);
      const earlierMatches = Math.abs(earlierField.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance;
      const earlierTarget = earlier.patternId === targetPattern.patternId;
      additions.push({ version: 'R2ANaturalMatchedContrastV1',
        contrastId: `natural-contrast-${sha({ relationId: relation.relationId, factorId,
          earlierEventId: earlier.eventId, laterEventId: later.eventId })}`,
        factorId, earlierEventId: earlier.eventId, laterEventId: later.eventId,
        matchedContextId: naturalMatchedContextId(earlierField, laterField, factor.tokenIndex),
        directionallyConsistent: earlierTarget === earlierMatches && laterTarget === laterMatches });
    }
    if (additions.length > 0) Object.assign(relation, {
      naturalMatchedContrasts: [...relation.naturalMatchedContrasts, ...additions],
    });
  }

  #deriveInterventionMeasurementBoundary(
    relation: R2AStablePatternHyperedgeV1,
    sourcePairsInput: readonly R2AFormationMatchedPairV1[],
  ): R2AInterventionMeasurementBoundaryV1 {
    if (!Array.isArray(sourcePairsInput) || sourcePairsInput.length < 4) {
      throw new Error('intervention-measurement-boundary-requires-four-formation-pairs');
    }
    const sourcePairs = sourcePairsInput.map(value => ({ ...value }));
    const allEventIds = sourcePairs.flatMap(value => [value.targetEventId, value.contrastEventId]);
    if (allEventIds.some(value => typeof value !== 'string' || value.length === 0)
      || new Set(allEventIds).size !== allEventIds.length) {
      throw new Error('intervention-measurement-boundary-pair-identity-invalid-or-reused');
    }
    const targetPattern = this.#patterns.find(value => value.patternId === relation.targetPatternId)!;
    const pairFields = sourcePairs.map(pair => {
      const target = this.#evidence.find(value => value.eventId === pair.targetEventId);
      const contrast = this.#evidence.find(value => value.eventId === pair.contrastEventId);
      const formationCompatible = (evidence: PatternEvidenceStateV1): boolean =>
        orderedPrefixCompatible(targetPattern.orderedExperienceIdentities,
          evidence.orderedExperienceIdentities, targetPattern.prototypeCoordinates,
          evidence.orderedCoordinates, relation.branchAtomIndex)
        && evidence.orderedExperienceIdentities[relation.branchAtomIndex]
          === relation.exactNextActionIdentity;
      if (!target || !contrast || target.patternId !== targetPattern.patternId
        || !relation.contrastPatternIds.includes(contrast.patternId)
        || !formationCompatible(target) || !formationCompatible(contrast)) {
        throw new Error('intervention-measurement-boundary-pairs-must-be-real-target-contrast-evidence');
      }
      return { target: this.#fieldAt(target, relation.branchAtomIndex),
        contrast: this.#fieldAt(contrast, relation.branchAtomIndex) };
    });
    const factorResolution = Math.min(...relation.factorIds.map(factorId =>
      this.#factors.find(value => value.factorId === factorId)!.tolerance));
    const changedChannels: R2AMeasurementBoundaryChannelV1[] = [];
    const invariantTokenIndices: number[] = [];
    const unresolvedChannels: R2AUnresolvedMeasurementChannelV1[] = [];
    for (let tokenIndex = 0; tokenIndex < 256; tokenIndex++) {
      const deltas = pairFields.map(value => value.target.tokens[tokenIndex]!.standardizedValue
        - value.contrast.tokens[tokenIndex]!.standardizedValue);
      const absolute = deltas.map(Math.abs).sort((left, right) => left - right);
      const medianAbsoluteDelta = absolute[Math.floor(absolute.length / 2)]!;
      const direction: -1 | 1 = deltas.reduce((sum, value) => sum + value, 0) >= 0 ? 1 : -1;
      const directionalCoverage = deltas.filter(value => Math.sign(value) === direction).length / deltas.length;
      const minimumAbsoluteDelta = Math.min(...absolute), maximumAbsoluteDelta = Math.max(...absolute);
      if (directionalCoverage >= .8 && medianAbsoluteDelta + 1e-12 >= factorResolution) {
        changedChannels.push({ tokenIndex, direction, minimumAbsoluteDelta, maximumAbsoluteDelta });
      } else if (maximumAbsoluteDelta <= R2A_INTERVENTION_INVARIANT_TOLERANCE_V1 + 1e-12) {
        invariantTokenIndices.push(tokenIndex);
      } else unresolvedChannels.push({ tokenIndex, maximumAbsoluteDelta });
    }
    const factorTokenIndices = relation.factorIds.map(factorId =>
      this.#factors.find(value => value.factorId === factorId)!.tokenIndex);
    if (factorTokenIndices.some(tokenIndex => !changedChannels.some(value => value.tokenIndex === tokenIndex))) {
      throw new Error('intervention-factor-is-not-part-of-preregistered-measurement-change-bundle');
    }
    const base = { version: 'R2AInterventionMeasurementBoundaryV1' as const,
      sourcePairs, changedChannels, invariantTokenIndices, unresolvedChannels };
    return { ...base, identitySha256: measurementBoundaryIdentity(base) };
  }

  registerInterventionProtocol(input: R2AInterventionProtocolRegistrationV3): R2AInterventionProtocolV1 {
    if (!input.protocolId || this.#interventionProtocols.some(value => value.protocolId === input.protocolId)) {
      throw new Error('intervention-protocol-identity-invalid-or-reused');
    }
    const changedFactorIds = registrationFactorIds(input);
    const relation = this.#relations.find(value => value.relationId === input.relationId);
    const pattern = relation && this.#patterns.find(value => value.patternId === relation.targetPatternId);
    if (!relation || !pattern || changedFactorIds.some(id => !relation.factorIds.includes(id))
      || !relationIsPredictive(relation, pattern.grade) || relation.predictiveSinceEventId === null) {
      throw new Error('intervention-protocol-requires-current-predictive-relation-and-factor-set');
    }
    const latest = this.#evidence.at(-1);
    if (!latest) throw new Error('intervention-protocol-requires-prior-real-evidence');
    const measurementBoundary = this.#deriveInterventionMeasurementBoundary(
      relation, input.formationMatchedPairs);
    const protocol: R2AInterventionProtocolV1 = { version: 'R2AInterventionProtocolV3',
      protocolId: input.protocolId, relationId: input.relationId,
      factorSetId: factorSetIdentity(changedFactorIds), changedFactorIds,
      predictiveBoundaryEventId: relation.predictiveSinceEventId,
      registeredAfterEventId: latest.eventId, registeredEvidenceCount: this.#evidence.length,
      measurementBoundary };
    this.#interventionProtocols.push(protocol);
    return structuredClone(protocol);
  }

  #assessIntervention(value: R2AInterventionEvidenceV1): AssessedInterventionV1 {
    if (value.version !== 'R2AInterventionEvidenceV1'
      || value.trustedActualObservation !== true || value.baselineEventId === value.interventionEventId) {
      throw new Error('invalid-R2A-intervention-evidence');
    }
    const relation = this.#relations.find(item => item.relationId === value.relationId);
    const changedFactorIds = canonicalFactorSet(value.changedFactorIds);
    if (!sameOrderedIdentities(value.changedFactorIds, changedFactorIds)
      || !relation || changedFactorIds.some(id => !relation.factorIds.includes(id))) {
      throw new Error('intervention-does-not-isolate-one-preregistered-factor-set');
    }
    const protocol = this.#interventionProtocols.find(item => item.protocolId === value.protocolId);
    if (!protocol || protocol.relationId !== value.relationId
      || protocol.factorSetId !== factorSetIdentity(changedFactorIds)
      || !sameOrderedIdentities(protocol.changedFactorIds, changedFactorIds)) {
      throw new Error('intervention-evidence-lacks-preregistered-protocol');
    }
    const pairKey = [...new Set([value.baselineEventId, value.interventionEventId])].sort().join('|');
    const baseline = this.#evidence.find(item => item.eventId === value.baselineEventId);
    const intervention = this.#evidence.find(item => item.eventId === value.interventionEventId);
    if (!baseline || !intervention || !this.#evidenceTestsRelation(baseline, relation)
      || !this.#evidenceTestsRelation(intervention, relation)) {
      throw new Error('intervention-events-must-be-real-same-action-R2-evidence');
    }
    const formedIndex = this.#evidence.findIndex(item => item.eventId === relation.formedAtEventId);
    const baselineIndex = this.#evidence.findIndex(item => item.eventId === value.baselineEventId);
    const interventionIndex = this.#evidence.findIndex(item => item.eventId === value.interventionEventId);
    if (formedIndex < 0 || baselineIndex <= formedIndex || interventionIndex <= baselineIndex) {
      throw new Error('intervention-must-be-a-later-ordered-test-of-the-formed-relation');
    }
    if (baselineIndex < protocol.registeredEvidenceCount || interventionIndex < protocol.registeredEvidenceCount) {
      throw new Error('intervention-events-predate-preregistered-protocol');
    }
    if (this.#interventionRecords.some(item => item.pairId !== value.pairId
      && [item.baselineEventId, item.interventionEventId]
      .some(eventId => eventId === value.baselineEventId || eventId === value.interventionEventId))) {
      throw new Error('intervention-event-reused-across-pairs');
    }
    const baselineField = this.#fieldAt(baseline, relation.branchAtomIndex);
    const interventionField = this.#fieldAt(intervention, relation.branchAtomIndex);
    const changedFactors = changedFactorIds.map(factorId => this.#factors.find(item => item.factorId === factorId)!);
    if (!orderedPrefixCompatible(baseline.orderedExperienceIdentities, intervention.orderedExperienceIdentities,
      baseline.orderedCoordinates, intervention.orderedCoordinates,
      relation.branchAtomIndex)) {
      throw new Error('intervention-events-do-not-share-comparable-R2-prefix');
    }
    for (const factor of changedFactors) {
      const changedDelta = Math.abs(baselineField.tokens[factor.tokenIndex]!.standardizedValue
        - interventionField.tokens[factor.tokenIndex]!.standardizedValue);
      if (changedDelta <= factor.tolerance) throw new Error('intervention-factor-set-member-did-not-change');
    }
    const pattern = this.#patterns.find(item => item.patternId === relation.targetPatternId)!;
    const baselineTarget = baseline.patternId === pattern.patternId;
    const interventionTarget = intervention.patternId === pattern.patternId;
    if ((!baselineTarget && !relation.contrastPatternIds.includes(baseline.patternId))
      || (!interventionTarget && !relation.contrastPatternIds.includes(intervention.patternId))
      || (!baselineTarget && !interventionTarget)) {
      throw new Error('intervention-pair-does-not-test-registered-competing-patterns');
    }
    const targetField = baselineTarget ? baselineField : interventionField;
    const contrastField = baselineTarget ? interventionField : baselineField;
    // One real condition can project onto many public measurement channels.
    // The protocol freezes that anonymous projection from earlier matched
    // target/contrast pairs.  It is an audit boundary only: causal credit
    // remains attached to the canonical factor set, never to these channels.
    for (const channel of protocol.measurementBoundary.changedChannels) {
      const delta = Math.abs(targetField.tokens[channel.tokenIndex]!.standardizedValue
        - contrastField.tokens[channel.tokenIndex]!.standardizedValue);
      if (delta > channel.maximumAbsoluteDelta
        + R2A_INTERVENTION_INVARIANT_TOLERANCE_V1 + 1e-12) {
        throw new Error(`intervention-measurement-change-exceeded-preregistered-envelope:token=${channel.tokenIndex}`);
      }
    }
    for (const tokenIndex of protocol.measurementBoundary.invariantTokenIndices) {
      const delta = Math.abs(baselineField.tokens[tokenIndex]!.standardizedValue
        - interventionField.tokens[tokenIndex]!.standardizedValue);
      if (delta > R2A_INTERVENTION_INVARIANT_TOLERANCE_V1 + 1e-12) {
        throw new Error('matched-intervention-public-context-not-held-constant'
          + `:token=${tokenIndex}:delta=${delta}`);
      }
    }
    for (const channel of protocol.measurementBoundary.unresolvedChannels) {
      const delta = Math.abs(baselineField.tokens[channel.tokenIndex]!.standardizedValue
        - interventionField.tokens[channel.tokenIndex]!.standardizedValue);
      if (delta > channel.maximumAbsoluteDelta + R2A_INTERVENTION_INVARIANT_TOLERANCE_V1 + 1e-12) {
        throw new Error(`intervention-unresolved-measurement-exceeded-preregistered-envelope:token=${channel.tokenIndex}`);
      }
    }
    for (const factorId of relation.factorIds.filter(id => !changedFactorIds.includes(id))) {
      const factor = this.#factors.find(item => item.factorId === factorId)!;
      const delta = Math.abs(baselineField.tokens[factor.tokenIndex]!.standardizedValue
        - interventionField.tokens[factor.tokenIndex]!.standardizedValue);
      const baselineActive = Math.abs(baselineField.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance;
      const interventionActive = Math.abs(interventionField.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance;
      if (delta > factor.tolerance || baselineActive !== interventionActive) {
        throw new Error('intervention-changed-outside-preregistered-factor-set');
      }
    }
    const matchesExpected = (field: ReturnType<DeterministicTokenFieldEncoder['encode']>): boolean =>
      changedFactors.every(factor => Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance);
    const baselineMatches = matchesExpected(baselineField), interventionMatches = matchesExpected(interventionField);
    if (baselineMatches === interventionMatches) throw new Error('intervention-did-not-cross-factor-activation-boundary');
    const branchChanged = baselineTarget !== interventionTarget;
    if (branchChanged) {
      const targetMatches = baselineTarget ? baselineMatches : interventionMatches;
      if (!targetMatches) throw new Error('target-pattern-occurs-on-wrong-factor-side');
    }
    const predictsTarget = (field: ReturnType<DeterministicTokenFieldEncoder['encode']>, removeChanged: boolean): boolean =>
      relation.factorIds.filter(id => !removeChanged || !changedFactorIds.includes(id)).every(factorId => {
        const factor = this.#factors.find(item => item.factorId === factorId)!;
        return Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
          - factor.expectedStandardizedValue) <= factor.tolerance;
      });
    const fullAccuracy = (Number(predictsTarget(baselineField, false) === baselineTarget)
      + Number(predictsTarget(interventionField, false) === interventionTarget)) / 2;
    const reducedAccuracy = (Number(predictsTarget(baselineField, true) === baselineTarget)
      + Number(predictsTarget(interventionField, true) === interventionTarget)) / 2;
    const removalDrop = Math.max(0, fullAccuracy - reducedAccuracy);
    const contradictionEventId = !branchChanged && baselineTarget && interventionTarget
      ? (baselineMatches ? intervention.eventId : baseline.eventId) : null;
    return { relation, factorSetId: factorSetIdentity(changedFactorIds), changedFactorIds,
      pairKey, branchChanged, removalDrop, contradictionEventId };
  }

  recordIntervention(value: R2AInterventionEvidenceV1): void {
    const normalizedValue: R2AInterventionEvidenceV1 = { ...value,
      changedFactorIds: canonicalFactorSet(value.changedFactorIds) };
    const existingRecord = this.#interventionRecords.find(item => item.pairId === normalizedValue.pairId);
    if (existingRecord) {
      if (sha(existingRecord) !== sha(normalizedValue)) throw new Error('intervention-pair-id-reused-across-graph');
      return;
    }
    const assessed = this.#assessIntervention(normalizedValue);
    const { relation, factorSetId, changedFactorIds, pairKey, branchChanged, removalDrop,
      contradictionEventId } = assessed;
    if (relation.interventionEventPairs.includes(pairKey)) throw new Error('intervention-event-pair-reused');
    let factorSummary = relation.factorSetInterventions.find(item => item.factorSetId === factorSetId);
    if (!factorSummary) {
      factorSummary = { factorSetId, factorIds: changedFactorIds, pairIds: [], branchChangeCount: 0,
        removalSelectionDrops: [] };
      Object.assign(relation, { factorSetInterventions: [...relation.factorSetInterventions, factorSummary]
        .sort((left, right) => left.factorSetId.localeCompare(right.factorSetId, 'en')) });
    }
    Object.assign(factorSummary, { pairIds: [...factorSummary.pairIds, normalizedValue.pairId],
      branchChangeCount: factorSummary.branchChangeCount + Number(branchChanged),
      removalSelectionDrops: [...factorSummary.removalSelectionDrops, removalDrop] });
    Object.assign(relation, { interventionPairIds: [...relation.interventionPairIds, normalizedValue.pairId],
      interventionEventPairs: [...relation.interventionEventPairs, pairKey],
      interventionSuccessCount: relation.interventionSuccessCount + Number(branchChanged),
      removalSelectionDrops: [...relation.removalSelectionDrops, removalDrop],
      contradictionEventIds: contradictionEventId && !relation.contradictionEventIds.includes(contradictionEventId)
        ? [...relation.contradictionEventIds, contradictionEventId] : relation.contradictionEventIds });
    this.#interventionRecords.push(structuredClone(normalizedValue));
    const pattern = this.#patterns.find(item => item.patternId === relation.targetPatternId)!;
    const nextGrade = relationGrade(relation, pattern.grade);
    Object.assign(relation, relationIsPredictive(relation, pattern.grade)
      ? { grade: nextGrade }
      : { grade: nextGrade, predictiveSinceEventId: null, naturalMatchedContrasts: [] });
    this.#deriveMinimalInterventionRelations();
  }

  #deriveMinimalInterventionRelations(): void {
    const latest = this.#evidence.at(-1);
    if (!latest) return;
    for (const parent of [...this.#relations]) {
      if (parent.factorIds.length < 2) continue;
      // Only singleton interventions can justify removing individual members.
      // A successful joint set remains a joint hyperedge and never launders
      // each encoded member into a separate causal claim.
      const supported = parent.factorSetInterventions.filter(item => item.factorIds.length === 1
        && item.pairIds.length >= 4 && item.branchChangeCount / item.pairIds.length >= .75
        && Math.min(...item.removalSelectionDrops) >= .25).flatMap(item => item.factorIds);
      const nullFactors = parent.factorSetInterventions.filter(item => item.factorIds.length === 1
        && item.pairIds.length >= 4 && item.branchChangeCount === 0
        && item.removalSelectionDrops.every(drop => Math.abs(drop) <= 1e-12)).flatMap(item => item.factorIds);
      if (supported.length === 0 || supported.length >= parent.factorIds.length
        || supported.length + nullFactors.length !== parent.factorIds.length) continue;
      const normalized = [...supported].sort();
      if (this.#relations.some(value => value.derivedFromRelationId === parent.relationId
        && sameOrderedIdentities(value.factorIds, normalized))) continue;
      const target = this.#patterns.find(value => value.patternId === parent.targetPatternId)!;
      const relationId = `r2a-relation-${sha({ factorIds: normalized, branchAtomIndex: parent.branchAtomIndex,
        action: parent.exactNextActionIdentity, targetPatternId: parent.targetPatternId,
        contrastPatternIds: [...parent.contrastPatternIds].sort(),
        derivedFromRelationId: parent.relationId })}`;
      const supportEventIds: string[] = [], contradictionEventIds: string[] = [];
      for (const evidence of this.#evidence.filter(value => this.#evidenceTestsRelation(value, parent))) {
        const field = this.#fieldAt(evidence, parent.branchAtomIndex);
        const predictedTarget = normalized.every(factorId => {
          const factor = this.#factors.find(value => value.factorId === factorId)!;
          return Math.abs(field.tokens[factor.tokenIndex]!.standardizedValue
            - factor.expectedStandardizedValue) <= factor.tolerance;
        });
        const actualTarget = evidence.patternId === target.patternId;
        if (predictedTarget && actualTarget) supportEventIds.push(evidence.eventId);
        else if (predictedTarget !== actualTarget) contradictionEventIds.push(evidence.eventId);
      }
      const relation: R2AStablePatternHyperedgeV1 = { version: 'R2AStablePatternHyperedgeV2', relationId,
        factorIds: normalized, branchAtomIndex: parent.branchAtomIndex,
        exactNextActionIdentity: parent.exactNextActionIdentity, targetPatternId: parent.targetPatternId,
        derivedFromRelationId: parent.relationId, contrastPatternIds: [...parent.contrastPatternIds],
        contrastPatternAdmissions: parent.contrastPatternIds.map(patternId => ({
          version: 'R2AContrastPatternAdmissionV1', patternId, admittedAtEventId: latest.eventId,
        })),
        supportEventIds: [...new Set(supportEventIds)].sort(),
        contradictionEventIds: [...new Set(contradictionEventIds)].sort(), interventionPairIds: [],
        interventionEventPairs: [], interventionSuccessCount: 0, removalSelectionDrops: [],
        factorSetInterventions: [], formedAtEventId: latest.eventId, predictiveSinceEventId: null,
        validationEventIds: [], validationPatternIds: [], validationCorrectCount: 0, validationContextIds: [],
        naturalMatchedContrasts: [], grade: 'single-observation' };
      Object.assign(relation, { grade: relationGrade(relation, target.grade) });
      this.#relations.push(relation);
    }
  }

  compareCurrentFactors(relationId: string, perception: Float64Array): R2ACurrentFactorComparisonV1 {
    const relation = this.#relations.find(value => value.relationId === relationId);
    if (!relation) throw new Error('unknown-R2A-stable-pattern-relation');
    const encoded = this.#encoder.encode(`r3-${relationId}`, perception);
    const matched: string[] = [], conflicted: string[] = [], unknown: string[] = [], strengths: number[] = [];
    for (const factorId of relation.factorIds) {
      const factor = this.#factors.find(value => value.factorId === factorId);
      if (!factor) { unknown.push(factorId); continue; }
      const physical = factor.physicalVisitIds.some(id => this.#medium.basinContainingVisit(this.#factorPageId, id) !== null);
      if (!physical) { unknown.push(factorId); continue; }
      const delta = Math.abs(encoded.tokens[factor.tokenIndex]!.standardizedValue - factor.expectedStandardizedValue);
      if (delta <= factor.tolerance) { matched.push(factorId); strengths.push(clamp01(1 - delta / factor.tolerance)); }
      else conflicted.push(factorId);
    }
    const pattern = this.#patterns.find(value => value.patternId === relation.targetPatternId)!;
    const physicalPattern = pattern.physicalTraceIds.some(id => this.#medium.basinContainingVisit(this.#patternPageId, id) !== null);
    const applicability = physicalPattern && conflicted.length === 0 && unknown.length === 0
      ? Math.min(...strengths, 1) : 0;
    return { version: 'R2ACurrentFactorComparisonV1', relationId, targetPatternId: relation.targetPatternId,
      requiredFactorIds: [...relation.factorIds].sort(), matchedFactorIds: matched.sort(),
      conflictedFactorIds: conflicted.sort(), unknownFactorIds: unknown.sort(), physicalPatternActive: physicalPattern,
      applicability,
      evidenceGrade: relation.grade,
      predictionEligible: applicability > 0 && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(relation.grade),
      highConfidenceActionEligible: applicability > 0 && relation.grade === 'intervention-supported' };
  }

  assessContinuation(patternId: string, orderedPrefixCoordinates: readonly (readonly number[])[],
    perception: Float64Array, orderedPrefixExperienceIdentities?: readonly string[],
    _orderedPrefixTransitionTopologyIds?: readonly string[]): R2AContinuationAssessmentV1 {
    const pattern = this.#patterns.find(value => value.patternId === patternId);
    if (!pattern) throw new Error('unknown-R2A-stable-pattern');
    const base = { version: 'R2AContinuationAssessmentV1' as const, patternId,
      nextCoordinateIndex: orderedPrefixCoordinates.length < pattern.prototypeCoordinates.length
        ? orderedPrefixCoordinates.length : null };
    if (!orderedPrefixExperienceIdentities
      || orderedPrefixExperienceIdentities.length !== orderedPrefixCoordinates.length) {
      return { ...base, prefixFit: 0, matchedRelationIds: [], applicability: 0,
        predictionEligible: false, reason: 'real-prefix-exact-experience-identities-unavailable' };
    }
    if (!sameOrderedIdentities(pattern.orderedExperienceIdentities.slice(0,
      orderedPrefixExperienceIdentities.length), orderedPrefixExperienceIdentities)) {
      return { ...base, prefixFit: 0, matchedRelationIds: [], applicability: 0,
        predictionEligible: false, reason: 'real-prefix-experience-identity-mismatch' };
    }
    if (gradeRankForR2A(pattern.grade) < gradeRankForR2A('predictive-stable')) {
      return { ...base, prefixFit: 0, matchedRelationIds: [], applicability: 0,
        predictionEligible: false, reason: 'continuous-pattern-not-predictive-stable' };
    }
    if (orderedPrefixCoordinates.length < 2
      || orderedPrefixCoordinates.length >= pattern.prototypeCoordinates.length) {
      return { ...base, prefixFit: 0, matchedRelationIds: [], applicability: 0,
        predictionEligible: false, reason: 'real-prefix-length-does-not-admit-a-future-suffix' };
    }
    const prefixFit = alignedCorridorFraction(pattern.prototypeCoordinates.slice(0, orderedPrefixCoordinates.length),
      orderedPrefixCoordinates);
    if (!orderedStableRoadCompatible(pattern.prototypeCoordinates.slice(0, orderedPrefixCoordinates.length),
      orderedPrefixCoordinates)) return { ...base, prefixFit, matchedRelationIds: [], applicability: 0,
      predictionEligible: false, reason: 'real-prefix-does-not-match-ordered-pattern' };
    const physicalPattern = pattern.physicalTraceIds.some(id =>
      this.#medium.basinContainingVisit(this.#patternPageId, id) !== null);
    if (!physicalPattern) return { ...base, prefixFit, matchedRelationIds: [], applicability: 0,
      predictionEligible: false, reason: 'stable-pattern-physical-support-recovered' };
    // Current R3 factors may gate only the next unresolved branch. Relations
    // attached to an earlier or later atom cannot borrow this perception.
    const relations = this.#relations.filter(value => value.targetPatternId === patternId
      && value.branchAtomIndex === orderedPrefixCoordinates.length);
    if (relations.length === 0) return { ...base, prefixFit, matchedRelationIds: [], applicability: 1,
      predictionEligible: true, reason: null };
    const comparisons = relations.map(relation => this.compareCurrentFactors(relation.relationId, perception))
      .filter(value => value.predictionEligible).sort((left, right) => right.applicability - left.applicability
        || left.relationId.localeCompare(right.relationId));
    if (comparisons.length === 0) return { ...base, prefixFit, matchedRelationIds: [], applicability: 0,
      predictionEligible: false, reason: 'current-factors-do-not-support-pattern-continuation' };
    return { ...base, prefixFit, matchedRelationIds: comparisons.map(value => value.relationId),
      applicability: comparisons[0]!.applicability, predictionEligible: true, reason: null };
  }

  patterns(): readonly R2StablePatternV1[] { return this.#patterns.map(clonePattern); }
  factors(): readonly R2AOpaqueFactorNodeV1[] { return this.#factors.map(cloneFactor); }
  relations(): readonly R2AStablePatternHyperedgeV1[] { return this.#relations.map(cloneRelation); }
  interventionRecords(): readonly R2AInterventionEvidenceV1[] {
    return structuredClone(this.#interventionRecords);
  }
  interventionProtocols(): readonly R2AInterventionProtocolV1[] {
    return structuredClone(this.#interventionProtocols);
  }
  mediumSnapshot(): MediumSnapshot { return this.#medium.snapshot(); }

  snapshot(): R2AStablePatternGraphStateV1 {
    return { version: 'R2AStablePatternGraphV11',
      topology: stablePatternTopology(this.#sourceAdapterIdentitySha256), r2aMedium: this.#medium.snapshot(),
      patternPageId: this.#patternPageId, factorPageId: this.#factorPageId, encoder: this.#encoder.exportState(),
      patterns: this.patterns(), factors: this.factors(), relations: this.relations(), evidence: structuredClone(this.#evidence),
      interventionRecords: structuredClone(this.#interventionRecords),
      interventionProtocols: structuredClone(this.#interventionProtocols),
      processedEventIds: [...this.#processed].sort(), logicalTime: this.#logicalTime };
  }
}

function gradeRankForR2A(value: R2AEvidenceGradeV1): number {
  return ['single-observation', 'repeated-correlation', 'predictive-stable',
    'causal-hypothesis', 'intervention-supported'].indexOf(value);
}
