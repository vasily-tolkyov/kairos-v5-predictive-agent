import { assert, sha } from '../../util.js';
import { SplitMix64 } from '../random.js';
import type { DistributedAttractorReadoutV1, DistributedEpisodeV1,
  DistributedFieldRunV1, DistributedMediumSnapshotV1, DistributedProbePulseInputV1 }
  from '../physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1, normalizeDistributedProbePulseV1 }
  from '../physics/distributed-physical-medium.js';
import { runDistributedMediumProbeBatchSyncV1 }
  from '../physics/distributed-medium-probe-parallel.js';
import { scanAnonymousPhysicalStructureV1 } from '../physics/distributed-physical-structure-scanner.js';
import { DistributedPredictionCloneV2, physicalActivationResidenceMatchV1,
  physicalResidenceMatchV1 }
  from '../prediction/distributed-prediction-clone.js';
import type { DistributedPredictionCloneResultV2 } from '../prediction/distributed-prediction-clone.js';
import type { DistributedPublicSignalOccurrenceV1, DistributedR2ContinuousEventV1 }
  from './distributed-r2-contracts.js';
import { distributedPublicSignalChannelIdV1 } from './distributed-r2.js';
import type { DistributedSiteDriveV1 } from './distributed-r1-contracts.js';
import type { DistributedR2AConditionBindingV2, DistributedR2AEventPhysicalInputV2,
  DistributedR2AAnonymousPhysicalBranchV2,
  DistributedR2AInterventionAssessmentV2, DistributedR2AInterventionPairV2,
  DistributedR2AInterventionAggregateV2,
  DistributedR2APhysicalBranchProbeInputV2, DistributedR2APhysicalBranchProbeResultV2,
  DistributedR2APhysicalApplicabilityV2, DistributedR2APhysicalFactorV2,
  DistributedR2APhysicalObservationReceiptV2, DistributedR2APhysicalPatternV2,
  DistributedR2APhysicalRelationV2, DistributedR2APhysicalStateV3,
  DistributedR2ATransientFactorProjectionV2,
  DistributedR2AConsolidationBatchStatusV1,
  DistributedR2AConsolidationBatchReceiptV1,
  DistributedR2AConsolidationPerformanceAuditV1 }
  from './distributed-r2a-physical-contracts.js';
import { SparseInterlayerProjectionV1 } from './sparse-interlayer-projection.js';

const DEFAULT_SEED = 0x5232415048595332n;
const AFFERENT_SALT = 0x9e3779b97f4a7c15n;
const CONDITION_SALT = 0xd1b54a32d192ed03n;
const ACTION_SALT = 0x94d049bb133111ebn;
const PROJECTION_SEED = 0x5232534954453241n;
const CANDIDATE_COUNT = 32;
const WINNER_COUNT = 8;
const PROBE_STEPS = 180;
// A probe readout contains the complete measured terminal activation profile.
// Keeping every seed for every intervention query in one worker message can
// replicate a large distributed substrate and exhaust the host before the
// physical result is consumed.  Chunking is an execution-boundary choice only:
// each query still runs the same seeds, steps and readout, in the same order.
const MAX_PROBE_READOUTS_PER_BATCH_V1 = 96;
const DISCOVERY_PROBES = 8;
const TERMINAL_DWELL_MIN_STEPS = Math.floor(PROBE_STEPS * .25);
const PHYSICAL_BRANCH_CACHE_LIMIT = 16;
// A production R2A query owns one immutable resting substrate.  Duplicating
// that large graph into multiple workers raised peak RSS without changing a
// trajectory; parallel seed execution remains an explicit diagnostic option
// in the lower-level probe API.
const R2A_QUERY_PARALLELISM_V1 = 1 as const;
/**
 * V5 commits weighted terminal pulse/readout semantics together with the
 * higher-order coactivation assembly identity carried by physical readouts.
 * A checkpoint produced with the former V4 index must therefore be
 * rediscovered rather than accepted as an exact derived-index cache.
 */
/**
 * The branch index is derived from a reachable prefix/continuation probe.  The
 * identity is deliberately advanced when that derivation changes: a cached
 * index made by the old terminal-pulse-only reader must be re-read from the
 * physical field rather than silently reused.
 */
/** Legacy identity retained only so old checkpoints can be recognized and
 * rejected by the current cache boundary. */
export const DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V6 =
  'distributed-r2a-reachable-prefix-continuation-index-v6' as const;

/** Current identity includes the separation between observed-terminal
 * calibration and terminal-free continuation queries. */
export const DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7 =
  'distributed-r2a-observed-terminal-calibration-v7' as const;

/** Compatibility export for callers that only record an algorithm identity.
 * New snapshots use V7; the alias deliberately does not accept a literal V6
 * checkpoint as an exact derived-index cache. */
export const DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5 =
  DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7;

/**
 * Derive an anonymous branch identity from the measured dynamic core and, when
 * present, the exact repeated terminal population that physically nominated
 * it.  Coverage/resonance are intentionally not hashed: they are bounded
 * measurement-quality values for one assembly and may vary with a legitimate
 * perturbation fraction, whereas the opaque assembly id is the identity that
 * prevents independent basins from being silently merged.
 */
function anonymousPhysicalBranchIdentityV3(
  attractor: Pick<DistributedAttractorReadoutV1, 'coreSiteIds' | 'coactivationAssemblyId'>,
): string {
  return sha({ version: 'DistributedR2AAnonymousPhysicalBranchIdentityV3',
    coreSiteIds: [...attractor.coreSiteIds],
    coactivationAssemblyId: attractor.coactivationAssemblyId ?? null });
}
const MATCHED_CONTRAST_MAX_TERMINAL_OVERLAP = .75;
interface PhysicalBranchReadoutCacheValueV1 {
  readonly branches: readonly DistributedR2AAnonymousPhysicalBranchV2[];
  readonly candidateAssignments: readonly (readonly [string, string])[];
}

interface ContinuationCandidateV1 {
  /** Canonical physical input key, never a result/semantic label. */
  readonly key: string;
  /** The currently observed boundary held during a read-only probe. */
  readonly conditionDrives: readonly DistributedSiteDriveV1[];
  /** A real ordered prefix followed by the candidate continuation input. */
  readonly seedPulses: readonly (readonly DistributedSiteDriveV1[])[];
  /** Sites used only for the aggregate readout's nominal terminal population. */
  readonly terminalSites: readonly number[];
  /** Exact amplitudes observed in the terminal pulse.  These are used only
   * while calibrating an anonymous readout index from completed real events;
   * they are never included in a prediction seed. */
  readonly terminalDrives?: readonly DistributedSiteDriveV1[];
  readonly sourceEventIds: readonly string[];
}
const physicalBranchReadoutCache = new Map<string, PhysicalBranchReadoutCacheValueV1>();

/**
 * Canonical key for the transient applicability cache.  The complete caller
 * input is retained in the key (not only a digest), so a cache hit cannot
 * silently reuse a result for a different condition population.
 */
export function distributedR2APhysicalApplicabilityCacheKeyV1(
  revision: number, relationId: string, currentSignalIds: readonly string[],
): string {
  return JSON.stringify({
    version: 'DistributedR2APhysicalApplicabilityCacheKeyV1',
    revision,
    relationId,
    currentSignalIds: [...currentSignalIds],
    canonicalCurrentSignalIds: uniqueStrings(currentSignalIds),
  });
}

type EvidenceGrade = DistributedR2APhysicalPatternV2['grade'];
type AnonymousPhysicalScanV1 = ReturnType<typeof scanAnonymousPhysicalStructureV1>;

/** Intervention records change only the evidence grade/statistics of an
 * already field-derived relation.  Keeping this reduction pure makes the
 * incremental path byte-for-byte comparable with a full structural rebuild. */
export function summarizeDistributedR2AInterventionsV2(
  assessments: readonly DistributedR2AInterventionAssessmentV2[],
  baseGrade: EvidenceGrade,
  fallbackFullFactorSelectionRate: number,
  fallbackFactorAblationLoss: number,
): DistributedR2AInterventionAggregateV2 {
  // Snapshot/restore canonicalises intervention records by pairId. Reduce in
  // that same order during live learning so an equivalent restore cannot
  // differ only because floating-point addition used another insertion order.
  const canonicalAssessments = [...assessments].sort((left, right) =>
    left.pairId.localeCompare(right.pairId, 'en'));
  const matched = canonicalAssessments.filter(value => value.otherObservedChannelsMatched
    && value.manipulatedFactorActuallyChanged).length;
  const correct = canonicalAssessments.filter(value => value.otherObservedChannelsMatched
    && value.manipulatedFactorActuallyChanged && value.interventionReachedRelationBranch).length;
  const mean = (selector: (value: DistributedR2AInterventionAssessmentV2) => number,
    fallback: number): number => canonicalAssessments.length
    ? canonicalAssessments.reduce((sum, value) => sum + selector(value), 0)
      / canonicalAssessments.length : fallback;
  const full = mean(value => value.fullFactorSelectionRate, fallbackFullFactorSelectionRate);
  const loss = mean(value => value.factorAblationLoss, fallbackFactorAblationLoss);
  const grade: EvidenceGrade = matched >= 4 && correct / Math.max(1, matched) >= .75
    && full >= .75 && loss >= .25
    ? 'intervention-supported' : matched > 0 ? 'causal-hypothesis' : baseGrade;
  return { matchedInterventionCount: matched, physicallyCorrectInterventionCount: correct,
    meanFullFactorSelectionRate: full, meanFactorAblationLoss: loss, grade };
}

function parseSeed(value: string): bigint {
  assert(/^0x[0-9a-f]+$/i.test(value), 'distributed-R2A-invalid-seed');
  return BigInt(value);
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

/**
 * Canonicalise one physical population without erasing its amplitude.  Site
 * ids remain the deterministic audit order, while converging weighted wires
 * use the strongest observed wire (the same rule as the medium probe
 * normaliser) rather than manufacturing extra excitation by summing them.
 */
export function normalizeDistributedWeightedPulseV1(
  drives: readonly DistributedSiteDriveV1[], label = 'weighted pulse',
): DistributedSiteDriveV1[] {
  const bySite = new Map<number, number>();
  for (const drive of drives) {
    assert(Number.isSafeInteger(drive.siteId) && drive.siteId >= 0
      && Number.isFinite(drive.intensity) && drive.intensity > 0 && drive.intensity <= 1,
    `${label}-contains-invalid-drive`);
    bySite.set(drive.siteId, Math.max(bySite.get(drive.siteId) ?? 0, drive.intensity));
  }
  return [...bySite].sort(([left], [right]) => left - right)
    .map(([siteId, intensity]) => ({ siteId, intensity }));
}

function unitWeightedPulseV1(siteIds: readonly number[], label = 'pulse'): DistributedSiteDriveV1[] {
  const normalized = unique(siteIds);
  assert(normalized.length === siteIds.length, `${label}-contains-duplicate-site`);
  return normalized.map(siteId => ({ siteId, intensity: 1 }));
}

function weightedPulseSiteIdsV1(drives: readonly DistributedSiteDriveV1[]): number[] {
  return normalizeDistributedWeightedPulseV1(drives).map(value => value.siteId);
}

/** Compare two physical pulse populations without treating their site ids as
 * semantic labels.  Legacy snapshots contain the complete ordered episode but
 * not the atom ranges; this helper lets the reader recover the last observed
 * action boundary from the exact afferent population that was deposited. */
function sameWeightedPopulationV1(left: readonly DistributedSiteDriveV1[],
  right: readonly DistributedSiteDriveV1[]): boolean {
  return JSON.stringify(normalizeDistributedWeightedPulseV1(left))
    === JSON.stringify(normalizeDistributedWeightedPulseV1(right));
}

/**
 * A branch discovery key names the physical input that can actually be
 * reached from the current boundary.  It intentionally contains no terminal
 * population: a terminal pulse by itself is an answer-shaped seed and cannot
 * establish that the learned prefix/action route reaches that population.
 */
function continuationCandidateKeyV1(conditionDrives: readonly DistributedSiteDriveV1[],
  seedPulses: readonly (readonly DistributedSiteDriveV1[])[]): string {
  return JSON.stringify({ version: 'DistributedReachableContinuationCandidateV1',
    conditionDrives: normalizeDistributedWeightedPulseV1(conditionDrives,
      'continuation-condition-key'),
    seedPulses: seedPulses.map((pulse, index) =>
      normalizeDistributedWeightedPulseV1(pulse, `continuation-seed-key-${index}`)),
  });
}

function continuationCandidateForInputV1(input: DistributedR2AEventPhysicalInputV2):
  ContinuationCandidateV1 {
  const conditionDrives = input.conditionDrives === undefined
    ? unitWeightedPulseV1(input.conditionSiteIds, `continuation-condition-${input.eventId}`)
    : weightedPulseForIdsV1(input.conditionDrives, input.conditionSiteIds,
      `continuation-condition-${input.eventId}`);
  const actions = input.actionPulseDrives
    ?? weightedPulsesForIdsV1(undefined, input.actionPulseSiteIds,
      `continuation-action-${input.eventId}`);
  const explicitRoute = input.reachableContinuationPulseDrives
    ?? (input.reachableContinuationPulseSiteIds === undefined ? undefined
      : weightedPulsesForIdsV1(undefined, input.reachableContinuationPulseSiteIds,
        `continuation-route-${input.eventId}`));
  const prefix = input.nextActionPrefixPulseDrives
    ?? weightedPulsesForIdsV1(undefined, input.nextActionPrefixPulseSiteIds,
      `continuation-prefix-${input.eventId}`);
  const action = actions.at(-1) ?? [];
  // New events carry the exact combined route, beginning with the condition
  // pulse.  Conditioned probes inject that boundary separately, so remove
  // precisely the first route pulse and retain every prior action/projected
  // pulse before the final action.  Legacy snapshots fall back to the
  // projected-prefix plus final-action representation.
  // A pre-V6 event input still carries the complete ordered episode.  Recover
  // the exact route through the final action when possible instead of falling
  // back to `nextActionPrefix`, which contains only projected populations and
  // silently drops the preceding real action wires.  Search from the end so
  // post-action result pulses are never included; a missing/ambiguous action
  // boundary remains an explicit legacy fallback rather than an invented one.
  const episode = input.episodePulseDrives
    ?? weightedPulsesForIdsV1(undefined, input.episodePulseSiteIds,
      `continuation-episode-${input.eventId}`);
  let finalActionEpisodeIndex = -1;
  for (let index = episode.length - 1; index > 0; index -= 1) {
    if (sameWeightedPopulationV1(episode[index]!, action)) {
      finalActionEpisodeIndex = index; break;
    }
  }
  const recoveredLegacyRoute = finalActionEpisodeIndex > 0
    ? episode.slice(1, finalActionEpisodeIndex + 1)
    : undefined;
  const route = explicitRoute === undefined ? recoveredLegacyRoute
    : explicitRoute.map(pulse => normalizeDistributedWeightedPulseV1(pulse));
  const seedPulses = route === undefined
    ? [...prefix.map(pulse => normalizeDistributedWeightedPulseV1(pulse)),
      ...(action.length === 0 ? [] : [normalizeDistributedWeightedPulseV1(action)])]
    : route.slice(1);
  assert(seedPulses.length > 0 && seedPulses.every(pulse => pulse.length > 0),
    `continuation-input-${input.eventId}-has-no-reachable-action-route`);
  const terminal = input.terminalPulseDrives
    ?? weightedPulseForIdsV1(undefined, input.terminalPulseSiteIds,
      `continuation-terminal-readout-${input.eventId}`);
  assert(terminal.length > 0,
    `continuation-input-${input.eventId}-has-no-terminal-readout`);
  return { key: continuationCandidateKeyV1(conditionDrives, seedPulses),
    conditionDrives: normalizeDistributedWeightedPulseV1(conditionDrives), seedPulses,
    // The historical result population is a readout mask only.  It is never
    // included in seedPulses, so a query must physically propagate into the
    // measured result region rather than receiving an answer-shaped pulse.
    terminalSites: unique(weightedPulseSiteIdsV1(terminal)),
    terminalDrives: normalizeDistributedWeightedPulseV1(terminal),
    sourceEventIds: [input.eventId] };
}

/**
 * Recover only a reachable pre-terminal input from an immutable physical
 * footprint when the derived event table has been erased.  The final observed
 * pulse is deliberately excluded; it is evidence of what happened, not a
 * query seed that could make the same result inevitable.
 */
function continuationCandidateForFootprintV1(footprint: DistributedMediumSnapshotV1['footprints'][number]):
  ContinuationCandidateV1 | null {
  const pulses = (footprint.pulseSiteIds ?? []).map((siteIds, index) =>
    unitWeightedPulseV1(unique(siteIds), `continuation-footprint-${index}`));
  if (pulses.length < 2) return null;
  const conditionDrives = pulses[0]!;
  const preTerminal = pulses.length > 2 ? pulses.slice(1, -1) : pulses.slice(1);
  if (preTerminal.length === 0 || preTerminal.some(pulse => pulse.length === 0)) return null;
  const terminal = pulses.at(-1)!;
  return { key: continuationCandidateKeyV1(conditionDrives, preTerminal),
    conditionDrives, seedPulses: preTerminal,
    terminalSites: terminal.map(value => value.siteId),
    terminalDrives: terminal,
    sourceEventIds: [] };
}

/**
 * Resolve a new weighted field when reading a legacy event.  Legacy states
 * contain only site ids, which explicitly mean unit intensity.  If both
 * representations are present their membership must agree; silently
 * dropping or inventing a site would make a restored physical event differ
 * from the event that was deposited.
 */
function weightedPulseForIdsV1(
  weighted: readonly DistributedSiteDriveV1[] | undefined,
  siteIds: readonly number[], label: string,
): DistributedSiteDriveV1[] {
  const drives = weighted === undefined
    ? unitWeightedPulseV1(siteIds, label)
    : normalizeDistributedWeightedPulseV1(weighted, label);
  const expected = unique(siteIds), actual = weightedPulseSiteIdsV1(drives);
  assert(actual.length === expected.length && actual.every((siteId, index) => siteId === expected[index]),
    `${label}-weighted-site-membership-mismatch`);
  return drives;
}

function weightedPulsesForIdsV1(
  weighted: readonly (readonly DistributedSiteDriveV1[])[] | undefined,
  siteIds: readonly (readonly number[])[], label: string,
): DistributedSiteDriveV1[][] {
  assert(weighted === undefined || weighted.length === siteIds.length,
    `${label}-weighted-pulse-count-mismatch`);
  return siteIds.map((ids, index) => weightedPulseForIdsV1(weighted?.[index], ids,
    `${label}-${index}`));
}

function assertWeightedEventInputV1(input: DistributedR2AEventPhysicalInputV2): void {
  if (input.conditionDrives !== undefined)
    weightedPulseForIdsV1(input.conditionDrives, input.conditionSiteIds,
      `R2A-event-condition-${input.eventId}`);
  weightedPulsesForIdsV1(input.actionPulseDrives, input.actionPulseSiteIds,
    `R2A-event-action-${input.eventId}`);
  weightedPulsesForIdsV1(input.projectedPulseDrives, input.projectedPulseSiteIds,
    `R2A-event-projected-${input.eventId}`);
  weightedPulsesForIdsV1(input.nextActionPrefixPulseDrives,
    input.nextActionPrefixPulseSiteIds, `R2A-event-prefix-${input.eventId}`);
  if (input.reachableContinuationPulseSiteIds !== undefined) {
    assert(input.reachableContinuationPulseDrives === undefined
      || input.reachableContinuationPulseDrives.length === input.reachableContinuationPulseSiteIds.length,
    `R2A-event-continuation-weighted-pulse-count-mismatch-${input.eventId}`);
    weightedPulsesForIdsV1(input.reachableContinuationPulseDrives,
      input.reachableContinuationPulseSiteIds, `R2A-event-continuation-${input.eventId}`);
  }
  weightedPulsesForIdsV1(input.episodePulseDrives, input.episodePulseSiteIds,
    `R2A-event-episode-${input.eventId}`);
  if (input.terminalPulseDrives !== undefined)
    weightedPulseForIdsV1(input.terminalPulseDrives, input.terminalPulseSiteIds,
      `R2A-event-terminal-${input.eventId}`);
}

function cloneWeightedPulsesV1(
  pulses: readonly (readonly DistributedSiteDriveV1[])[],
): DistributedSiteDriveV1[][] {
  return pulses.map(pulse => normalizeDistributedWeightedPulseV1(pulse)
    .map(value => ({ ...value })));
}

/**
 * Consensus for repeated physical roads.  Membership still uses the existing
 * 80% pulse/site threshold; amplitudes are averaged only over the members
 * that actually supplied a surviving site.  This keeps a repeated projected
 * fibre's measured intensity instead of rebuilding a unit pulse from ids.
 */
function consensusWeightedPulseSequence(
  sequences: readonly (readonly (readonly DistributedSiteDriveV1[])[])[],
  minimumFraction = .8,
): readonly (readonly DistributedSiteDriveV1[])[] {
  if (sequences.length === 0) return [];
  const required = Math.ceil(sequences.length * minimumFraction);
  const maximumLength = Math.max(...sequences.map(value => value.length));
  const result: DistributedSiteDriveV1[][] = [];
  for (let pulseIndex = 0; pulseIndex < maximumLength; pulseIndex++) {
    const present = sequences
      .map(sequence => sequence[pulseIndex])
      .filter((pulse): pulse is readonly DistributedSiteDriveV1[] => (pulse?.length ?? 0) > 0);
    if (present.length < required) break;
    const values = new Map<number, number[]>();
    for (const pulse of present) {
      for (const drive of normalizeDistributedWeightedPulseV1(pulse)) {
        const samples = values.get(drive.siteId) ?? [];
        samples.push(drive.intensity);
        values.set(drive.siteId, samples);
      }
    }
    const pulse = [...values]
      .filter(([, samples]) => samples.length >= required)
      .map(([siteId, samples]) => ({ siteId,
        intensity: samples.reduce((sum, value) => sum + value, 0) / samples.length }))
      .sort((left, right) => left.siteId - right.siteId);
    if (pulse.length === 0) break;
    result.push(pulse);
  }
  return result;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function overlap(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left), b = new Set(right);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / Math.max(a.size, b.size);
}

function coveredFraction(population: readonly number[], observed: readonly number[]): number {
  if (population.length === 0) return 0;
  const present = new Set(observed);
  return new Set(population).size === 0 ? 0
    : [...new Set(population)].filter(siteId => present.has(siteId)).length / new Set(population).size;
}

function samePhysicalPopulation(left: readonly number[], right: readonly number[]): boolean {
  const a = unique(left), b = unique(right);
  return a.length === b.length && a.every((siteId, index) => siteId === b[index]);
}

function terminalActivationProfileOverlap(
  left: DistributedAttractorReadoutV1,
  right: DistributedAttractorReadoutV1,
): number {
  const leftActivations = left.run.finalActivations.map(value => ({
    siteId: value.siteId, meanActivation: value.activation }));
  const rightActivations = right.run.finalActivations.map(value => ({
    siteId: value.siteId, meanActivation: value.activation }));
  if (leftActivations.length > 0 && rightActivations.length > 0) {
    const domain = unique([...left.coreSiteIds, ...right.coreSiteIds,
      ...leftActivations.map(value => value.siteId),
      ...rightActivations.map(value => value.siteId)]);
    return physicalActivationResidenceMatchV1(leftActivations, rightActivations,
      domain, domain).profileOverlap;
  }
  // Small contract fixtures may expose only anonymous cores.  Their set
  // overlap is a conservative fallback; production readouts always carry the
  // final activation profile above.
  return overlap(left.coreSiteIds, right.coreSiteIds);
}

/**
 * A terminal readout can carry a broad low-amplitude residue profile even when
 * its measured dynamic core is an exact, physically resolved population.  Use
 * the profile when it is discriminative and the symmetric core residence as a
 * conservative fallback; both are anonymous physical measurements and neither
 * depends on an event/result annotation.
 */
function physicalTerminalMembershipScoreV1(
  readout: DistributedAttractorReadoutV1,
  candidate: DistributedAttractorReadoutV1,
): number {
  return Math.max(terminalActivationProfileOverlap(readout, candidate),
    physicalResidenceMatchV1(readout.coreSiteIds, candidate.coreSiteIds).score);
}

/**
 * A result classification is deliberately narrower than a branch label.  It
 * is made only after a completed real input has been read through the same
 * physical terminal probe used to calibrate the anonymous branch index.
 * `unresolved` is not counted in either population: an ambiguous physical
 * readout cannot be turned into a contradiction by metadata.
 */
type PhysicalOutcomeClassV1 = 'support' | 'contradiction' | 'unresolved';

interface PhysicalOutcomeCountsV1 {
  readonly support: number;
  readonly contradiction: number;
}

function validPhysicalAttractorV1(value: DistributedAttractorReadoutV1): boolean {
  return value.evidenceLevel !== 'none' && !value.ambiguous
    && value.coreSiteIds.length > 0 && value.dwellSteps > 0;
}

function physicalOutcomeClassV1(readout: DistributedAttractorReadoutV1,
  expected: DistributedAttractorReadoutV1,
  alternatives: readonly DistributedAttractorReadoutV1[]): PhysicalOutcomeClassV1 {
  if (!validPhysicalAttractorV1(readout) || !validPhysicalAttractorV1(expected))
    return 'unresolved';
  const expectedScore = physicalTerminalMembershipScoreV1(readout, expected);
  if (expectedScore >= MATCHED_CONTRAST_MAX_TERMINAL_OVERLAP) return 'support';
  const alternativeScore = Math.max(0, ...alternatives
    .filter(validPhysicalAttractorV1)
    .map(value => physicalTerminalMembershipScoreV1(readout, value)));
  // A different physical basin must win clearly.  A weak/ambiguous alternative
  // is not enough to call the event a contradiction.
  return alternativeScore >= MATCHED_CONTRAST_MAX_TERMINAL_OVERLAP
    && alternativeScore - expectedScore >= .1 ? 'contradiction' : 'unresolved';
}

/**
 * A differential is meaningful only between two already stable physical roads
 * that reach different terminal assemblies after the same physical prefix and
 * the same exact next-action population.  Event ids, action labels and public
 * values deliberately do not participate in this comparison.
 */
export function distributedR2APhysicalMatchedContrastV1(
  target: Pick<DistributedR2APhysicalPatternV2, 'attractor' | 'corridor'>,
  contrast: Pick<DistributedR2APhysicalPatternV2, 'attractor' | 'corridor'>,
): boolean {
  const targetPrefix = target.corridor.orderedPrefixPulseSiteIds;
  const contrastPrefix = contrast.corridor.orderedPrefixPulseSiteIds;
  const targetAction = target.corridor.actionPulseSiteIds.at(-1) ?? [];
  const contrastAction = contrast.corridor.actionPulseSiteIds.at(-1) ?? [];
  if (targetPrefix.length === 0 || targetPrefix.length !== contrastPrefix.length
    || targetAction.length === 0 || !samePhysicalPopulation(targetAction, contrastAction)) return false;
  if (!targetPrefix.every((pulse, index) => overlap(pulse, contrastPrefix[index] ?? []) >= .8))
    return false;
  // A small stochastic drift in one site is not a different physical result.
  // Compare the terminal activation distribution when available; exact core
  // sets are a lossy audit projection and can differ while the same basin is
  // occupied.  The same-branch readout elsewhere in this substrate accepts
  // residence scores at .75, so a contrast must fall strictly below that
  // physical membership boundary while still permitting shared subassemblies.
  return terminalActivationProfileOverlap(target.attractor, contrast.attractor)
    < MATCHED_CONTRAST_MAX_TERMINAL_OVERLAP;
}

/** Pure physical prevalence check used after a matched contrast cohort exists. */
export function distributedR2AConditionDifferentialV1(
  basinSiteIds: readonly number[],
  memberConditionPopulations: readonly (readonly number[])[],
  contrastConditionPopulations: readonly (readonly number[])[],
): { readonly memberPresence: number; readonly contrastPresence: number; readonly qualifies: boolean } {
  if (basinSiteIds.length === 0 || memberConditionPopulations.length === 0
    || contrastConditionPopulations.length === 0)
    return { memberPresence: 0, contrastPresence: 0, qualifies: false };
  const memberPresence = memberConditionPopulations.filter(population =>
    coveredFraction(basinSiteIds, population) >= .5).length / memberConditionPopulations.length;
  const contrastPresence = contrastConditionPopulations.filter(population =>
    coveredFraction(basinSiteIds, population) >= .5).length / contrastConditionPopulations.length;
  return { memberPresence, contrastPresence,
    qualifies: memberPresence >= .8 && contrastPresence <= .2 };
}

/** Fraction of one local physical assembly that is present in a larger,
 * simultaneously observed distributed population.  The denominator is the
 * local assembly: adding another co-active assembly must not dilute the fact
 * that this one was fully activated. */
export function distributedObservedPopulationCoversLocalAssemblyV1(
  localAssemblySiteIds: readonly number[], observedPopulationSiteIds: readonly number[],
): number {
  return coveredFraction(localAssemblySiteIds, observedPopulationSiteIds);
}

/** Physical consensus across repeated real member footprints.  A site remains
 * in a pulse only when it was present in at least 80% of the member events;
 * no event label, result value, or coordinate transform participates. */
function consensusPulseSequence(sequences: readonly (readonly (readonly number[])[])[],
  minimumFraction = .8): readonly (readonly number[])[] {
  if (sequences.length === 0) return [];
  const required = Math.ceil(sequences.length * minimumFraction);
  const maximumLength = Math.max(...sequences.map(value => value.length));
  const result: number[][] = [];
  for (let pulseIndex = 0; pulseIndex < maximumLength; pulseIndex++) {
    const present = sequences.filter(value => (value[pulseIndex]?.length ?? 0) > 0);
    if (present.length < required) break;
    const counts = new Map<number, number>();
    for (const sequence of present) {
      for (const siteId of new Set(sequence[pulseIndex]!))
        counts.set(siteId, (counts.get(siteId) ?? 0) + 1);
    }
    const pulse = [...counts].filter(([, count]) => count >= required)
      .map(([siteId]) => siteId).sort((left, right) => left - right);
    if (pulse.length === 0) break;
    result.push(pulse);
  }
  return result;
}

function evidenceRank(value: string): number {
  return ['none', 'single-observation', 'repeated-correlation', 'predictive-stable',
    'causal-hypothesis', 'intervention-supported'].indexOf(value);
}

function emptyRun(): DistributedFieldRunV1 {
  return { version: 'DistributedFieldRunV1', steps: 0, acceptedSteps: 0,
    rejectedSteps: 0, leaderSiteIds: [], finalActivations: [] };
}

function emptyAttractor(): DistributedAttractorReadoutV1 {
  return { version: 'DistributedAttractorReadoutV1', coreSiteIds: [], dwellSteps: 0,
    returnRate: 0, escapeRate: 1, evidenceLevel: 'none', ambiguous: false, run: emptyRun() };
}

function actualVisited(readout: DistributedAttractorReadoutV1, minimum: number): Set<number> {
  return new Set([...readout.run.leaderSiteIds,
    ...readout.run.finalActivations.filter(value => value.activation > minimum).map(value => value.siteId)]);
}

function reachedFraction(readout: DistributedAttractorReadoutV1,
  target: readonly number[], minimum: number): number {
  if (target.length === 0 || readout.evidenceLevel === 'none') return 0;
  const visited = actualVisited(readout, minimum);
  return target.filter(siteId => visited.has(siteId)).length / target.length;
}

function cloneBinding(value: DistributedR2AConditionBindingV2): DistributedR2AConditionBindingV2 {
  return { ...value, siteIds: [...value.siteIds] };
}

function eventChannels(signals: readonly string[]): Map<string, string> {
  return new Map(signals.map(signal => [distributedPublicSignalChannelIdV1(signal), signal]));
}

/**
 * R2A V2 is a physical branch field.  Audit records name attractors only after
 * they have been read from the medium; they never select a branch by label.
 * Every query is executed on a zero-fast-activation clone of the same lattice.
 */
export class DistributedR2APhysicalPatternLearnerV2 {
  readonly medium: DistributedPhysicalMedium3DV1;
  readonly #r2Active: (eventId: string) => boolean;
  readonly #seed: bigint;
  readonly #projection: SparseInterlayerProjectionV1;
  #afferentAllocationSequence = 0;
  readonly #conditionBindings = new Map<string, DistributedR2AConditionBindingV2>();
  readonly #actionBindings = new Map<string, DistributedR2AConditionBindingV2>();
  readonly #events = new Map<string, DistributedR2ContinuousEventV1>();
  readonly #eventInputs = new Map<string, DistributedR2AEventPhysicalInputV2>();
  readonly #patterns = new Map<string, DistributedR2APhysicalPatternV2>();
  readonly #relations = new Map<string, DistributedR2APhysicalRelationV2>();
  readonly #interventions = new Map<string, DistributedR2AInterventionAssessmentV2>();
  readonly #candidateBranchAssignments = new Map<string, string>();
  #indexesDirty = true;
  #structureScanCache: { readonly mediumSha256: string; readonly scan: AnonymousPhysicalScanV1 } | null = null;
  #physicalStructureScanCount = 0;
  #restingQueryCache: {
    readonly snapshot: DistributedMediumSnapshotV1;
    readonly medium: DistributedPhysicalMedium3DV1;
    readonly mediumSha256: string;
  } | null = null;
  #restingQuerySubstrateBuildCount = 0;
  #physicalQueryRevision = 0;
  readonly #applicabilityQueryCache = new Map<string, DistributedR2APhysicalApplicabilityV2>();
  #applicabilityQueryCacheHits = 0;
  #applicabilityQueryCacheMisses = 0;
  /**
   * Consolidation is a derived-index pass, not an event deposit.  During an
   * explicit batch boundary we collect due boundaries and run one pass when
   * the caller closes the batch.  The state is intentionally transient and is
   * never written into a checkpoint.
   */
  #consolidationBatchActive = false;
  #consolidationPending = false;
  #deferredConsolidationBoundaryCount = 0;
  #consolidationPassCount = 0;
  #restoreIndexMode: 'fresh' | 'exact-cache' | 'physical-rediscovery' = 'fresh';

  constructor(r2Active: (eventId: string) => boolean,
    medium?: DistributedPhysicalMedium3DV1, seed = DEFAULT_SEED,
    state?: DistributedR2APhysicalStateV3) {
    this.#r2Active = r2Active;
    this.#seed = seed;
    this.medium = medium ?? new DistributedPhysicalMedium3DV1({ name: 'R2A', seedHex: '523241' });
    if (state) {
      assert(state.version === 'DistributedR2APhysicalStateV3' && parseSeed(state.seedHex) === seed,
        'distributed-R2A-state-version-or-seed-mismatch');
      assert(sha(state.medium) === sha(this.medium.snapshot()), 'distributed-R2A-medium-state-mismatch');
      this.#afferentAllocationSequence = state.conditionAllocationSequence;
      for (const value of state.conditionBindings) {
        this.medium.bindSites(`r2a:condition:${value.signalId}`, value.siteIds);
        this.#conditionBindings.set(value.signalId, cloneBinding(value));
      }
      for (const value of state.actionBindings) {
        this.medium.bindSites(`r2a:action:${value.signalId}`, value.siteIds);
        this.#actionBindings.set(value.signalId, cloneBinding(value));
      }
      for (const value of state.evidenceEvents) this.#events.set(value.eventId, structuredClone(value));
      for (const value of state.eventInputs) {
        assertWeightedEventInputV1(value);
        this.#eventInputs.set(value.eventId, structuredClone(value));
      }
    }
    this.#projection = new SparseInterlayerProjectionV1(this.medium,
      { projectionId: 'R2-site-to-R2A-sparse-fibre', seed: PROJECTION_SEED }, state?.projection);
    if (state) {
      // Validate intervention references before deciding whether a derived
      // index cache can be rediscovered.  A forged assessment must never be
      // silently erased by the rediscovery fallback; restoration must fail at
      // the same immutable real-event boundary as the live path.
      for (const value of state.interventions) {
        assert(state.eventInputs.some(input => input.eventId === value.baselineR2EventId)
          && state.eventInputs.some(input => input.eventId === value.interventionR2EventId)
          && value.baselineR2EventId !== value.interventionR2EventId,
        'intervention-references-invalid-real-events');
      }
      const indexStateSha256 = this.#physicalIndexStateSha256(
        state.patterns, state.relations, state.interventions);
      const cacheIsExact = state.physicalIndexIdentity.version === 'DistributedR2APhysicalIndexIdentityV1'
        && state.physicalIndexIdentity.algorithmIdentity
          === DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7
        && state.physicalIndexIdentity.physicalIndexInputsSha256
          === this.#physicalIndexInputsSha256(state.interventions)
        && state.physicalIndexIdentity.physicalIndexStateSha256 === indexStateSha256;
      if (cacheIsExact) {
        state.patterns.forEach(value => this.#patterns.set(value.patternId, structuredClone(value)));
        state.relations.forEach(value => this.#relations.set(value.relationId, structuredClone(value)));
        state.interventions.forEach(value => this.#interventions.set(value.pairId, structuredClone(value)));
        this.#assertRestoredPhysicalIndexState();
        for (const pattern of this.#patterns.values()) for (const eventId of pattern.memberR2EventIds) {
          const input = this.#eventInputs.get(eventId)!;
          const candidate = continuationCandidateForInputV1(input).key;
          const existing = this.#candidateBranchAssignments.get(candidate);
          assert(existing === undefined || existing === pattern.patternId,
            'distributed-R2A-restored-candidate-branch-conflict');
          this.#candidateBranchAssignments.set(candidate, pattern.patternId);
        }
        this.#indexesDirty = false;
        this.#restoreIndexMode = 'exact-cache';
      } else {
        // An audit erasure or stale/tampered derived cache never keeps its old
        // qualification metadata.  Re-read only the current physical field;
        // the operation may downgrade capability but cannot invent support.
        this.#patterns.clear(); this.#relations.clear(); this.#interventions.clear();
        this.#rediscoverPhysicalIndexes();
        this.#restoreIndexMode = 'physical-rediscovery';
      }
    }
  }

  static restore(state: DistributedR2APhysicalStateV3,
    r2Active: (eventId: string) => boolean): DistributedR2APhysicalPatternLearnerV2 {
    return new DistributedR2APhysicalPatternLearnerV2(r2Active,
      DistributedPhysicalMedium3DV1.fromSnapshot(state.medium), parseSeed(state.seedHex), state);
  }

  restoreIndexModeForAudit(): 'fresh' | 'exact-cache' | 'physical-rediscovery' {
    return this.#restoreIndexMode;
  }

  #physicalIndexStateSha256(patterns: readonly DistributedR2APhysicalPatternV2[],
    relations: readonly DistributedR2APhysicalRelationV2[],
    interventions: readonly DistributedR2AInterventionAssessmentV2[]): string {
    return sha({ version: 'DistributedR2APhysicalIndexStateV1',
      patterns, relations, interventions });
  }

  #physicalIndexInputsSha256(
    interventions: readonly DistributedR2AInterventionAssessmentV2[] = [...this.#interventions.values()]): string {
    const eventInputs = [...this.#eventInputs.values()].sort((left, right) =>
      left.eventId.localeCompare(right.eventId, 'en'));
    const activeR2Support = eventInputs.map(value => ({ eventId: value.eventId,
      r2Active: this.#r2Active(value.eventId),
      r2aTraceActive: this.medium.isFootprintActive(value.traceId) }));
    const interventionPairs = interventions.map(value => ({ pairId: value.pairId,
      baselineR2EventId: value.baselineR2EventId,
      interventionR2EventId: value.interventionR2EventId }))
      .sort((left, right) => left.pairId.localeCompare(right.pairId, 'en'));
    return sha({ version: 'DistributedR2APhysicalIndexInputsV1',
       algorithmIdentity: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7,
      seedHex: `0x${this.#seed.toString(16)}`,
      restingMediumSha256: this.#restingQuerySubstrate().mediumSha256,
      projection: this.#projection.snapshot(),
      conditionBindings: [...this.#conditionBindings.values()].sort((left, right) =>
        left.signalId.localeCompare(right.signalId, 'en')).map(cloneBinding),
      actionBindings: [...this.#actionBindings.values()].sort((left, right) =>
        left.signalId.localeCompare(right.signalId, 'en')).map(cloneBinding),
      eventInputs, activeR2Support, interventionPairs });
  }

  #assertRestoredPhysicalIndexState(): void {
    const patternIds = new Set<string>(), relationIds = new Set<string>();
    for (const pattern of this.#patterns.values()) {
      assert(!patternIds.has(pattern.patternId), 'distributed-R2A-restored-pattern-id-duplicate');
      patternIds.add(pattern.patternId);
      assert(pattern.patternId === anonymousPhysicalBranchIdentityV3(pattern.attractor),
      'distributed-R2A-restored-pattern-identity-invalid');
      assert(pattern.memberR2EventIds.length > 0 && pattern.memberR2EventIds.every(eventId =>
        this.#eventInputs.has(eventId) && this.#r2Active(eventId)),
      'distributed-R2A-restored-pattern-lower-support-invalid');
      const exactMemberTraces = pattern.memberR2EventIds
        .map(eventId => this.#eventInputs.get(eventId)!.traceId).sort();
      assert(pattern.physicalTraceIds.length > 0
        && pattern.physicalTraceIds.every(traceId => this.medium.isFootprintActive(traceId))
        && JSON.stringify([...pattern.physicalTraceIds].sort()) === JSON.stringify(exactMemberTraces),
      'distributed-R2A-restored-pattern-trace-inactive');
      [...pattern.attractor.coreSiteIds, ...pattern.corridor.corridorCoreSiteIds]
        .forEach(siteId => this.medium.site(siteId));
      const { grade: _grade, ...withoutGrade } = pattern;
      assert(this.#grade(withoutGrade) === pattern.grade,
        'distributed-R2A-restored-pattern-grade-invalid');
    }
    for (const relation of this.#relations.values()) {
      assert(!relationIds.has(relation.relationId), 'distributed-R2A-restored-relation-id-duplicate');
      relationIds.add(relation.relationId);
      assert(this.#patterns.has(relation.patternId),
        'distributed-R2A-restored-relation-pattern-missing');
      assert(relation.factors.length > 0 && relation.factors.every(factor => {
        factor.coreSiteIds.forEach(siteId => this.medium.site(siteId));
        return factor.factorId === sha({ version: 'DistributedR2APhysicalFactorIdentityV2',
          coreSiteIds: factor.coreSiteIds });
      }), 'distributed-R2A-restored-factor-identity-invalid');
      assert(relation.relationId === sha({ version: 'DistributedR2APhysicalRelationIdentityV2',
        patternId: relation.patternId,
        factorCoreSiteIds: relation.factors[0]!.coreSiteIds }),
      'distributed-R2A-restored-relation-identity-invalid');
      assert(relation.physicalTraceIds.every(traceId => this.medium.isFootprintActive(traceId)),
        'distributed-R2A-restored-relation-trace-inactive');
      const assessments = [...this.#interventions.values()]
        .filter(value => value.relationId === relation.relationId);
      if (assessments.length > 0) {
        const pattern = this.#patterns.get(relation.patternId)!;
        const aggregate = summarizeDistributedR2AInterventionsV2(assessments,
          pattern.grade, relation.meanFullFactorSelectionRate, relation.meanFactorAblationLoss);
        const contradictionRate = relation.contradictionCount
          / Math.max(1, relation.supportCount + relation.contradictionCount);
        const expectedGrade: EvidenceGrade = contradictionRate > .2
          ? 'repeated-correlation' : aggregate.grade;
        assert(aggregate.matchedInterventionCount === relation.matchedInterventionCount
          && aggregate.physicallyCorrectInterventionCount
            === relation.physicallyCorrectInterventionCount
          && Object.is(aggregate.meanFullFactorSelectionRate,
            relation.meanFullFactorSelectionRate)
          && Object.is(aggregate.meanFactorAblationLoss, relation.meanFactorAblationLoss)
          && expectedGrade === relation.grade,
        'distributed-R2A-restored-intervention-aggregate-invalid');
      }
    }
    for (const value of this.#interventions.values()) assert(this.#relations.has(value.relationId)
      && this.#eventInputs.has(value.baselineR2EventId)
      && this.#eventInputs.has(value.interventionR2EventId),
    'distributed-R2A-restored-intervention-reference-invalid');
  }

  #restingMedium(): DistributedPhysicalMedium3DV1 {
    return this.#restingQuerySubstrate().medium;
  }

  #restingSnapshot(): DistributedMediumSnapshotV1 {
    const snapshot = this.medium.snapshot();
    return { ...snapshot, sites: snapshot.sites.map(site => ({ ...site, activation: 0 })) };
  }

  #restingQuerySubstrate(): {
    readonly snapshot: DistributedMediumSnapshotV1;
    readonly medium: DistributedPhysicalMedium3DV1;
    readonly mediumSha256: string;
  } {
    if (this.#restingQueryCache) return this.#restingQueryCache;
    const snapshot = this.#restingSnapshot();
    const value = { snapshot,
      medium: DistributedPhysicalMedium3DV1.fromSnapshot(snapshot),
      mediumSha256: sha(snapshot) } as const;
    this.#restingQueryCache = value;
    this.#restingQuerySubstrateBuildCount++;
    return value;
  }

  #readOnlyProbeSnapshot(medium: DistributedPhysicalMedium3DV1): DistributedMediumSnapshotV1 {
    return this.#restingQueryCache?.medium === medium
      ? this.#restingQueryCache.snapshot : medium.snapshot();
  }

  #invalidateApplicabilityQueryCache(): void {
    this.#applicabilityQueryCache.clear();
    this.#physicalQueryRevision++;
  }

  #invalidatePhysicalQueryCaches(): void {
    this.#restingQueryCache = null;
    this.#structureScanCache = null;
    this.#invalidateApplicabilityQueryCache();
  }

  #physicalStructure(): AnonymousPhysicalScanV1 {
    const substrate = this.#restingQuerySubstrate();
    const snapshot = substrate.snapshot;
    const mediumSha256 = substrate.mediumSha256;
    if (this.#structureScanCache?.mediumSha256 === mediumSha256)
      return this.#structureScanCache.scan;
    const scan = scanAnonymousPhysicalStructureV1(snapshot);
    this.#structureScanCache = { mediumSha256, scan };
    this.#physicalStructureScanCount++;
    return scan;
  }

  /** Read-only performance evidence; it exposes no labels or physical answer. */
  physicalStructurePerformanceAudit(): { readonly fullStructureScanCount: number;
    readonly cachedMediumSha256: string | null } {
    return { fullStructureScanCount: this.#physicalStructureScanCount,
      cachedMediumSha256: this.#structureScanCache?.mediumSha256 ?? null };
  }

  /** Read-only counters for transient query reuse; this state is never
   * persisted and cannot select an operation. */
  physicalQueryCachePerformanceAuditV1(): {
    readonly revision: number;
    readonly restingSubstrateBuildCount: number;
    readonly applicabilityCacheHits: number;
    readonly applicabilityCacheMisses: number;
    readonly applicabilityCacheEntryCount: number;
    readonly applicabilityCacheKeys: readonly string[];
  } {
    return { revision: this.#physicalQueryRevision,
      restingSubstrateBuildCount: this.#restingQuerySubstrateBuildCount,
      applicabilityCacheHits: this.#applicabilityQueryCacheHits,
      applicabilityCacheMisses: this.#applicabilityQueryCacheMisses,
      applicabilityCacheEntryCount: this.#applicabilityQueryCache.size,
      applicabilityCacheKeys: [...this.#applicabilityQueryCache.keys()] };
  }

  /**
   * Open an explicit learning batch.  R2A still deposits every trusted event
   * immediately; only the expensive derived condition consolidation is
   * deferred until the matching close call.  Nested batches are intentionally
   * rejected so a missing close cannot be hidden by a depth counter.
   */
  beginDeferredConsolidationBatchV1(): void {
    assert(!this.#consolidationBatchActive,
      'R2A-consolidation-batch-already-active');
    this.#consolidationBatchActive = true;
    this.#consolidationPending = false;
    this.#deferredConsolidationBoundaryCount = 0;
  }

  /**
   * Close the explicit learning batch and, when at least one cadence boundary
   * was reached, perform exactly one consolidation pass over all deposited
   * events.  Flags are cleared before entering the pass; an implementation
   * error therefore still crashes directly without leaving a resumable,
   * half-open batch state.
   */
  endDeferredConsolidationBatchV1(): DistributedR2AConsolidationBatchReceiptV1 {
    assert(this.#consolidationBatchActive,
      'R2A-consolidation-batch-not-active');
    const deferredBoundaryCount = this.#deferredConsolidationBoundaryCount;
    const consolidated = this.#consolidationPending;
    this.#consolidationBatchActive = false;
    this.#consolidationPending = false;
    this.#deferredConsolidationBoundaryCount = 0;
    if (consolidated) this.#consolidateStableConditionDifferences();
    return { version: 'DistributedR2AConsolidationBatchReceiptV1',
      deferredBoundaryCount, consolidated };
  }

  /** Read-only audit of the transient batch boundary. */
  consolidationBatchStatusV1(): DistributedR2AConsolidationBatchStatusV1 {
    return { version: 'DistributedR2AConsolidationBatchStatusV1',
      active: this.#consolidationBatchActive,
      pending: this.#consolidationPending,
      deferredBoundaryCount: this.#deferredConsolidationBoundaryCount };
  }

  /** Read-only count used to verify that a batch collapses repeated passes. */
  consolidationPerformanceAuditV1(): DistributedR2AConsolidationPerformanceAuditV1 {
    return { version: 'DistributedR2AConsolidationPerformanceAuditV1',
      consolidationPassCount: this.#consolidationPassCount };
  }

  /** Raw read-only substrate copy for evidence tooling.  Unlike patterns(), it
   * never discovers, qualifies, consolidates, or writes a cognitive index. */
  rawPhysicalMediumSnapshotForAudit(): DistributedMediumSnapshotV1 {
    return this.medium.snapshot();
  }

  #ensureAfferent(kind: 'condition' | 'action', signalId: string): DistributedR2AConditionBindingV2 {
    const map = kind === 'condition' ? this.#conditionBindings : this.#actionBindings;
    const existing = map.get(signalId);
    if (existing) {
      const next = { ...existing, observationCount: existing.observationCount + 1 };
      map.set(signalId, next); return next;
    }
    const salt = kind === 'condition' ? CONDITION_SALT : ACTION_SALT;
    const random = new SplitMix64(this.#seed ^ salt
      ^ (BigInt(this.#afferentAllocationSequence + 1) * AFFERENT_SALT));
    const draw = () => random.uniform();
    const candidates = this.medium.allocateSites(CANDIDATE_COUNT, draw);
    const siteIds = this.medium.competeForSites(candidates, WINNER_COUNT, draw);
    this.medium.bindSites(`r2a:${kind}:${signalId}`, siteIds);
    this.#invalidatePhysicalQueryCaches();
    const value = { signalId, siteIds: [...siteIds], observationCount: 1 };
    map.set(signalId, value); this.#afferentAllocationSequence++;
    return value;
  }

  /** Allocate one real sensor pulse as a physical input round.  Opaque hashes
   * are consulted only after the pulse/channel/receptor order has been
   * validated; they never participate in sorting or random-sequence choice. */
  #ensureConditionRound(occurrences: readonly DistributedPublicSignalOccurrenceV1[],
    expectedSignalIds: readonly string[]): readonly DistributedR2AConditionBindingV2[] {
    const expected = new Set(expectedSignalIds);
    const seenSignals = new Set<string>(), seenOrdinals = new Set<string>();
    const ordered = [...occurrences].sort((left, right) => left.pulseOrdinal - right.pulseOrdinal
      || left.channelOrdinal - right.channelOrdinal || left.receptorOrdinal - right.receptorOrdinal);
    for (const occurrence of ordered) {
      assert(expected.has(occurrence.signalId), 'R2A-condition-occurrence-not-in-public-input');
      assert(Number.isSafeInteger(occurrence.pulseOrdinal) && occurrence.pulseOrdinal >= 0
        && Number.isSafeInteger(occurrence.channelOrdinal) && occurrence.channelOrdinal >= 0
        && Number.isSafeInteger(occurrence.receptorOrdinal) && occurrence.receptorOrdinal >= 0,
      'R2A-invalid-public-sensor-ordinal');
      const ordinal = `${occurrence.pulseOrdinal}/${occurrence.channelOrdinal}/${occurrence.receptorOrdinal}`;
      assert(!seenOrdinals.has(ordinal), 'R2A-duplicate-public-sensor-ordinal');
      seenOrdinals.add(ordinal);
      assert(!seenSignals.has(occurrence.signalId), 'R2A-duplicate-public-signal-occurrence');
      seenSignals.add(occurrence.signalId);
    }
    assert(seenSignals.size === expected.size && [...expected].every(signal => seenSignals.has(signal)),
      'R2A-public-sensor-occurrences-incomplete');
    return ordered.map(occurrence => this.#ensureAfferent('condition', occurrence.signalId));
  }

  #r2Neighborhoods(event: DistributedR2ContinuousEventV1): readonly {
    readonly sourceSiteId: number; readonly neighborSiteIds: readonly number[];
  }[] {
    const graph = new Map<number, Set<number>>();
    for (const reference of event.physicalFootprint?.bondReferences ?? []) {
      // Only a symmetric local source-layer bond is evidence that two source
      // populations should compete for nearby target-layer sites. A plastic
      // directed reference says "earlier then later"; treating it as a
      // bidirectional spatial neighbour folds mutually exclusive successors
      // together and destroys their physical metastability. Temporal
      // adjacency is learned below as a directed long-range channel instead.
      if (reference.kind !== 'local') continue;
      const from = graph.get(reference.fromSiteId) ?? new Set<number>();
      const to = graph.get(reference.toSiteId) ?? new Set<number>();
      from.add(reference.toSiteId); to.add(reference.fromSiteId);
      graph.set(reference.fromSiteId, from); graph.set(reference.toSiteId, to);
    }
    return [...graph].sort(([left], [right]) => left - right).map(([sourceSiteId, values]) => ({
      sourceSiteId, neighborSiteIds: [...values].sort((left, right) => left - right),
    }));
  }

  #physicalEpisode(event: DistributedR2ContinuousEventV1, traceId: string): {
    readonly episode: DistributedEpisodeV1;
    readonly input: Omit<DistributedR2AEventPhysicalInputV2, 'traceId'>;
  } {
    assert(event.beforeSignalTimeline.length === event.beforeSignalTimelineOccurrences.length,
      'R2A-public-sensor-timeline-length-mismatch');
    const firstOccurrences = new Map<string, DistributedPublicSignalOccurrenceV1>();
    event.beforeSignalTimeline.forEach((signals, pulseOrdinal) => {
      const expected = new Set(signals);
      assert(expected.size === signals.length, 'R2A-public-sensor-pulse-signals-must-be-unique');
      const occurrences = event.beforeSignalTimelineOccurrences[pulseOrdinal]!;
      assert(occurrences.every(value => value.pulseOrdinal === pulseOrdinal)
        && occurrences.length === expected.size
        && occurrences.every(value => expected.has(value.signalId)),
      'R2A-public-sensor-pulse-occurrences-mismatch');
      [...occurrences].sort((left, right) => left.channelOrdinal - right.channelOrdinal
        || left.receptorOrdinal - right.receptorOrdinal).forEach(occurrence => {
        if (!firstOccurrences.has(occurrence.signalId)) firstOccurrences.set(occurrence.signalId, occurrence);
      });
    });
    const conditionSignals = [...firstOccurrences.keys()];
    const conditionBindings = this.#ensureConditionRound([...firstOccurrences.values()],
      conditionSignals);
    const conditionSiteIds = unique(conditionBindings.flatMap(value => value.siteIds));
    const neighborhoods = this.#r2Neighborhoods(event);
    // New R2 events carry the actual projected amplitudes.  Legacy events
    // expose only site ids; those ids explicitly mean unit drives and are
    // upgraded once at this read boundary, never mixed silently with a
    // weighted event whose membership differs.
    const sourcePulseDrives = weightedPulsesForIdsV1(event.physicalPulseDrives,
      event.physicalPulseSiteIds, 'R2A-event-source');
    const projected = sourcePulseDrives.map((sourceDrives, pulseIndex) => this.#projection.projectPulse({
      pulseId: `${traceId}:r2-pulse:${pulseIndex}`, offset: pulseIndex * .04,
      drives: sourceDrives, sourceNeighborhoods: neighborhoods,
    }));
    const actionPulseDrives = event.orderedExperienceIdentities.map(identity =>
      unitWeightedPulseV1(this.#ensureAfferent('action', identity).siteIds,
        'R2A-action-binding'));
    const combined: DistributedEpisodeV1['pulses'][number][] = [];
    const push = (drives: readonly DistributedSiteDriveV1[], pulseId: string): void => {
      const normalized = normalizeDistributedWeightedPulseV1(drives, pulseId);
      if (normalized.length === 0) return;
      combined.push({ version: 'SparseFieldPulseV1', pulseId,
        offset: combined.length * .04,
        drives: normalized });
    };
    // Each public component is already a bounded 0..1 afferent.  Reducing every
    // component by the number of simultaneously visible components made a
    // repeated condition physically shallower than an equally repeated result
    // and prevented it from ever forming a local field assembly.
    const conditionDrives = unitWeightedPulseV1(conditionSiteIds, 'R2A-condition-binding');
    push(conditionDrives, `${traceId}:conditions`);
    let finalActionCombinedIndex = -1;
    const finalActionAtomIndex = event.atomPulseRanges.length - 1;
    event.atomPulseRanges.forEach((range, atomIndex) => {
      const beforeActionLength = combined.length;
      push(actionPulseDrives[atomIndex] ?? [], `${traceId}:action:${atomIndex}`);
      // The final action binding is the last input that belongs to the
      // reachable continuation.  Projected pulses that follow it are the
      // observed result, not part of the condition/prefix/action identity.
      // Record the index while the pulse-id boundary is still explicit;
      // deriving it from atom range lengths would accidentally include a
      // terminal result pulse when an atom contains both action and effects.
      if (atomIndex === finalActionAtomIndex && combined.length > beforeActionLength)
        finalActionCombinedIndex = combined.length - 1;
      for (let pulseIndex = range.startPulseIndex; pulseIndex < range.endPulseIndexExclusive; pulseIndex++) {
        const pulse = projected[pulseIndex];
        if (pulse) push(pulse.drives, `${traceId}:projected:${pulseIndex}`);
      }
    });
    assert(combined.length > 1 && projected.length > 0, 'R2A-event-needs-distributed-R2-sequence');
    const projectedPulseDrives = cloneWeightedPulsesV1(projected.map(pulse => pulse.drives));
    const projectedPulseSiteIds = projectedPulseDrives.map(pulse => weightedPulseSiteIdsV1(pulse));
    const terminalPulseDrives = [...(projectedPulseDrives.at(-1) ?? [])]
      .map(value => ({ ...value }));
    const terminalPulseSiteIds = weightedPulseSiteIdsV1(terminalPulseDrives);
    const finalActionIndex = event.atomPulseRanges.length - 1;
    const finalActionStartPulseIndex = event.atomPulseRanges[finalActionIndex]?.startPulseIndex ?? 0;
    const nextActionPrefixPulseDrives = cloneWeightedPulsesV1(projectedPulseDrives
      .slice(0, finalActionStartPulseIndex));
    const nextActionPrefixPulseSiteIds = nextActionPrefixPulseDrives
      .map(pulse => weightedPulseSiteIdsV1(pulse));
    const episodePulseDrives = cloneWeightedPulsesV1(combined.map(pulse => pulse.drives));
    const actionPulseSiteIds = actionPulseDrives.map(pulse => weightedPulseSiteIdsV1(pulse));
    // Preserve the exact physical continuation prefix.  The old
    // nextActionPrefix field contains only projected R2 populations and loses
    // the preceding action wires; replaying it alone can therefore funnel
    // every result into one basin.  Keep the complete route through the final
    // action, while excluding all post-action projected result pulses.
    assert(finalActionCombinedIndex > 0 && finalActionCombinedIndex < combined.length,
      'R2A-final-action-continuation-index-invalid');
    const reachableContinuationPulseDrives = cloneWeightedPulsesV1(
      episodePulseDrives.slice(0, finalActionCombinedIndex + 1));
    const reachableContinuationPulseSiteIds = reachableContinuationPulseDrives
      .map(pulse => weightedPulseSiteIdsV1(pulse));
    return { episode: { version: 'DistributedEpisodeV1', traceId,
      provenance: 'trusted-real-event', pulses: combined },
    input: { eventId: event.eventId, contextIds: [...event.contextIds].sort(),
      conditionSignalIds: conditionSignals, conditionSiteIds, conditionDrives,
      actionSiteIds: unique(actionPulseSiteIds.flat()), actionPulseSiteIds,
      actionPulseDrives, projectedPulseSiteIds, projectedPulseDrives,
      nextActionPrefixPulseSiteIds, nextActionPrefixPulseDrives,
      reachableContinuationPulseSiteIds, reachableContinuationPulseDrives,
      episodePulseSiteIds: episodePulseDrives.map(pulse => weightedPulseSiteIdsV1(pulse)),
      episodePulseDrives, terminalPulseSiteIds, terminalPulseDrives } };
  }

  #aggregateAttractorProbes(terminalSites: readonly number[],
    probes: readonly DistributedAttractorReadoutV1[]): DistributedAttractorReadoutV1 {
    if (terminalSites.length === 0) return emptyAttractor();
    const valid = probes.filter(value => value.coreSiteIds.length > 0 && !value.ambiguous);
    if (valid.length === 0) return emptyAttractor();
    const counts = new Map<number, number>();
    valid.forEach(value => value.coreSiteIds.forEach(siteId => counts.set(siteId, (counts.get(siteId) ?? 0) + 1)));
    const coreSiteIds = [...counts].filter(([, count]) => count >= Math.ceil(valid.length * .5))
      .map(([siteId]) => siteId).sort((left, right) => left - right);
    const best = [...valid].sort((left, right) => evidenceRank(right.evidenceLevel) - evidenceRank(left.evidenceLevel)
      || right.dwellSteps - left.dwellSteps || left.escapeRate - right.escapeRate)[0]!;
    const minimumGrade = [...valid].sort((left, right) =>
      evidenceRank(left.evidenceLevel) - evidenceRank(right.evidenceLevel))[0]!.evidenceLevel;
    const activationSums = new Map<number, number>();
    valid.forEach(value => value.terminalActivations?.forEach(activation =>
      activationSums.set(activation.siteId,
        (activationSums.get(activation.siteId) ?? 0) + activation.meanActivation)));
    const terminalActivations = [...activationSums]
      .map(([siteId, activation]) => ({ siteId,
        meanActivation: activation / valid.length }))
      .filter(value => value.meanActivation > 0)
      .sort((left, right) => left.siteId - right.siteId);
    // A branch may carry assembly metadata only when every readout that
    // survived the physical probe cohort agrees on the same repeated terminal
    // population.  Mixing tagged and untagged (or differently tagged) probes
    // would merge independent local basins and is therefore retained as an
    // explicit ambiguity instead of being repaired by a label or threshold.
    const assemblyIds = valid.map(value => value.coactivationAssemblyId)
      .filter((value): value is string => value !== undefined);
    const distinctAssemblyIds = new Set(assemblyIds);
    const assemblyId = assemblyIds.length === valid.length && distinctAssemblyIds.size === 1
      ? assemblyIds[0] : undefined;
    const assemblyMetadataConflict = assemblyIds.length > 0
      && (assemblyIds.length !== valid.length || distinctAssemblyIds.size !== 1);
    const coverageSamples = assemblyId === undefined ? []
      : valid.map(value => value.coactivationCoverage)
        .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const resonanceSamples = assemblyId === undefined ? []
      : valid.map(value => value.coactivationResonance)
        .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const { coactivationAssemblyId: _bestAssemblyId,
      coactivationCoverage: _bestCoverage,
      coactivationResonance: _bestResonance, ...bestWithoutAssembly } = best;
    return { ...bestWithoutAssembly, coreSiteIds,
      dwellSteps: Math.round(valid.reduce((sum, value) => sum + value.dwellSteps, 0) / valid.length),
      returnRate: valid.reduce((sum, value) => sum + value.returnRate, 0) / valid.length,
      escapeRate: valid.reduce((sum, value) => sum + value.escapeRate, 0) / valid.length,
      evidenceLevel: minimumGrade,
      terminalActivations,
      ...(assemblyId === undefined ? {} : {
        coactivationAssemblyId: assemblyId,
        ...(coverageSamples.length === valid.length ? {
          coactivationCoverage: Math.min(...coverageSamples),
        } : {}),
        ...(resonanceSamples.length === valid.length ? {
          coactivationResonance: Math.min(...resonanceSamples),
        } : {}),
      }),
      ambiguous: valid.length < Math.ceil(DISCOVERY_PROBES * .75)
        || coreSiteIds.length === 0 || assemblyMetadataConflict };
  }

  #aggregateAttractors(medium: DistributedPhysicalMedium3DV1,
    inputs: readonly { readonly terminalSites: readonly number[];
      readonly terminalDrives?: readonly DistributedSiteDriveV1[];
      readonly seedOffset: bigint }[]):
  readonly DistributedAttractorReadoutV1[] {
    if (inputs.length === 0) return [];
    const jobs: Array<Parameters<typeof runDistributedMediumProbeBatchSyncV1>[1][number]> = [];
    const owners: number[] = [];
    inputs.forEach((input, owner) => {
      if (input.terminalSites.length === 0) return;
      const terminalDrives = weightedPulseForIdsV1(input.terminalDrives,
        input.terminalSites, `R2A-terminal-discovery-${owner}`);
      for (let probeIndex = 0; probeIndex < DISCOVERY_PROBES; probeIndex++) {
        const perturbed = terminalDrives.filter((_drive, position) =>
          (position + probeIndex) % 4 !== 0);
        owners.push(owner);
        // A one-pulse sequential probe is physically equivalent to the old
        // unit `probe` call, but it preserves the measured afferent amplitude
        // instead of flattening every projected fibre to intensity 1.
        jobs.push({ index: jobs.length, kind: 'sequential',
          seedPulses: [perturbed.length > 0 ? perturbed : terminalDrives],
          seed: this.#seed ^ input.seedOffset ^ BigInt(probeIndex + 1), steps: PROBE_STEPS });
      }
    });
    const grouped: DistributedAttractorReadoutV1[][] = inputs.map(() => []);
    // A full distributed substrate snapshot is large enough that worker
    // structured-cloning multiplies its memory footprint.  Production uses
    // the exact single-copy serial path; explicit parallelism remains
    // available only to callers that have measured sufficient headroom.
    runDistributedMediumProbeBatchSyncV1(this.#readOnlyProbeSnapshot(medium), jobs,
      R2A_QUERY_PARALLELISM_V1)
      .forEach((readout, index) =>
      grouped[owners[index]!]!.push(readout));
    return inputs.map((input, index) =>
      this.#aggregateAttractorProbes(input.terminalSites, grouped[index]!));
  }

  #aggregateAttractor(medium: DistributedPhysicalMedium3DV1,
    terminalSites: readonly number[], seedOffset: bigint,
    terminalDrives?: readonly DistributedSiteDriveV1[]): DistributedAttractorReadoutV1 {
    return this.#aggregateAttractors(medium, [{ terminalSites, terminalDrives,
      seedOffset }])[0] ?? emptyAttractor();
  }

  /**
   * Calibrate an anonymous terminal readout from completed, trusted events.
   *
   * This is deliberately a learning/index operation, not a prediction.  A
   * terminal pulse that was actually observed in a closed event is allowed to
   * nominate the anonymous attractor whose physical residence will be used as
   * a later readout mask.  The resulting attractor is never put in a live
   * continuation seed: #aggregateContinuationAttractors and every prediction
   * entry point still receive only the current condition, observed prefix and
   * candidate action.  No semantic result label enters this calibration.
   */
  #aggregateObservedTerminalAttractors(medium: DistributedPhysicalMedium3DV1,
    inputs: readonly ContinuationCandidateV1[]): readonly DistributedAttractorReadoutV1[] {
    const seeded = this.#aggregateAttractors(medium, inputs.map((input, index) => ({
      terminalSites: input.terminalSites,
      terminalDrives: input.terminalDrives,
      // The candidate key is an anonymous physical input identity.  Deriving
      // the probe stream from it keeps calibration stable when event metadata
      // or insertion order changes, without introducing a result label.
      seedOffset: BigInt(`0x${sha(input.key).slice(0, 16)}`) ^ BigInt(index + 1),
    })));
    // A broad distributed terminal population can be a valid learned
    // assembly even when directly re-seeding all of its members does not
    // settle into a local basin within the readout window.  In that case,
    // measure the same population passively while replaying the complete
    // observed pre-terminal route.  The route is real event evidence; the
    // terminal population remains a mask only, so this fallback cannot inject
    // an answer-shaped future into the field.
    const needsRouteMeasurement = seeded.some(value => value.evidenceLevel === 'none'
      || value.ambiguous || value.coreSiteIds.length === 0);
    if (!needsRouteMeasurement) return seeded;
    const routed = this.#aggregateContinuationAttractors(medium, inputs);
    return seeded.map((value, index) => {
      if (value.evidenceLevel !== 'none' && !value.ambiguous
        && value.coreSiteIds.length > 0) return value;
      const candidate = routed[index];
      return candidate !== undefined && candidate.evidenceLevel !== 'none'
        && !candidate.ambiguous && candidate.coreSiteIds.length > 0 ? candidate : value;
    });
  }

  /**
   * Measure branches from the same physical continuation that production
   * prediction receives: the current boundary is held, the real observed
   * prefix is replayed in order, and the candidate action is the final input.
   * No historical terminal population is injected.  The small final-pulse
   * perturbations are only a repeatability measurement; they cannot nominate a
   * result that the reachable continuation did not visit.
   */
  #aggregateContinuationAttractors(medium: DistributedPhysicalMedium3DV1,
    inputs: readonly ContinuationCandidateV1[]): readonly DistributedAttractorReadoutV1[] {
    if (inputs.length === 0) return [];
    const jobs: Array<Parameters<typeof runDistributedMediumProbeBatchSyncV1>[1][number]> = [];
    const owners: number[] = [];
    // Historical terminal populations are passive competitors.  Use one
    // common physical denominator for every candidate so weak residue cannot
    // become significant merely because a candidate is measured in isolation.
    const readoutDomainSiteIds = unique(inputs.flatMap(input => input.terminalSites));
    inputs.forEach((input, owner) => {
      if (input.seedPulses.length === 0 || input.seedPulses.some(pulse => pulse.length === 0)) return;
      const finalPulseIndex = input.seedPulses.length - 1;
      for (let probeIndex = 0; probeIndex < DISCOVERY_PROBES; probeIndex++) {
        const seedPulses = input.seedPulses.map((pulse, pulseIndex) => {
          if (pulseIndex !== finalPulseIndex) return pulse;
          const perturbed = pulse.filter((_drive, position) =>
            (position + probeIndex) % 4 !== 0);
          return perturbed.length > 0 ? perturbed : pulse;
        });
        const common = { index: jobs.length, seedPulses,
          seed: this.#seed ^ BigInt(owner + 1) * 0x434f4e54494e554en
            ^ BigInt(probeIndex + 1), steps: PROBE_STEPS,
          readoutSiteIds: input.terminalSites,
          readoutDomainSiteIds };
        jobs.push(input.conditionDrives.length > 0
          ? { ...common, kind: 'conditioned-sequential-readout' as const,
            conditionSiteIds: input.conditionDrives }
          : { ...common, kind: 'sequential-readout' as const });
        owners.push(owner);
      }
    });
    const grouped: DistributedAttractorReadoutV1[][] = inputs.map(() => []);
    if (jobs.length > 0) {
      runDistributedMediumProbeBatchSyncV1(this.#readOnlyProbeSnapshot(medium), jobs,
        R2A_QUERY_PARALLELISM_V1)
        .forEach((readout, index) => grouped[owners[index]!]!.push(readout));
    }
    return inputs.map((input, index) => this.#aggregateAttractorProbes(
      input.terminalSites, grouped[index]!));
  }

  #scoreReadoutAgainstBranches(readout: DistributedAttractorReadoutV1,
    branches: readonly DistributedR2AAnonymousPhysicalBranchV2[]): readonly {
      readonly branchId: string; readonly score: number }[] {
    const universe = unique(branches.flatMap(value => value.topologicalEnvelopeSiteIds));
    return branches.map(branch => {
      // Once a readout carries an exact repeated-terminal assembly id, only a
      // branch from that same physical population is eligible to receive the
      // score.  A core-only comparison would make two independent assemblies
      // that share a local basin look interchangeable.  An untagged readout
      // remains scoreable against the physical profile for legacy/partial
      // evidence; it never invents an assembly identity.
      if (readout.coactivationAssemblyId !== undefined
        && branch.coactivationAssemblyId !== readout.coactivationAssemblyId)
        return { branchId: branch.branchId, score: 0 };
      const profile = (branch.attractor.terminalActivations ?? [])
        .filter(value => branch.topologicalEnvelopeSiteIds.includes(value.siteId));
      const score = profile.length > 0 && (readout.terminalActivations?.length ?? 0) > 0
        ? physicalActivationResidenceMatchV1(readout.terminalActivations!, profile,
          branch.topologicalEnvelopeSiteIds, universe).score
        : physicalResidenceMatchV1(readout.coreSiteIds,
          branch.attractor.coreSiteIds).score;
      return { branchId: branch.branchId, score };
    }).sort((left, right) => right.score - left.score
      || left.branchId.localeCompare(right.branchId, 'en'));
  }

  #selectionRate(medium: DistributedPhysicalMedium3DV1,
    currentConditionSiteIds: DistributedProbePulseInputV1,
    seedPulses: readonly DistributedProbePulseInputV1[],
    targetCore: readonly number[], probeCount: number, seedOffset: bigint): number {
    return this.#selectionRates(medium, [{ currentConditionSiteIds, seedPulses,
      targetCore, probeCount, seedOffset }])[0]!;
  }

  #selectionRates(medium: DistributedPhysicalMedium3DV1, queries: readonly {
    readonly currentConditionSiteIds: DistributedProbePulseInputV1;
    readonly seedPulses: readonly DistributedProbePulseInputV1[];
    readonly targetCore: readonly number[];
    readonly probeCount: number;
    readonly seedOffset: bigint;
  }[]): number[] {
    const counts = queries.map(() => 0);
    const branches = this.physicalBranches();
    // Terminal activation outside every branch's physical envelope cannot
    // affect any selection score.  Pass the exact union as a readout focus so
    // workers do not serialise unrelated field sites; no trajectory or score
    // input is changed.
    const selectionFocusSiteIds = unique(branches.flatMap(value =>
      value.topologicalEnvelopeSiteIds));
    const targetBranchIds = queries.map(query => branches.find(branch =>
      branch.attractor.coreSiteIds.length === query.targetCore.length
      && branch.attractor.coreSiteIds.every((siteId, index) => siteId === query.targetCore[index]))?.branchId);
    const queryJobs: Array<{ readonly queryIndex: number;
      readonly jobs: readonly Parameters<typeof runDistributedMediumProbeBatchSyncV1>[1][number][] }> = [];
    queries.forEach((query, queryIndex) => {
      if (query.seedPulses.length === 0 || query.seedPulses.some(pulse => pulse.length === 0)
        || query.targetCore.length === 0) return;
      const jobs: Parameters<typeof runDistributedMediumProbeBatchSyncV1>[1][number][] = [];
      for (let probeIndex = 0; probeIndex < query.probeCount; probeIndex++) {
        const common = { index: probeIndex, seedPulses: query.seedPulses,
          seed: this.#seed ^ query.seedOffset ^ BigInt(probeIndex + 1),
          steps: Math.max(PROBE_STEPS, query.seedPulses.length) };
        jobs.push(query.currentConditionSiteIds.length > 0
          ? { ...common, kind: 'conditioned-sequential', conditionSiteIds: query.currentConditionSiteIds }
          : { ...common, kind: 'sequential' });
      }
      queryJobs.push({ queryIndex, jobs });
    });
    const restingSnapshot = this.#readOnlyProbeSnapshot(medium);
    // Consume bounded chunks rather than serialising all intervention
    // readouts in one message.  Chunking does not alter a trajectory: seeds,
    // pulse inputs, integration steps and target scoring are unchanged.
    const maximumProbeCount = Math.max(1, ...queryJobs.map(value => value.jobs.length));
    const queryBatchSize = Math.max(1,
      Math.floor(MAX_PROBE_READOUTS_PER_BATCH_V1 / maximumProbeCount));
    for (let start = 0; start < queryJobs.length; start += queryBatchSize) {
      const chunk = queryJobs.slice(start, start + queryBatchSize);
      const jobs: Parameters<typeof runDistributedMediumProbeBatchSyncV1>[1][number][] = [];
      const owners: number[] = [];
      for (const item of chunk) for (const job of item.jobs) {
        jobs.push({ ...job, index: jobs.length }); owners.push(item.queryIndex);
      }
      const readouts = runDistributedMediumProbeBatchSyncV1(restingSnapshot, jobs,
        R2A_QUERY_PARALLELISM_V1,
        { compactReadout: true, compactSiteIds: selectionFocusSiteIds });
      readouts.forEach((readout, index) => {
        const owner = owners[index]!;
        const ranked = this.#scoreReadoutAgainstBranches(readout, branches);
        const targetBranchId = targetBranchIds[owner];
        const uniqueTargetWinner = targetBranchId !== undefined
          && ranked[0]?.branchId === targetBranchId && ranked[0].score >= .5
          && ranked[0].score - (ranked[1]?.score ?? 0) >= .1;
        const fallbackMembership = targetBranchId === undefined
          ? physicalResidenceMatchV1(readout.coreSiteIds, queries[owner]!.targetCore).score : 0;
        counts[owner]! += Number(readout.evidenceLevel !== 'none' && !readout.ambiguous
          // A continuation is an ordered physical event, not merely a local
          // well that the final action happens to excite.  Require the rollout
          // to have actually transported excitation through a learned directed
          // channel; the field reports this measured mass and remains the sole
          // source of the gate.  If channels are ablated, local wells may still
          // exist but cannot certify an R2A continuation.
          && (readout.run.directedTransportMass ?? 0) > 0
          && readout.dwellSteps >= TERMINAL_DWELL_MIN_STEPS
          && readout.escapeRate <= .25
          && (uniqueTargetWinner || fallbackMembership >= .75));
      });
    }
    return counts.map((count, index) => count / queries[index]!.probeCount);
  }

  #grade(pattern: Omit<DistributedR2APhysicalPatternV2, 'grade'>): EvidenceGrade {
    if (pattern.supportCount < 2 || pattern.attractor.evidenceLevel === 'none') return 'single-observation';
    const contradictionRate = pattern.contradictionCount
      / Math.max(1, pattern.supportCount + pattern.contradictionCount);
    // Independent active members establish the minimum repetition cardinality;
    // supportCount is a decaying physical weight used for the contradiction
    // ratio and must not turn a tiny elapsed-time recovery drift (for example
    // 7.998... effective support from eight active events) into a new grade.
    // When a member's physical footprint really expires it is removed from
    // memberR2EventIds during rediscovery, so this gate still fails closed.
    if (pattern.memberR2EventIds.length < 8 || pattern.contextIds.length < 4
      // The dynamic attractor must be physically repeatable, but its local
      // core sites need not each have received all eight distributed events.
      // Pattern-level stability is supplied by the eight complete member
      // roads across four contexts together with dwell/return/escape below.
      // Requiring mean per-site support >= 8 collapses a population code back
      // into an implicit single-site counter.
      || evidenceRank(pattern.attractor.evidenceLevel) < evidenceRank('repeated-correlation')
      || pattern.attractor.ambiguous || pattern.corridor.forwardPropagationRate < .80
      || pattern.corridor.reverseRejectionRate < .80 || contradictionRate > .2)
      return 'repeated-correlation';
    return 'predictive-stable';
  }

  /**
   * Read one completed event's terminal population from a resting copy of the
   * field.  This is intentionally a physical measurement, not a lookup of an
   * event/result annotation.  The small cache is keyed by the measured pulse
   * so repeated events do not replicate the same probe batch.
   */
  #observedTerminalReadout(input: DistributedR2AEventPhysicalInputV2,
    medium: DistributedPhysicalMedium3DV1,
    cache: Map<string, DistributedAttractorReadoutV1>): DistributedAttractorReadoutV1 {
    const drives = normalizeDistributedWeightedPulseV1(
      input.terminalPulseDrives
        ?? unitWeightedPulseV1(input.terminalPulseSiteIds,
          `R2A-contradiction-terminal-${input.eventId}`),
      `R2A-contradiction-terminal-${input.eventId}`);
    const key = JSON.stringify(drives);
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    const value = drives.length === 0 ? emptyAttractor()
      : this.#aggregateAttractor(medium, drives.map(item => item.siteId),
        BigInt(`0x${sha({ version: 'R2A-observed-terminal-readout-v1', drives }).slice(0, 16)}`),
        drives);
    cache.set(key, value);
    return value;
  }

  /**
   * Count only physically resolved members of a matched cohort.  The target
   * branch is the pattern/relation's already established physical attractor;
   * it is never re-anchored to whichever outcome happens to be most common in
   * the cohort being measured.  A member is a contradiction only when a
   * different measured branch wins with a clear margin.  The event's public
   * labels are never consulted.  Footprint support mass supplies the same
   * decaying weight as the underlying medium, so recovery can lower either
   * count naturally.
   */
  #physicalOutcomeCounts(members: readonly DistributedR2AEventPhysicalInputV2[],
    expectedAttractor: DistributedAttractorReadoutV1,
    alternatives: readonly DistributedAttractorReadoutV1[],
    medium: DistributedPhysicalMedium3DV1): PhysicalOutcomeCountsV1 {
    if (members.length === 0) return { support: 0, contradiction: 0 };
    const readoutCache = new Map<string, DistributedAttractorReadoutV1>();
    const entries = members.map(input => ({ input,
      readout: this.#observedTerminalReadout(input, medium, readoutCache) }))
      .filter(value => validPhysicalAttractorV1(value.readout));
    if (entries.length === 0) return { support: 0, contradiction: 0 };

    const weightOf = (input: DistributedR2AEventPhysicalInputV2): number => {
      const footprint = medium.footprint(input.traceId);
      return Math.min(1, Math.max(0, footprint?.supportMass ?? 0));
    };
    // Keep the relation's target branch as the expected physical reference.
    // Measured members that resolve to a distinct terminal population are
    // anonymous alternatives as well; including them prevents a majority of
    // flipped outcomes from silently redefining the target branch.
    const expected = expectedAttractor;
    const measuredAlternatives = entries.map(value => value.readout)
      .filter(value => physicalTerminalMembershipScoreV1(value, expected)
        < MATCHED_CONTRAST_MAX_TERMINAL_OVERLAP);
    const physicalAlternatives = [...alternatives, ...measuredAlternatives]
      .filter(value => validPhysicalAttractorV1(value)
        && physicalTerminalMembershipScoreV1(value, expected)
          < MATCHED_CONTRAST_MAX_TERMINAL_OVERLAP);
    let support = 0, contradiction = 0;
    for (const value of entries) {
      const classification = physicalOutcomeClassV1(value.readout, expected, physicalAlternatives);
      const weight = weightOf(value.input);
      if (classification === 'support') support += weight;
      else if (classification === 'contradiction') contradiction += weight;
    }
    return { support, contradiction };
  }

  #relationMatchedInputs(pattern: DistributedR2APhysicalPatternV2,
    factor: DistributedR2APhysicalFactorV2): readonly DistributedR2AEventPhysicalInputV2[] {
    const prefix = pattern.corridor.orderedPrefixPulseSiteIds;
    const action = pattern.corridor.actionPulseSiteIds.at(-1) ?? [];
    // Start from every active physical input assigned to this reachable key,
    // not only the dominant branch's retained members.  A minority terminal
    // outcome with the same condition/prefix/action is precisely the evidence
    // that must be counted as a contradiction; dropping it while rebuilding
    // the branch would make contradiction counts depend on branch compression.
    const matched = [...this.#eventInputs.values()]
      .filter(input => this.#candidateBranchAssignments.get(
        continuationCandidateForInputV1(input).key) === pattern.patternId)
      .filter(input => input.nextActionPrefixPulseSiteIds.length >= prefix.length
        && prefix.every((pulse, index) =>
          distributedObservedPopulationCoversLocalAssemblyV1(
            pulse, input.nextActionPrefixPulseSiteIds[index] ?? []) >= .8)
        && distributedObservedPopulationCoversLocalAssemblyV1(
          action, input.actionPulseSiteIds.at(-1) ?? []) >= .8
        && coveredFraction(factor.coreSiteIds, input.conditionSiteIds) >= .5);
    return matched;
  }

  #rediscoverPhysicalIndexes(rebuildRelations = true): {
    readonly medium: DistributedPhysicalMedium3DV1;
    readonly scan: AnonymousPhysicalScanV1;
  } {
    this.#invalidatePhysicalQueryCaches();
    this.#patterns.clear(); this.#relations.clear();
    const medium = this.#restingMedium();
    const scan = this.#physicalStructure();
    const physicalBranches = this.physicalBranches(scan);
    const activeInputs = [...this.#eventInputs.values()].filter(input =>
      this.#r2Active(input.eventId) && this.medium.isFootprintActive(input.traceId));
    for (const branch of physicalBranches.filter(value => value.terminalUnderCurrentChannels)) {
      const members = activeInputs.filter(input => this.#candidateBranchAssignments.get(
        continuationCandidateForInputV1(input).key)
        === branch.branchId);
      if (members.length === 0) continue;
      const orderedPrefixPulseDrives = consensusWeightedPulseSequence(
        members.map(value => value.nextActionPrefixPulseDrives
          ?? weightedPulsesForIdsV1(undefined, value.nextActionPrefixPulseSiteIds,
            `R2A-legacy-prefix-${value.eventId}`)));
      const orderedPrefixPulseSiteIds = orderedPrefixPulseDrives
        .map(pulse => weightedPulseSiteIdsV1(pulse));
      const finalObservedPrefix = orderedPrefixPulseSiteIds.at(-1) ?? [];
      if (finalObservedPrefix.length === 0) continue;
      const contextIds = uniqueStrings(members.flatMap(value => value.contextIds));
      const actionPulseDrives = consensusWeightedPulseSequence(
        members.map(value => value.actionPulseDrives
          ?? weightedPulsesForIdsV1(undefined, value.actionPulseSiteIds,
            `R2A-legacy-action-${value.eventId}`)));
      const actionPulseSiteIds = actionPulseDrives.map(pulse => weightedPulseSiteIdsV1(pulse));
      const nextActionPulse = actionPulseSiteIds.at(-1) ?? [];
      const prefixPulse = unique(orderedPrefixPulseSiteIds.flat());
      // Stable-pattern qualification follows the repeated real ordered roads:
      // at least 80% of member events must contain the same ordered physical
      // prefix and exact next-action population.  Random continuation quality
      // is measured later by PredictionClone and must not redefine whether the
      // historical road itself repeatedly occurred.
      const forwardPropagationRate = nextActionPulse.length === 0 ? 0
        : members.filter(input => input.nextActionPrefixPulseSiteIds.length
          >= orderedPrefixPulseSiteIds.length
          && orderedPrefixPulseSiteIds.every((pulse, index) =>
            distributedObservedPopulationCoversLocalAssemblyV1(pulse,
              input.nextActionPrefixPulseSiteIds[index] ?? []) >= .8)
          && distributedObservedPopulationCoversLocalAssemblyV1(nextActionPulse,
            input.actionPulseSiteIds.at(-1) ?? []) >= .8).length / members.length;
      const reverseToPrefix = finalObservedPrefix.length
        ? this.#selectionRate(medium, [], [branch.attractor.coreSiteIds.map(siteId => ({
          siteId, intensity: 1 }))], finalObservedPrefix, 16,
          BigInt((branch.attractor.coreSiteIds[0] ?? 0) + 1) ^ 0x524556n) : 1;
      const corridorCoreSiteIds = unique([
        ...orderedPrefixPulseSiteIds.flat(), ...actionPulseSiteIds.flat(),
        ...branch.attractor.coreSiteIds,
      ]).filter(siteId => medium.site(siteId).supportMass > 0);
      if (corridorCoreSiteIds.length === 0) continue;
      const outcomeCounts = this.#physicalOutcomeCounts(members, branch.attractor,
        physicalBranches.filter(value => value.branchId !== branch.branchId)
          .map(value => value.attractor), medium);
      const base = { version: 'DistributedR2APhysicalPatternV2' as const,
        patternId: branch.branchId, memberR2EventIds: members.map(value => value.eventId).sort(),
        contextIds, physicalTraceIds: members.map(value => value.traceId).sort(),
        // Evidence cardinality is the number of still-active independent
        // continuous events.  Repeated deposition can deepen a distributed
        // attractor, but its per-site support mass must never impersonate
        // additional real events after lower-layer evidence is erased.
        supportCount: outcomeCounts.support,
        contradictionCount: outcomeCounts.contradiction,
         // Preserve the complete physical readout, including weighted terminal
         // activation profiles and any coactivation assembly evidence.  The
         // fields remain anonymous measurements; no public/result label is
         // introduced during pattern assembly.
         attractor: structuredClone(branch.attractor),
        corridor: { orderedPrefixPulseSiteIds, orderedPrefixPulseDrives,
          prefixSiteIds: prefixPulse, actionPulseSiteIds, actionPulseDrives,
          actionSiteIds: unique(actionPulseSiteIds.flat()),
          terminalCoreSiteIds: branch.attractor.coreSiteIds,
          // A stable distributed road is the repeatedly supported ordered
          // physical population itself.  It need not terminate in a graph
          // sink: recurrent directed channels are normal in a plastic field.
          corridorCoreSiteIds,
          forwardPropagationRate, reverseRejectionRate: 1 - reverseToPrefix } };
      const grade = this.#grade(base);
      this.#patterns.set(branch.branchId, { ...base, grade });
    }
    if (rebuildRelations) this.#rebuildPhysicalRelations(medium, scan);
    this.#indexesDirty = false;
    return { medium, scan };
  }

  #ensurePhysicalIndexes(): void {
    if (this.#indexesDirty) this.#rediscoverPhysicalIndexes();
  }

  #rebuildPhysicalRelations(medium: DistributedPhysicalMedium3DV1,
    scan = this.#physicalStructure(), options: { readonly deferRollout?: boolean } = {}): void {
    this.#invalidateApplicabilityQueryCache();
    const deferRollout = options.deferRollout === true;
    const previousAssessments = [...this.#interventions.values()];
    this.#relations.clear();
    const patterns = [...this.#patterns.values()];
    const physicalFactorBasins = scan.basins.filter(value =>
      value.meanSupportMass >= 2 && value.internalLocalBondCount > 0);
    for (const pattern of patterns) {
      const patternEventInputs = pattern.memberR2EventIds
        .map(eventId => this.#eventInputs.get(eventId))
        .filter((value): value is DistributedR2AEventPhysicalInputV2 => value !== undefined);
      const prefix = pattern.corridor.orderedPrefixPulseSiteIds;
      const nextActionPulse = pattern.corridor.actionPulseSiteIds.at(-1) ?? [];
      const prefixDrives = pattern.corridor.orderedPrefixPulseDrives
        ?? weightedPulsesForIdsV1(undefined, prefix, `R2A-legacy-pattern-prefix-${pattern.patternId}`);
      const actionDrives = pattern.corridor.actionPulseDrives
        ?? weightedPulsesForIdsV1(undefined, pattern.corridor.actionPulseSiteIds,
          `R2A-legacy-pattern-action-${pattern.patternId}`);
      const nextActionDrives = actionDrives.at(-1) ?? unitWeightedPulseV1(nextActionPulse,
        `R2A-pattern-action-${pattern.patternId}`);
      if (prefix.length === 0 || nextActionPulse.length === 0) continue;
      for (const basin of physicalFactorBasins) {
        if (overlap(basin.coreSiteIds, pattern.attractor.coreSiteIds) >= .25) continue;
        const decoderBindings = [...this.#conditionBindings.values()]
          .filter(binding => distributedObservedPopulationCoversLocalAssemblyV1(
            basin.coreSiteIds, binding.siteIds) >= .5);
        if (decoderBindings.length === 0) continue;
        const sourceSignalIds = uniqueStrings(decoderBindings.map(value => value.signalId));
        const sourceChannelIds = uniqueStrings(sourceSignalIds.map(distributedPublicSignalChannelIdV1));
        // The basin is discovered from the field first.  Afferent bindings are
        // consulted only afterwards to decode which currently observable input
        // can reactivate it.  They never qualify the relation.
        // A production relation already requires eight active, trusted
        // differential traces for this exact physical basin.  Apply that hard
        // evidence gate before launching any stochastic counterfactual probes:
        // moving it earlier changes no accepted relation, it only avoids
        // simulating basins that must be rejected later.
        const differentialIdentity = sha({ version: 'DistributedR2AStableDifferentialBasinV1',
          coreSiteIds: basin.coreSiteIds });
        const differentialTraceIds = pattern.memberR2EventIds
          .map(eventId => `r2a-differential-${eventId}-${differentialIdentity}`)
          .filter(traceId => this.medium.isFootprintActive(traceId));
        if (differentialTraceIds.length < 8) continue;
        // A physical factor comparison is a matched intervention: both arms
        // contain the same real prefix and the same exact next-action
        // population.  Only the candidate condition basin is removed.
        const continuation: readonly DistributedProbePulseInputV1[] = [
          ...prefixDrives, nextActionDrives];
        const probeSeed = BigInt((basin.coreSiteIds[0] ?? 0) + 1) ^ 0x66756c6cn;
        let fullRate = 0, stateContrastLoss = 0, factorAblationLoss = 0;
        let physicalFactorQualified = false;
        const alternativeStateBindings = [...this.#conditionBindings.values()].filter(binding =>
          !sourceSignalIds.includes(binding.signalId)
          && sourceChannelIds.includes(distributedPublicSignalChannelIdV1(binding.signalId)));
        if (!deferRollout) {
          // Preserve the measured condition amplitudes from the member event
          // populations.  The basin id list is an audit/readout view; using it
          // as a unit probe would erase the R2A fibre strength before the
          // physical selection measurement.  Consensus is deliberately
          // conservative: a factor drive must occur in the repeated member
          // cohort, not be invented from the first event.
          // The full pre-action public condition is the boundary under which
          // this road was actually observed.  The basin is the anonymous
          // factor identity, not a replacement for the rest of that boundary:
          // probing with only the factor population would turn a contextual
          // branch into an artificial one-variable shortcut and can make one
          // of two otherwise symmetric arms appear unsupported.  Keep the
          // complete measured pulse for the full arm; the factor-specific
          // ablation below removes only the corresponding variable.
          const factorConditionDrives = consensusWeightedPulseSequence(
            patternEventInputs.map(input => {
              const condition = input.conditionDrives
                ?? unitWeightedPulseV1(input.conditionSiteIds,
                  `R2A-legacy-relation-condition-${input.eventId}`);
              return [condition];
            })).at(0) ?? [];
          fullRate = this.#selectionRate(medium, factorConditionDrives, continuation,
            pattern.attractor.coreSiteIds, 8, probeSeed);
          const alternativeStateRate = alternativeStateBindings.length === 0 ? 0
            : Math.max(...alternativeStateBindings.map(binding => this.#selectionRate(medium,
              binding.siteIds, continuation, pattern.attractor.coreSiteIds, 8, probeSeed)));
          stateContrastLoss = fullRate - alternativeStateRate;
          const ablatedRate = this.#selectionRate(medium, [], continuation,
            pattern.attractor.coreSiteIds, 8, probeSeed);
          factorAblationLoss = Math.max(0, fullRate - ablatedRate);
          physicalFactorQualified = fullRate >= .75
            && (alternativeStateBindings.length > 0 ? stateContrastLoss : factorAblationLoss) >= .25;
        }
        // A categorical factor state is established by changing that physical
        // channel to another actually observed state, not by deleting the
        // variable and calling the resulting unknown state a counterfactual.
        // Channels with no observed alternative retain the stricter unknown
        // ablation criterion.
        const supportCount = Math.floor(basin.meanSupportMass);
        const factor: DistributedR2APhysicalFactorV2 = {
          factorId: sha({ version: 'DistributedR2APhysicalFactorIdentityV2',
            coreSiteIds: basin.coreSiteIds }),
          sourceSignalIds,
          sourceChannelIds,
          afferentSiteIds: unique(decoderBindings.flatMap(value => value.siteIds)),
          coreSiteIds: [...basin.coreSiteIds] };
        const relationId = sha({ version: 'DistributedR2APhysicalRelationIdentityV2',
          patternId: pattern.patternId, factorCoreSiteIds: factor.coreSiteIds });
        // Repeated differential traces are already a field-derived relation
        // candidate even when the current stochastic rollout has not yet
        // demonstrated intervention-level selectivity.  Keeping that
        // candidate at repeated-correlation lets the real intervention probe
        // evaluate it; refusing to create it here makes the intervention
        // impossible to perform (the old circular gate).  No threshold is
        // lowered: only a physically qualified rollout can retain the
        // pattern's stronger grade.
        const baseGrade: EvidenceGrade = physicalFactorQualified
          ? pattern.grade : 'repeated-correlation';
        const prior = previousAssessments.filter(value => value.relationId === relationId);
        const aggregate = summarizeDistributedR2AInterventionsV2(prior, baseGrade,
          fullRate, factorAblationLoss);
        const relationMembers = this.#relationMatchedInputs(pattern, factor);
        const relationOutcomeCounts = this.#physicalOutcomeCounts(relationMembers,
          pattern.attractor, patterns.filter(value => value.patternId !== pattern.patternId)
            .map(value => value.attractor), medium);
        const relationContradictionRate = relationOutcomeCounts.contradiction
          / Math.max(1, relationOutcomeCounts.support + relationOutcomeCounts.contradiction);
        // A physically observed contradiction caps the relation at the
        // correlation grade.  Intervention aggregates may otherwise restore
        // an old high grade after a new opposite outcome has been observed.
        const relationGrade: EvidenceGrade = relationContradictionRate > .2
          ? 'repeated-correlation' : aggregate.grade;
        this.#relations.set(relationId, { version: 'DistributedR2APhysicalRelationV2', relationId,
          patternId: pattern.patternId, factors: [factor],
          supportCount: relationOutcomeCounts.support > 0 ? relationOutcomeCounts.support : supportCount,
          contradictionCount: relationOutcomeCounts.contradiction,
          matchedInterventionCount: aggregate.matchedInterventionCount,
          physicallyCorrectInterventionCount: aggregate.physicallyCorrectInterventionCount,
          meanFullFactorSelectionRate: aggregate.meanFullFactorSelectionRate,
          stateContrastSelectionLoss: Math.max(0, stateContrastLoss),
          meanFactorAblationLoss: aggregate.meanFactorAblationLoss,
          grade: relationGrade, physicalTraceIds: differentialTraceIds.sort() });
      }
    }
  }

  #refreshInterventionAggregate(relationId: string): void {
    const relation = this.#relations.get(relationId);
    assert(relation, 'R2A-intervention-relation-disappeared-without-medium-change');
    const pattern = this.#patterns.get(relation.patternId);
    assert(pattern, 'R2A-intervention-pattern-disappeared-without-medium-change');
    const aggregate = summarizeDistributedR2AInterventionsV2(
      [...this.#interventions.values()].filter(value => value.relationId === relationId),
      pattern.grade, relation.meanFullFactorSelectionRate, relation.meanFactorAblationLoss);
    const contradictionRate = relation.contradictionCount
      / Math.max(1, relation.supportCount + relation.contradictionCount);
    this.#relations.set(relationId, { ...relation,
      matchedInterventionCount: aggregate.matchedInterventionCount,
      physicallyCorrectInterventionCount: aggregate.physicallyCorrectInterventionCount,
      meanFullFactorSelectionRate: aggregate.meanFullFactorSelectionRate,
      meanFactorAblationLoss: aggregate.meanFactorAblationLoss,
      grade: contradictionRate > .2 ? 'repeated-correlation' : aggregate.grade });
  }

  /**
   * Delayed physical consolidation of condition differences.  Raw events first
   * build their complete ordered R2A traces with no condition-to-result shortcut.
   * Only after repeated terminal attractors exist do we compare anonymous
   * condition basins across their real member footprints.  A basin present in
   * at least 80% of one branch and at most 20% of the other stable branches is
   * replayed as the corresponding real event subsequence.  Common and balanced
   * pseudo-correlates therefore never receive a long-range result channel.
   */
  #consolidateStableConditionDifferences(): void {
    this.#consolidationPassCount++;
    const prepared = this.#rediscoverPhysicalIndexes(false);
    const stablePatterns = [...this.#patterns.values()].filter(value =>
      evidenceRank(value.grade) >= evidenceRank('predictive-stable'));
    if (stablePatterns.length < 2) {
      // A condition difference needs at least two physically distinct stable
      // result branches.  Rebuilding generic basin relations here would turn a
      // single branch into its own counterfactual.
      this.#relations.clear();
      this.#indexesDirty = false;
      return;
    }
    const scan = prepared.scan;
    const conditionBasins = scan.basins.filter(basin =>
      basin.meanSupportMass >= 2 && basin.internalLocalBondCount > 0
      && [...this.#conditionBindings.values()].some(binding =>
        distributedObservedPopulationCoversLocalAssemblyV1(
          basin.coreSiteIds, binding.siteIds) >= .5));
    const knownTraceIds = new Set(this.medium.snapshot().footprints.map(value => value.traceId));
    let changed = false;
    for (const pattern of stablePatterns) {
      const members = pattern.memberR2EventIds
        .map(eventId => this.#eventInputs.get(eventId)).filter(value => value !== undefined);
      const comparableContrasts = stablePatterns.filter(value => value.patternId !== pattern.patternId
        && distributedR2APhysicalMatchedContrastV1(pattern, value));
      const contrasts = comparableContrasts
        .flatMap(value => value.memberR2EventIds)
        .map(eventId => this.#eventInputs.get(eventId)).filter(value => value !== undefined);
      if (members.length < 8 || contrasts.length === 0) continue;
      for (const basin of conditionBasins) {
        const differential = distributedR2AConditionDifferentialV1(basin.coreSiteIds,
          members.map(input => input.conditionSiteIds),
          contrasts.map(input => input.conditionSiteIds));
        if (!differential.qualifies) continue;
        const factorIdentity = sha({ version: 'DistributedR2AStableDifferentialBasinV1',
          coreSiteIds: basin.coreSiteIds });
        for (const input of members) {
          const conditionDrives = input.conditionDrives
            ?? unitWeightedPulseV1(input.conditionSiteIds, `R2A-legacy-condition-${input.eventId}`);
          const factorDrives = conditionDrives.filter(drive => basin.coreSiteIds.includes(drive.siteId));
          const factorSites = weightedPulseSiteIdsV1(factorDrives);
          const actionDrives = input.actionPulseDrives?.at(-1)
            ?? unitWeightedPulseV1(input.actionPulseSiteIds.at(-1) ?? [],
              `R2A-legacy-action-${input.eventId}`);
          const prefixDrives = input.nextActionPrefixPulseDrives
            ?? weightedPulsesForIdsV1(undefined, input.nextActionPrefixPulseSiteIds,
              `R2A-legacy-prefix-${input.eventId}`);
          const terminalDrives = input.terminalPulseDrives
            ?? unitWeightedPulseV1(input.terminalPulseSiteIds,
              `R2A-legacy-terminal-${input.eventId}`);
          const actionSites = weightedPulseSiteIdsV1(actionDrives);
          if (coveredFraction(basin.coreSiteIds, factorSites) < .5
            || prefixDrives.length === 0
            || actionDrives.length === 0 || terminalDrives.length === 0) continue;
          const traceId = `r2a-differential-${input.eventId}-${factorIdentity}`;
          if (knownTraceIds.has(traceId)) continue;
          const populations = [factorDrives, ...prefixDrives,
            actionDrives, terminalDrives].map(value => normalizeDistributedWeightedPulseV1(value));
          this.medium.applyEpisode({ version: 'DistributedEpisodeV1', traceId,
            provenance: 'trusted-real-event',
            pulses: populations.map((siteIds, index) => ({ version: 'SparseFieldPulseV1',
              pulseId: `${traceId}:${index}`, offset: index * .04,
              drives: siteIds })),
            temporalEligibility: [{ fromPulseIndex: 0,
              toPulseIndex: populations.length - 1, strength: 1 }] }, 1);
          knownTraceIds.add(traceId); changed = true;
        }
      }
    }
    if (changed) this.#invalidatePhysicalQueryCaches();
    this.#indexesDirty = true;
    if (changed) this.#rediscoverPhysicalIndexes();
    else {
      this.#rebuildPhysicalRelations(prepared.medium, prepared.scan);
      this.#indexesDirty = false;
    }
  }

  observe(event: DistributedR2ContinuousEventV1): DistributedR2APhysicalObservationReceiptV2 {
    assert(event.learningEligible && event.completion === 'complete' && event.physicalFootprint,
      'R2A-requires-complete-physical-R2-event');
    assert(!this.#events.has(event.eventId), 'R2A-event-already-observed');
    const traceId = `r2a-${event.eventId}`;
    const physical = this.#physicalEpisode(event, traceId);
    const footprint = this.medium.applyEpisode(physical.episode, 1);
    this.#invalidatePhysicalQueryCaches();
    this.#events.set(event.eventId, structuredClone(event));
    this.#eventInputs.set(event.eventId, { ...physical.input, traceId });
    this.#indexesDirty = true;
    // Delayed consolidation runs only at a real-event learning boundary and
    // only after the minimum repeated-evidence scale can exist.  Queries and
    // predictions never invoke this writer.
    if (this.#eventInputs.size >= 16 && this.#eventInputs.size % 8 === 0) {
      if (this.#consolidationBatchActive) {
        this.#consolidationPending = true;
        this.#deferredConsolidationBoundaryCount++;
      } else {
        this.#consolidateStableConditionDifferences();
      }
    }
    return { version: 'DistributedR2APhysicalObservationReceiptV2',
      status: 'no-qualified-physical-attractor', pattern: null, relationIds: [], depositedFootprint: footprint };
  }

  recordMatchedIntervention(value: DistributedR2AInterventionPairV2): DistributedR2AInterventionAssessmentV2 {
    const actualKeys = Object.keys(value as unknown as Record<string, unknown>).sort();
    const allowedKeys = ['baselineR2EventId', 'interventionR2EventId', 'version'];
    assert(actualKeys.every(key => allowedKeys.includes(key))
      && actualKeys.includes('baselineR2EventId')
      && actualKeys.includes('interventionR2EventId')
      && actualKeys.includes('version'),
    'R2A-intervention-schema-contains-unknown-fields');
    assert(value.version === 'DistributedR2AInterventionPairV2',
      'R2A-intervention-schema-version-invalid');
    const pairId = sha({ version: 'DistributedR2AInterventionPhysicalPairIdentityV2',
      baselineR2EventId: value.baselineR2EventId,
      interventionR2EventId: value.interventionR2EventId });
    const existing = this.#interventions.get(pairId);
    if (existing) return structuredClone(existing);
    return this.recordMatchedInterventions([value])[0]!;
  }

  /**
   * Record several matched interventions using one physical probe batch.
   * Each pair still has its own deterministic 24-seed full/ablated probes and
   * its own immutable assessment; batching only prevents repeatedly restoring
   * the same 32^3 read-only medium and worker set for every pair.  The default
   * single-pair API above deliberately delegates here so the two paths cannot
   * drift semantically.
   */
  recordMatchedInterventions(values: readonly DistributedR2AInterventionPairV2[])
    : readonly DistributedR2AInterventionAssessmentV2[] {
    if (values.length === 0) return [];
    this.#ensurePhysicalIndexes();
    // A pre-intervention checkpoint deliberately contains the physical
    // events and stable terminal patterns but no condition relations yet.
    // Rebuild those read-only, field-derived candidates at the first actual
    // intervention request; otherwise the assessment would search an
    // intentionally empty cache and fail before measuring the intervention.
    if (this.#relations.size === 0 && this.#patterns.size > 0) {
      this.#rebuildPhysicalRelations(this.#restingMedium(), this.#physicalStructure(),
        { deferRollout: true });
      this.#indexesDirty = false;
    }
    const allowedKeys = ['baselineR2EventId', 'interventionR2EventId', 'version'];
    type Prepared = {
      readonly value: DistributedR2AInterventionPairV2;
      readonly pairId: string;
      readonly relation: DistributedR2APhysicalRelationV2;
      readonly factor: DistributedR2APhysicalFactorV2;
      readonly otherObservedChannelsMatched: boolean;
      readonly manipulatedFactorActuallyChanged: boolean;
      readonly interventionReachedRelationBranch: boolean;
      readonly queries: readonly {
        readonly currentConditionSiteIds: DistributedProbePulseInputV1;
        readonly seedPulses: readonly DistributedProbePulseInputV1[];
        readonly targetCore: readonly number[];
        readonly probeCount: number;
        readonly seedOffset: bigint;
      }[];
      readonly queryKeys: readonly string[];
    };
    const normalizeQueryPulse = (pulse: DistributedProbePulseInputV1): readonly DistributedSiteDriveV1[] =>
      pulse.length === 0 ? [] : normalizeDistributedProbePulseV1(pulse);
    const queryKey = (query: Prepared['queries'][number]): string => sha({
      currentConditionSiteIds: normalizeQueryPulse(query.currentConditionSiteIds),
      seedPulses: query.seedPulses.map(value => normalizeQueryPulse(value)),
      targetCore: [...query.targetCore], probeCount: query.probeCount,
      seedOffset: query.seedOffset.toString(),
    });
    const prepared: Prepared[] = [];
    const preparedByPair = new Map<string, Prepared>();
    const existingByPair = new Map<string, DistributedR2AInterventionAssessmentV2>();
    for (const value of values) {
      const actualKeys = Object.keys(value as unknown as Record<string, unknown>).sort();
      assert(actualKeys.every(key => allowedKeys.includes(key))
        && actualKeys.includes('baselineR2EventId') && actualKeys.includes('interventionR2EventId')
        && actualKeys.includes('version'),
      'R2A-intervention-schema-contains-unknown-fields');
      assert(value.version === 'DistributedR2AInterventionPairV2',
        'R2A-intervention-schema-version-invalid');
      const pairId = sha({ version: 'DistributedR2AInterventionPhysicalPairIdentityV2',
        baselineR2EventId: value.baselineR2EventId,
        interventionR2EventId: value.interventionR2EventId });
      const existing = this.#interventions.get(pairId);
      if (existing) { existingByPair.set(pairId, existing); continue; }
      if (preparedByPair.has(pairId)) continue;
      const baseline = this.#eventInputs.get(value.baselineR2EventId);
      const intervention = this.#eventInputs.get(value.interventionR2EventId);
      assert(baseline && intervention && baseline.eventId !== intervention.eventId,
        'R2A-intervention-references-invalid-real-events');
      const baselineBranchId = this.#candidateBranchAssignments.get(
        continuationCandidateForInputV1(baseline).key);
      const interventionBranchId = this.#candidateBranchAssignments.get(
        continuationCandidateForInputV1(intervention).key);
      const baselinePattern = baselineBranchId ? this.#patterns.get(baselineBranchId) : undefined;
      const interventionPattern = interventionBranchId
        ? this.#patterns.get(interventionBranchId) : undefined;
      assert(baselinePattern && interventionPattern
        && distributedR2APhysicalMatchedContrastV1(interventionPattern, baselinePattern),
      'R2A-intervention-pair-is-not-a-physical-matched-contrast');
      const baselineConditions = new Set(baseline.conditionSiteIds);
      const interventionConditions = new Set(intervention.conditionSiteIds);
      const changedSites = new Set([...baselineConditions, ...interventionConditions]
        .filter(siteId => baselineConditions.has(siteId) !== interventionConditions.has(siteId)));
      const candidates = [...this.#relations.values()].flatMap(relation => {
        const pattern = this.#patterns.get(relation.patternId);
        if (!pattern) return [];
        const branchMembership = Number(interventionBranchId === pattern.patternId);
        return relation.factors.map(factor => ({ relation, pattern, factor, branchMembership,
          factorChange: factor.afferentSiteIds.filter(siteId => changedSites.has(siteId)).length
            / Math.max(1, factor.afferentSiteIds.length) }))
          .filter(candidate => candidate.branchMembership >= .5 && candidate.factorChange >= .75);
      }).sort((left, right) => right.branchMembership - left.branchMembership
        || right.factorChange - left.factorChange
        || left.relation.relationId.localeCompare(right.relation.relationId, 'en'));
      assert(candidates.length > 0, 'R2A-intervention-no-field-derived-relation-factor');
      const { relation, pattern, factor } = candidates[0]!;
      const factorSites = new Set(factor.afferentSiteIds);
      const factorChannels = new Set(factor.sourceChannelIds);
      const factorVariableSites = new Set([...this.#conditionBindings.values()]
        .filter(binding => factorChannels.has(distributedPublicSignalChannelIdV1(binding.signalId)))
        .flatMap(binding => binding.siteIds));
      const withoutFactor = (sites: readonly number[]): number[] =>
        sites.filter(siteId => !factorVariableSites.has(siteId));
      const baselineOther = withoutFactor(baseline.conditionSiteIds).sort((left, right) => left - right);
      const interventionOther = withoutFactor(intervention.conditionSiteIds).sort((left, right) => left - right);
      const otherObservedChannelsMatched = baselineOther.length === interventionOther.length
        && baselineOther.every((siteId, index) => siteId === interventionOther[index]);
      const baselineFactor = baseline.conditionSiteIds.some(siteId => factorSites.has(siteId));
      const interventionFactor = intervention.conditionSiteIds.some(siteId => factorSites.has(siteId));
      const patternPrefixDrives = pattern.corridor.orderedPrefixPulseDrives
        ?? weightedPulsesForIdsV1(undefined, pattern.corridor.orderedPrefixPulseSiteIds,
          `R2A-legacy-intervention-prefix-${pattern.patternId}`);
      const patternActionDrives = pattern.corridor.actionPulseDrives
        ?? weightedPulsesForIdsV1(undefined, pattern.corridor.actionPulseSiteIds,
          `R2A-legacy-intervention-action-${pattern.patternId}`);
      const withoutFactorDrives = (drives: readonly DistributedSiteDriveV1[]): DistributedSiteDriveV1[] =>
        drives.filter(drive => !factorVariableSites.has(drive.siteId));
      const physicalPrefix = patternPrefixDrives.map(withoutFactorDrives)
        .filter(pulse => pulse.length > 0);
      const nextActionDrives = patternActionDrives.at(-1) ?? [];
      const nextActionPulse = weightedPulseSiteIdsV1(nextActionDrives);
      assert(nextActionPulse.length > 0, 'R2A-intervention-requires-exact-next-action-population');
      const interventionConditionDrives = intervention.conditionDrives
        ?? unitWeightedPulseV1(intervention.conditionSiteIds,
          `R2A-legacy-intervention-condition-${intervention.eventId}`);
      const ablatedConditionDrives = withoutFactorDrives(interventionConditionDrives);
      const continuation: readonly DistributedProbePulseInputV1[] = [
        ...physicalPrefix, nextActionDrives].filter(pulse => pulse.length > 0);
      const interventionReachedRelationBranch = this.#candidateBranchAssignments.get(
        continuationCandidateForInputV1(intervention).key) === pattern.patternId;
      const queries: Prepared['queries'] = [
        { currentConditionSiteIds: interventionConditionDrives, seedPulses: continuation,
          targetCore: pattern.attractor.coreSiteIds, probeCount: 24,
          seedOffset: 0x696e74657276656en },
        { currentConditionSiteIds: ablatedConditionDrives, seedPulses: continuation,
          targetCore: pattern.attractor.coreSiteIds, probeCount: 24,
          seedOffset: 0x696e74657276656en },
      ];
      const item: Prepared = { value, pairId, relation, factor,
        otherObservedChannelsMatched,
        manipulatedFactorActuallyChanged: baselineFactor !== interventionFactor,
        interventionReachedRelationBranch,
        queries, queryKeys: queries.map(queryKey) };
      prepared.push(item); preparedByPair.set(pairId, item);
    }
    const uniqueQueries: Prepared['queries'][number][] = [];
    const uniqueQueryIndexes = new Map<string, number>();
    for (const item of prepared) for (const [index, query] of item.queries.entries()) {
      const key = item.queryKeys[index]!;
      if (!uniqueQueryIndexes.has(key)) {
        uniqueQueryIndexes.set(key, uniqueQueries.length);
        uniqueQueries.push(query);
      }
    }
    const rates = uniqueQueries.length === 0 ? [] : this.#selectionRates(this.#restingMedium(),
      uniqueQueries);
    const assessmentsByPair = new Map<string, DistributedR2AInterventionAssessmentV2>();
    const relationIds = new Set<string>();
    prepared.forEach(item => {
      const fullFactorSelectionRate = rates[uniqueQueryIndexes.get(item.queryKeys[0]!)!]!;
      const factorAblationSelectionRate = rates[uniqueQueryIndexes.get(item.queryKeys[1]!)!]!;
      const assessment: DistributedR2AInterventionAssessmentV2 = {
        version: 'DistributedR2AInterventionPairV2', pairId: item.pairId,
        relationId: item.relation.relationId, changedFactorId: item.factor.factorId,
        baselineR2EventId: item.value.baselineR2EventId,
        interventionR2EventId: item.value.interventionR2EventId,
        otherObservedChannelsMatched: item.otherObservedChannelsMatched,
        manipulatedFactorActuallyChanged: item.manipulatedFactorActuallyChanged,
        interventionReachedRelationBranch: item.interventionReachedRelationBranch,
        fullFactorSelectionRate, factorAblationSelectionRate,
        factorAblationLoss: Math.max(0, fullFactorSelectionRate - factorAblationSelectionRate) };
      // Re-check immediately before the only mutation.  The canonical real-event
      // pair, not a caller label, is the idempotence boundary.
      const alreadyStored = this.#interventions.get(item.pairId);
      if (alreadyStored) { assessmentsByPair.set(item.pairId, alreadyStored); return; }
      this.#interventions.set(item.pairId, assessment);
      assessmentsByPair.set(item.pairId, assessment);
      relationIds.add(item.relation.relationId);
    });
    for (const relationId of relationIds) this.#refreshInterventionAggregate(relationId);
    this.#invalidateApplicabilityQueryCache();
    return values.map(value => {
      const pairId = sha({ version: 'DistributedR2AInterventionPhysicalPairIdentityV2',
        baselineR2EventId: value.baselineR2EventId,
        interventionR2EventId: value.interventionR2EventId });
      const result = this.#interventions.get(pairId) ?? existingByPair.get(pairId)
        ?? assessmentsByPair.get(pairId);
      assert(result, 'R2A-intervention-batch-result-missing');
      return structuredClone(result);
    });
  }

  compareCurrentFactors(relationId: string,
    currentSignalIds: readonly string[]): DistributedR2APhysicalApplicabilityV2 {
    this.#ensurePhysicalIndexes();
    const cacheKey = distributedR2APhysicalApplicabilityCacheKeyV1(
      this.#physicalQueryRevision, relationId, currentSignalIds);
    const cached = this.#applicabilityQueryCache.get(cacheKey);
    if (cached !== undefined) {
      this.#applicabilityQueryCacheHits++;
      return structuredClone(cached);
    }
    this.#applicabilityQueryCacheMisses++;
    const relation = this.#relations.get(relationId);
    if (!relation) throw new Error('unknown-distributed-R2A-relation');
    const pattern = this.#patterns.get(relation.patternId)!;
    const current = new Set(currentSignalIds);
    const channels = new Set(currentSignalIds.map(distributedPublicSignalChannelIdV1));
    const matchedFactorIds: string[] = [], contradictedFactorIds: string[] = [], unknownFactorIds: string[] = [];
    for (const factor of relation.factors) {
      if (factor.sourceSignalIds.some(signal => current.has(signal))) matchedFactorIds.push(factor.factorId);
      else if (factor.sourceChannelIds.some(channel => channels.has(channel))) contradictedFactorIds.push(factor.factorId);
      else unknownFactorIds.push(factor.factorId);
    }
    const currentSites = unique(currentSignalIds.flatMap(signal => this.#conditionBindings.get(signal)?.siteIds ?? []));
    const currentDrives = unitWeightedPulseV1(currentSites, 'R2A-current-condition');
    const patternPrefixDrives = pattern.corridor.orderedPrefixPulseDrives
      ?? weightedPulsesForIdsV1(undefined, pattern.corridor.orderedPrefixPulseSiteIds,
        `R2A-legacy-current-prefix-${pattern.patternId}`);
    const patternActionDrives = pattern.corridor.actionPulseDrives
      ?? weightedPulsesForIdsV1(undefined, pattern.corridor.actionPulseSiteIds,
        `R2A-legacy-current-action-${pattern.patternId}`);
    const physicalBranchSelectionRate = currentSites.length > 0
      && pattern.corridor.orderedPrefixPulseSiteIds.length > 0
      && (pattern.corridor.actionPulseSiteIds.at(-1)?.length ?? 0) > 0
      ? this.#selectionRate(this.#restingMedium(), currentDrives,
        [...patternPrefixDrives, patternActionDrives.at(-1)!],
        pattern.attractor.coreSiteIds, 24,
        BigInt((pattern.attractor.coreSiteIds[0] ?? 0) + 1) ^ 0x5233434f4d504152n)
      : 0;
    const minimum = this.#restingQuerySubstrate().snapshot.config.minimumActiveMagnitude;
    const branch = this.physicalBranches().find(value => value.branchId === pattern.patternId);
    const physicalSupportActive = branch !== undefined && branch.terminalUnderCurrentChannels
      && relation.physicalTraceIds.some(traceId => this.medium.isFootprintActive(traceId))
      && relation.factors.every(factor => factor.coreSiteIds.some(siteId => {
        const site = this.medium.site(siteId);
        return site.potentialDepth >= minimum && site.supportMass >= minimum;
      }));
    // Decoder matches are audit information only.  The R3 physical rollout,
    // not string equality, determines applicability.
    const applicability = physicalSupportActive ? physicalBranchSelectionRate : 0;
    const result: DistributedR2APhysicalApplicabilityV2 = { version: 'DistributedR2APhysicalApplicabilityV2', relationId,
      matchedFactorIds, contradictedFactorIds, unknownFactorIds, applicability,
      evidenceGrade: relation.grade,
      predictionEligible: applicability >= .5 && evidenceRank(relation.grade) >= evidenceRank('predictive-stable'),
      highConfidenceActionEligible: applicability >= .75 && relation.grade === 'intervention-supported',
      physicalSupportActive, physicalBranchSelectionRate };
    this.#applicabilityQueryCache.set(cacheKey, structuredClone(result));
    return structuredClone(result);
  }

  /**
   * Re-run sparse hypothetical terminal signals through the learned R2A
   * condition field. Decoder equality alone is insufficient: the matching
   * factor becomes known only if the corresponding physical branch is also
   * selected at the production threshold.  A decoded opposite value is kept
   * unknown here unless an alternative physical basin explicitly establishes
   * it; semantic negation is not a physical readout.
   */
  projectTransientFactors(relationIds: readonly string[], predictedSignalIds: readonly string[],
    expectedFactorIds: readonly string[] = []): DistributedR2ATransientFactorProjectionV2 {
    this.#ensurePhysicalIndexes();
    const ids = [...new Set(relationIds)].sort((left, right) => left.localeCompare(right, 'en'));
    const relations = ids.flatMap(id => {
      const relation = this.#relations.get(id);
      return relation ? [relation] : [];
    });
    const universe = [...new Set([...expectedFactorIds, ...relations.flatMap(relation =>
      relation.factors.map(factor => factor.factorId))])].sort((left, right) => left.localeCompare(right, 'en'));
    const active = new Set<string>();
    const selectedRelations: string[] = [];
    for (const relation of relations) {
      const comparison = this.compareCurrentFactors(relation.relationId, predictedSignalIds);
      if (!comparison.physicalSupportActive || comparison.physicalBranchSelectionRate < .75) continue;
      selectedRelations.push(relation.relationId);
      comparison.matchedFactorIds.forEach(factorId => active.add(factorId));
    }
    const knownActiveFactorIds = universe.filter(factorId => active.has(factorId));
    return { version: 'DistributedR2ATransientFactorProjectionV2', relationIds: relations
      .map(relation => relation.relationId), knownActiveFactorIds,
      // A missing or contrasting value is not enough to establish a physical
      // inactive basin. Keep it unknown rather than manufacture negation.
      knownInactiveFactorIds: [],
      unknownFactorIds: universe.filter(factorId => !active.has(factorId)),
      physicallySelectedRelationIds: selectedRelations.sort((left, right) => left.localeCompare(right, 'en')) };
  }

  /**
   * Read-only continuation rollout.  Current R3 perception, the actual open
   * R2 prefix and the candidate action population enter as three distinct
   * physical inputs; no member event or terminal template is copied in.
   */
  predictPhysicalContinuation(patternId: string, currentSignalIds: readonly string[],
    sourceR2PrefixSiteIds: readonly number[] | readonly DistributedSiteDriveV1[], observedAtomCount: number,
    exactActionIdentity: string,
    seeds: readonly bigint[]): { readonly snapshot: DistributedMediumSnapshotV1;
      readonly results: readonly DistributedPredictionCloneResultV2[] } {
    this.#ensurePhysicalIndexes();
    const pattern = this.#patterns.get(patternId);
    if (!pattern) throw new Error('unknown-distributed-R2A-pattern');
    const currentPerceptionSeedSiteIds = unique(currentSignalIds
      .flatMap(signal => this.#conditionBindings.get(signal)?.siteIds ?? []));
    // Afferent bindings currently expose membership only; represent that
    // already-established input as unit drives.  Projected R2 prefixes,
    // however, carry measured fibre amplitudes and must remain weighted all
    // the way into the Clone request.
    const currentPerceptionSeedDrives = unitWeightedPulseV1(
      currentPerceptionSeedSiteIds, 'R2A-prediction-current-perception');
    const sourcePrefixDrives = typeof sourceR2PrefixSiteIds[0] === 'number'
      ? unitWeightedPulseV1(sourceR2PrefixSiteIds as readonly number[],
        'R2A-prediction-prefix')
      : normalizeDistributedWeightedPulseV1(
        sourceR2PrefixSiteIds as readonly DistributedSiteDriveV1[],
        'R2A-prediction-prefix');
    const mappedPrefixDrives = this.#projection.lookupPulse(sourcePrefixDrives);
    const mappedPrefix = unique(mappedPrefixDrives.map(value => value.siteId));
    const expectedNextIdentities = pattern.memberR2EventIds.flatMap(eventId => {
      const event = this.#events.get(eventId);
      const identity = event?.orderedExperienceIdentities[observedAtomCount];
      return identity === undefined ? [] : [identity];
    });
    const exactActionPhysicallyBelongsToContinuation = expectedNextIdentities.length > 0
      && expectedNextIdentities.every(identity => identity === exactActionIdentity);
    const actionSeedSiteIds = exactActionPhysicallyBelongsToContinuation
      ? [...(this.#actionBindings.get(exactActionIdentity)?.siteIds ?? [])] : [];
    const actionSeedDrives = unitWeightedPulseV1(actionSeedSiteIds,
      'R2A-prediction-action');
    const snapshot = this.medium.snapshot();
    const clone = new DistributedPredictionCloneV2(snapshot);
    const branchById = new Map(this.physicalBranches().map(value => [value.branchId, value]));
    const readoutAssemblies = [...this.#patterns.values()].map(value => ({
      assemblyId: value.patternId, siteIds: value.attractor.coreSiteIds,
      enclosingDomainSiteIds: branchById.get(value.patternId)?.topologicalEnvelopeSiteIds
        ?? value.attractor.coreSiteIds,
      referenceActivations: (branchById.get(value.patternId)?.attractor.terminalActivations ?? [])
        .filter(activation => (branchById.get(value.patternId)?.topologicalEnvelopeSiteIds
          ?? value.attractor.coreSiteIds).includes(activation.siteId)),
      minimumResidenceScore: .5,
      minimumCoverage: .75,
      minimumPurity: .75,
    })).filter(value => value.siteIds.length > 0);
    const results = seeds.map(seed => clone.run({ currentPerceptionSeedSiteIds,
      currentPerceptionSeedDrives,
      currentPerceptionMode: 'held-boundary',
      realPrefixSeedSiteIds: mappedPrefix.length ? [mappedPrefix] : [],
      realPrefixSeedDrives: mappedPrefixDrives.length ? [mappedPrefixDrives] : [],
      actionSeedSiteIds, actionSeedDrives,
      readoutAssemblies, seed, steps: PROBE_STEPS }));
    return { snapshot, results };
  }

  /**
   * Anonymous assembly readout.  Complete real terminal populations may
   * nominate measurement masks because a pairwise site/bond field cannot, in
   * general, reconstruct every nested high-order assembly from topology alone.
   * The ids, event labels and public decoders never enter the field dynamics;
   * perturbation of the physical medium determines the surviving dynamic core.
  */
  physicalBranches(structure = this.#physicalStructure()): readonly DistributedR2AAnonymousPhysicalBranchV2[] {
    const substrate = this.#restingQuerySubstrate();
    const restingSnapshot = substrate.snapshot;
    const continuationGroups = new Map<string, ContinuationCandidateV1[]>();
    const addContinuation = (candidate: ContinuationCandidateV1): void => {
      const group = continuationGroups.get(candidate.key) ?? [];
      group.push(structuredClone(candidate));
      continuationGroups.set(candidate.key, group);
    };
    // Discover only from a condition/prefix/action continuation that a real
    // event actually traversed.  An observed terminal population is not a
    // valid probe seed: injecting it would make the answer inevitable.
    [...this.#eventInputs.values()]
      .filter(value => this.#r2Active(value.eventId) && this.medium.isFootprintActive(value.traceId))
      .forEach(value => addContinuation(continuationCandidateForInputV1(value)));
    // During physical rediscovery the derived event table may be absent.  An
    // immutable footprint can recover a pre-terminal route, but a singleton
    // footprint cannot establish a reachable branch.
    if (continuationGroups.size === 0) {
      for (const footprint of restingSnapshot.footprints) {
        const candidate = continuationCandidateForFootprintV1(footprint);
        if (candidate) addContinuation(candidate);
      }
    }
    const resting = substrate.medium;
    const candidates: ContinuationCandidateV1[] = [];
    const candidateGroups = [...continuationGroups].sort(([left], [right]) =>
      left.localeCompare(right, 'en'));
    for (const [key, group] of candidateGroups) {
      const byTerminal = new Map<string, ContinuationCandidateV1[]>();
      for (const candidate of group) {
        const terminal = normalizeDistributedWeightedPulseV1(
          candidate.terminalDrives ?? unitWeightedPulseV1(candidate.terminalSites,
            'continuation-terminal-group'), 'continuation-terminal-group');
        const signature = JSON.stringify(terminal);
        const values = byTerminal.get(signature) ?? [];
        values.push({ ...candidate, terminalSites: terminal.map(value => value.siteId),
          terminalDrives: terminal });
        byTerminal.set(signature, values);
      }
      const terminalGroups = [...byTerminal.values()];
      if (terminalGroups.length <= 1) {
        const members = terminalGroups[0] ?? [];
        const first = members[0];
        if (first) candidates.push({ ...first,
          sourceEventIds: uniqueStrings(members.flatMap(value => value.sourceEventIds)) });
        continue;
      }
      // A single condition/prefix/action may legitimately have a rare
      // physically different outcome.  Do not merge all terminal populations
      // into an ambiguous answer-shaped seed.  Measure each observed terminal
      // population, retain only a deterministic dominant physical cohort, and
      // leave the minority members on the same input key so the index builder
      // can count them as contradictions.  Ties stay unresolved.
      const representatives = terminalGroups.map(values => values[0]!);
      const measured = representatives.map(candidate => this.#aggregateAttractor(
        resting, candidate.terminalSites,
        BigInt(`0x${sha({ version: 'R2A-terminal-cohort-readout-v1',
          terminalDrives: candidate.terminalDrives }).slice(0, 16)}`),
        candidate.terminalDrives));
      const weights = measured.map((readout, index) => ({ index, readout,
        weight: terminalGroups[index]!.reduce((sum, value) => sum + Math.min(1, Math.max(0,
          value.sourceEventIds.reduce((eventSum, eventId) => {
            const eventInput = this.#eventInputs.get(eventId);
            const traceId = eventInput?.traceId ?? eventId;
            return eventSum + (this.medium.footprint(traceId)?.supportMass ?? 0);
          }, 0))), 0) }));
      const valid = weights.filter(value => validPhysicalAttractorV1(value.readout));
      valid.sort((left, right) => right.weight - left.weight
        || left.index - right.index);
      const winner = valid[0];
      const runner = valid[1];
      if (!winner || (runner && Math.abs(winner.weight - runner.weight) <= 1e-12)) {
        // Equal physically resolved cohorts are a real ambiguity, not a reason
        // to choose by insertion order or terminal site id.
        continue;
      }
      const winningMembers = terminalGroups[winner.index]!;
      const first = winningMembers[0]!;
      candidates.push({ ...first,
        sourceEventIds: uniqueStrings(winningMembers.flatMap(value => value.sourceEventIds)) });
    }
    const orderedCandidates = candidates
      .sort((left, right) => left.key.localeCompare(right.key, 'en'));
    const cacheKey = sha({ version: 'DistributedR2APhysicalBranchReadoutCacheV5',
      algorithmIdentity: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7,
      // The immutable substrate digest already identifies every site, bond,
      // footprint and snapshot parameter.  Hashing the full object again
      // here transiently serialises hundreds of megabytes and creates a
      // second large string without changing cache identity.
      mediumSha256: substrate.mediumSha256, continuations: orderedCandidates });
    const cached = physicalBranchReadoutCache.get(cacheKey);
    if (cached) {
      this.#candidateBranchAssignments.clear();
      cached.candidateAssignments.forEach(([candidate, branchId]) =>
        this.#candidateBranchAssignments.set(candidate, branchId));
      return structuredClone(cached.branches);
    }
    // Build the anonymous branch index from terminal populations that were
    // actually observed in completed real events.  This calibration is the
    // delayed learning step that gives a distributed result a physical
    // readout identity.  It is intentionally separate from the live query
    // below: #aggregateContinuationAttractors remains terminal-free and is
    // the only path used to test whether a current route reaches a branch.
    const measurements = this.#aggregateObservedTerminalAttractors(resting, orderedCandidates);
    const byCore = new Map<string, DistributedR2AAnonymousPhysicalBranchV2>();
    const candidateAssignments: Array<readonly [string, string]> = [];
    orderedCandidates.forEach((candidate, index) => {
        const measured = measurements[index]!;
        const attractor: DistributedAttractorReadoutV1 = { ...measured,
          coreSiteIds: [...measured.coreSiteIds] };
        if (attractor.evidenceLevel === 'none' || attractor.ambiguous
          || attractor.coreSiteIds.length === 0) return;
        // The envelope is derived from the measured continuation core and the
        // local basins it actually occupies; historical terminal populations
        // never widen or seed this readout.
        const occupiedBasins = structure.basins.filter(basin =>
          distributedObservedPopulationCoversLocalAssemblyV1(
            basin.coreSiteIds, attractor.coreSiteIds) >= .5);
        const envelopeSiteIds = unique([...attractor.coreSiteIds,
          ...occupiedBasins.flatMap(value => value.coreSiteIds)]);
        const value: DistributedR2AAnonymousPhysicalBranchV2 = {
          version: 'DistributedR2AAnonymousPhysicalBranchV2' as const,
          branchId: anonymousPhysicalBranchIdentityV3(attractor), attractor,
          ...(attractor.coactivationAssemblyId === undefined ? {} : {
            coactivationAssemblyId: attractor.coactivationAssemblyId,
          }),
          ...(attractor.coactivationCoverage === undefined ? {} : {
            coactivationCoverage: attractor.coactivationCoverage,
          }),
          ...(attractor.coactivationResonance === undefined ? {} : {
            coactivationResonance: attractor.coactivationResonance,
          }),
          topologicalEnvelopeSiteIds: envelopeSiteIds,
          incomingConductance: occupiedBasins.reduce((sum, value) =>
            sum + value.incomingConductance, 0),
          outgoingConductance: occupiedBasins.reduce((sum, value) =>
            sum + value.outgoingConductance, 0),
          // This flag describes the calibrated anonymous basin, not whether
          // the calibration probe transported mass (the terminal population
          // is intentionally seeded for this learning-time measurement).
          // Requiring directed transport here would make a real branch whose
          // terminal pulse has no outgoing edge disappear from the index;
          // transport is checked only on a live continuation query.
          terminalUnderCurrentChannels: attractor.dwellSteps >= TERMINAL_DWELL_MIN_STEPS
            && attractor.escapeRate <= .25
            };
        // Keep separate assembly populations even when their local dynamic
        // cores coincide.  The assembly id is anonymous physical evidence;
        // coverage/resonance are deliberately not part of this dedup key.
        const coreKey = JSON.stringify({ coreSiteIds: attractor.coreSiteIds,
          coactivationAssemblyId: attractor.coactivationAssemblyId ?? null });
        candidateAssignments.push([candidate.key, value.branchId]);
        const existing = byCore.get(coreKey);
        if (!existing || evidenceRank(value.attractor.evidenceLevel)
          > evidenceRank(existing.attractor.evidenceLevel)
          || (evidenceRank(value.attractor.evidenceLevel)
            === evidenceRank(existing.attractor.evidenceLevel)
            && (value.coactivationCoverage ?? 0) > (existing.coactivationCoverage ?? 0)))
          byCore.set(coreKey, value);
      });
    const result = [...byCore.values()]
      .sort((left, right) => left.branchId.localeCompare(right.branchId, 'en'));
    this.#candidateBranchAssignments.clear();
    candidateAssignments.forEach(([candidate, branchId]) =>
      this.#candidateBranchAssignments.set(candidate, branchId));
    physicalBranchReadoutCache.set(cacheKey, structuredClone({ branches: result,
      candidateAssignments }));
    while (physicalBranchReadoutCache.size > PHYSICAL_BRANCH_CACHE_LIMIT)
      physicalBranchReadoutCache.delete(physicalBranchReadoutCache.keys().next().value!);
    return structuredClone(result);
  }

  /**
   * Run current R3, the real open prefix and the exact candidate action through
   * the physical field.  A branch counts only when the final, non-ambiguous
   * attractor is resident in that anonymous basin; merely passing through a
   * readout site never counts as a selection.
   */
  probePhysicalBranches(input: DistributedR2APhysicalBranchProbeInputV2):
  readonly DistributedR2APhysicalBranchProbeResultV2[] {
    const normalize = (values: readonly number[], label: string): number[] => {
      const result = unique(values);
      assert(result.length === values.length, `${label}-contains-duplicate-site`);
      result.forEach(siteId => this.medium.site(siteId));
      return result;
    };
    const current = normalize(input.currentConditionSiteIds, 'R2A-current-condition');
    const currentDrives = input.currentConditionDrives === undefined
      ? unitWeightedPulseV1(current, 'R2A-current-condition')
      : weightedPulseForIdsV1(input.currentConditionDrives, current,
        'R2A-current-condition');
    assert(input.realPrefixPulseDrives === undefined
      || input.realPrefixPulseDrives.length === input.realPrefixPulseSiteIds.length,
    'R2A-real-prefix-weighted-pulse-count-mismatch');
    const prefixes = input.realPrefixPulseSiteIds.map((pulse, index) =>
      normalize(pulse, `R2A-real-prefix-${index}`));
    const prefixDrives = prefixes.map((pulse, index) =>
      weightedPulseForIdsV1(input.realPrefixPulseDrives?.[index], pulse,
        `R2A-real-prefix-${index}`));
    const action = normalize(input.actionSiteIds, 'R2A-action');
    const actionDrives = input.actionDrives === undefined
      ? unitWeightedPulseV1(action, 'R2A-action')
      : weightedPulseForIdsV1(input.actionDrives, action, 'R2A-action');
    assert(prefixes.length > 0 && prefixes.every(value => value.length > 0)
      && action.length > 0, 'R2A-physical-probe-requires-real-prefix-and-action');
    const branches = this.physicalBranches();
    if (branches.length === 0) return [];
    const medium = this.#restingMedium();
    const hits = new Map(branches.map(value => [value.branchId, 0]));
    let validSampleCount = 0;
    const pulses: readonly DistributedProbePulseInputV1[] = [...prefixDrives, actionDrives];
    const readouts = runDistributedMediumProbeBatchSyncV1(this.#readOnlyProbeSnapshot(medium),
      Array.from({ length: 24 }, (_unused, index) => current.length > 0
        ? { index, kind: 'conditioned-sequential' as const, conditionSiteIds: currentDrives,
          seedPulses: pulses,
          seed: this.#seed ^ 0x4252414e43485052n ^ BigInt(index + 1), steps: PROBE_STEPS }
        : { index, kind: 'sequential' as const, seedPulses: pulses,
          seed: this.#seed ^ 0x4252414e43485052n ^ BigInt(index + 1), steps: PROBE_STEPS }),
      R2A_QUERY_PARALLELISM_V1,
      { compactReadout: true, compactSiteIds: unique(branches.flatMap(value =>
        value.topologicalEnvelopeSiteIds)) });
    for (const readout of readouts) {
      if (readout.evidenceLevel === 'none' || readout.ambiguous
        || (readout.run.directedTransportMass ?? 0) <= 0
        || readout.dwellSteps < TERMINAL_DWELL_MIN_STEPS || readout.escapeRate > .25
        || readout.coreSiteIds.length === 0) continue;
      const scored = this.#scoreReadoutAgainstBranches(readout, branches);
      if (scored[0]!.score < .5 || scored[0]!.score - (scored[1]?.score ?? 0) < .1) continue;
      hits.set(scored[0]!.branchId, hits.get(scored[0]!.branchId)! + 1);
      validSampleCount++;
    }
    const rates = branches.map(branch => ({ branch,
      rate: (hits.get(branch.branchId) ?? 0) / 24 }))
      .sort((left, right) => right.rate - left.rate
        || left.branch.branchId.localeCompare(right.branch.branchId, 'en'));
    const ambiguous = validSampleCount < 8
      || (rates[0]?.rate ?? 0) - (rates[1]?.rate ?? 0) < .1;
    return rates.map(value => ({ version: 'DistributedR2APhysicalBranchProbeResultV2',
      branchId: value.branch.branchId, selectionRate: value.rate, validSampleCount, ambiguous }));
  }

  patterns(): readonly DistributedR2APhysicalPatternV2[] {
    this.#ensurePhysicalIndexes();
    return [...this.#patterns.values()].sort((left, right) => left.patternId.localeCompare(right.patternId, 'en'))
      .map(value => structuredClone(value));
  }

  /**
   * Receipt/dashboard readout of the last explicitly consolidated physical
   * index.  It deliberately does not discover structure: a status counter must
   * never turn every trusted event write into a whole-medium scan.
   */
  indexedStablePatternCount(): number {
    return [...this.#patterns.values()].filter(value => value.grade !== 'single-observation').length;
  }

  relations(): readonly DistributedR2APhysicalRelationV2[] {
    this.#ensurePhysicalIndexes();
    return [...this.#relations.values()].sort((left, right) => left.relationId.localeCompare(right.relationId, 'en'))
      .map(value => structuredClone(value));
  }

  interventions(): readonly DistributedR2AInterventionAssessmentV2[] {
    return [...this.#interventions.values()].sort((left, right) => left.pairId.localeCompare(right.pairId, 'en'))
      .map(value => structuredClone(value));
  }

  recover(elapsed: number): void {
    this.medium.recover(elapsed);
    this.#invalidatePhysicalQueryCaches();
    this.#indexesDirty = true;
  }

  snapshot(): DistributedR2APhysicalStateV3 {
    assert(!this.#consolidationBatchActive,
      'R2A-cannot-snapshot-with-consolidation-batch-open');
    this.#ensurePhysicalIndexes();
    const patterns = this.patterns(), relations = this.relations(), interventions = this.interventions();
    const physicalIndexIdentity = {
      version: 'DistributedR2APhysicalIndexIdentityV1' as const,
       algorithmIdentity: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7,
      physicalIndexInputsSha256: this.#physicalIndexInputsSha256(interventions),
      physicalIndexStateSha256: this.#physicalIndexStateSha256(patterns, relations, interventions),
    };
    return { version: 'DistributedR2APhysicalStateV3', seedHex: `0x${this.#seed.toString(16)}`,
      conditionAllocationSequence: this.#afferentAllocationSequence,
      projection: this.#projection.snapshot(),
      conditionBindings: [...this.#conditionBindings.values()].sort((left, right) =>
        left.signalId.localeCompare(right.signalId, 'en')).map(cloneBinding),
      actionBindings: [...this.#actionBindings.values()].sort((left, right) =>
        left.signalId.localeCompare(right.signalId, 'en')).map(cloneBinding),
      patterns, relations, interventions,
      eventInputs: [...this.#eventInputs.values()].sort((left, right) =>
        left.eventId.localeCompare(right.eventId, 'en')).map(value => structuredClone(value)),
      evidenceEvents: [...this.#events.values()].sort((left, right) =>
        left.eventId.localeCompare(right.eventId, 'en')).map(value => structuredClone(value)),
      physicalIndexIdentity, medium: this.medium.snapshot() };
  }
}
