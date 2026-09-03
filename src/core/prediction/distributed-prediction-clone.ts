import type {
  DistributedAttractorReadoutV1,
  DistributedFieldRunV1,
  DistributedMediumSnapshotV1,
  SparseFieldDriveV1,
} from "../physics/distributed-physical-contracts.js";
import { DistributedPhysicalMedium3DV1 } from "../physics/distributed-physical-medium.js";

export interface DistributedReadoutAssemblyV1 {
  readonly assemblyId: string;
  readonly siteIds: readonly number[];
  /** Local physical domain against which activation leakage is measured. */
  readonly enclosingDomainSiteIds?: readonly number[];
  /** Read-only terminal residence profile measured from the physical field.
   * It is a passive decoder mask and never enters the rollout seed. */
  readonly referenceActivations?: readonly {
    readonly siteId: number;
    readonly meanActivation: number;
  }[];
  readonly minimumResidenceScore?: number;
  readonly minimumCoverage?: number;
  readonly minimumPurity?: number;
}

export interface DistributedPredictionCloneRequestV2 {
  /** Current, real public perception resolved through existing afferent bindings. */
  readonly currentPerceptionSeedSiteIds: readonly number[];
  /**
   * Exact current perception amplitudes.  The site-id view remains required as
   * a stable audit membership; when this weighted view is present the clone
   * carries the measured fibre strengths instead of rebuilding unit drives.
   */
  readonly currentPerceptionSeedDrives?: readonly SparseFieldDriveV1[];
  /**
   * R1 experiences perceive a state once before the action.  R3 condition
   * fields, by contrast, remain present while an R2A continuation unfolds.
   * Making this distinction explicit prevents a held R1 prefix from exciting
   * every historically available action channel at once.
   */
  readonly currentPerceptionMode: 'sequential-prefix' | 'held-boundary';
  /** Ordered real prefix populations; these are not a selected historical template. */
  readonly realPrefixSeedSiteIds: readonly (readonly number[])[];
  /** Weighted counterpart of the ordered prefix populations. */
  readonly realPrefixSeedDrives?: readonly (readonly SparseFieldDriveV1[])[];
  /** Exact candidate action resolved through its already learned cue binding. */
  readonly actionSeedSiteIds: readonly number[];
  /** Exact candidate action amplitudes, when supplied by the physical caller. */
  readonly actionSeedDrives?: readonly SparseFieldDriveV1[];
  readonly readoutAssemblies: readonly DistributedReadoutAssemblyV1[];
  readonly seed: bigint;
  readonly steps?: number;
}

export type DistributedPredictionCloneReasonV2 =
  | "reached-readout-assembly"
  | "trajectory-did-not-reach-readout-assembly"
  | "multiple-readout-assemblies-indistinguishable"
  | "missing-currentPerceptionSeedSiteIds"
  | "missing-realPrefixSeedSiteIds"
  | "missing-actionSeedSiteIds"
  | "sequential-prefix-current-perception-mismatch"
  | "insufficient-sequential-seed-steps";

export interface DistributedPredictionAssemblyReachV1 {
  readonly assemblyId: string;
  /** Compatibility name: this is the measured terminal assembly coverage. */
  readonly reachedFraction: number;
  readonly purity: number;
  readonly residenceScore: number;
  readonly visitedSiteIds: readonly number[];
}

export interface DistributedPredictionCloneResultV2 {
  readonly version: "DistributedPredictionCloneResultV2";
  readonly status: "reached" | "unknown" | "ambiguous";
  readonly reason: DistributedPredictionCloneReasonV2;
  readonly reachedAssemblyIds: readonly string[];
  readonly reaches: readonly DistributedPredictionAssemblyReachV1[];
  readonly fieldRun: DistributedFieldRunV1;
  readonly attractorReadout: DistributedAttractorReadoutV1;
}

export interface DistributedPhysicalResidenceMatchV1 {
  readonly coverage: number;
  readonly purity: number;
  readonly score: number;
  readonly matchedSiteIds: readonly number[];
}

export interface DistributedPhysicalActivationResidenceMatchV1 {
  readonly domainMassFraction: number;
  readonly profileOverlap: number;
  readonly score: number;
}

/**
 * Symmetric physical population match.  A strict subset cannot impersonate
 * its enclosing assembly: coverage asks whether the candidate was completed,
 * while purity asks whether the actual terminal field contains only that
 * candidate.  The ids are anonymous lattice sites; no result label enters the
 * calculation.
 */
export function physicalResidenceMatchV1(actualSiteIds: readonly number[],
  candidateSiteIds: readonly number[]): DistributedPhysicalResidenceMatchV1 {
  const actual = [...new Set(actualSiteIds)].sort((left, right) => left - right);
  const candidate = [...new Set(candidateSiteIds)].sort((left, right) => left - right);
  if (actual.length === 0 || candidate.length === 0)
    return { coverage: 0, purity: 0, score: 0, matchedSiteIds: [] };
  const candidateSet = new Set(candidate);
  const matchedSiteIds = actual.filter(siteId => candidateSet.has(siteId));
  const coverage = matchedSiteIds.length / candidate.length;
  const purity = matchedSiteIds.length / actual.length;
  return { coverage, purity, score: Math.min(coverage, purity), matchedSiteIds };
}

/** Compare two measured terminal activation distributions.  The first term
 * asks how much of the actual terminal activation resides in this local
 * physical domain.  The second is the normalized overlap of the activation
 * shape inside that domain.  Their geometric mean requires both; neither an
 * incidental weak residue nor a correctly shaped but globally inactive basin
 * can win alone. */
export function physicalActivationResidenceMatchV1(
  actualActivations: readonly { readonly siteId: number; readonly meanActivation: number }[],
  referenceActivations: readonly { readonly siteId: number; readonly meanActivation: number }[],
  enclosingDomainSiteIds: readonly number[],
  readoutUniverseSiteIds: readonly number[],
): DistributedPhysicalActivationResidenceMatchV1 {
  const domain = new Set(enclosingDomainSiteIds);
  const universe = new Set(readoutUniverseSiteIds);
  const actual = new Map(actualActivations.filter(value => domain.has(value.siteId))
    .map(value => [value.siteId, Math.max(0, value.meanActivation)]));
  const reference = new Map(referenceActivations.filter(value => domain.has(value.siteId))
    .map(value => [value.siteId, Math.max(0, value.meanActivation)]));
  const actualDomainMass = [...actual.values()].reduce((sum, value) => sum + value, 0);
  const referenceMass = [...reference.values()].reduce((sum, value) => sum + value, 0);
  const actualUniverseMass = actualActivations.filter(value => universe.has(value.siteId))
    .reduce((sum, value) => sum + Math.max(0, value.meanActivation), 0);
  if (!(actualDomainMass > 0) || !(referenceMass > 0) || !(actualUniverseMass > 0))
    return { domainMassFraction: 0, profileOverlap: 0, score: 0 };
  const profileOverlap = [...new Set([...actual.keys(), ...reference.keys()])]
    .reduce((sum, siteId) => sum + Math.min((actual.get(siteId) ?? 0) / actualDomainMass,
      (reference.get(siteId) ?? 0) / referenceMass), 0);
  const domainMassFraction = Math.min(1, actualDomainMass / actualUniverseMass);
  return { domainMassFraction, profileOverlap,
    score: Math.sqrt(domainMassFraction * profileOverlap) };
}

function validateAssembly(
  assembly: DistributedReadoutAssemblyV1,
  siteCount: number,
  defaultDomainSiteIds: readonly number[],
): { assemblyId: string; siteIds: readonly number[]; enclosingDomainSiteIds: readonly number[];
  referenceActivations: readonly { readonly siteId: number; readonly meanActivation: number }[];
  minimumResidenceScore: number; minimumCoverage: number; minimumPurity: number } {
  if (assembly.assemblyId.length === 0) throw new RangeError("readout assembly id must be non-empty");
  const siteIds = [...new Set(assembly.siteIds)].sort((left, right) => left - right);
  if (siteIds.length === 0 || siteIds.length !== assembly.siteIds.length) {
    throw new Error("readout assembly sites must be non-empty and unique");
  }
  for (const siteId of siteIds) {
    if (!Number.isInteger(siteId) || siteId < 0 || siteId >= siteCount) {
      throw new RangeError(`readout assembly contains unknown site: ${siteId}`);
    }
  }
  const enclosingDomainSiteIds = [...new Set(assembly.enclosingDomainSiteIds
    ?? defaultDomainSiteIds)].sort((left, right) => left - right);
  if (enclosingDomainSiteIds.length === 0) throw new Error('readout assembly domain must be non-empty');
  for (const siteId of enclosingDomainSiteIds) {
    if (!Number.isInteger(siteId) || siteId < 0 || siteId >= siteCount)
      throw new RangeError(`readout assembly domain contains unknown site: ${siteId}`);
  }
  const domain = new Set(enclosingDomainSiteIds);
  if (siteIds.some(siteId => !domain.has(siteId)))
    throw new Error('readout assembly lies outside its enclosing domain');
  const minimumCoverage = assembly.minimumCoverage ?? .75;
  const minimumPurity = assembly.minimumPurity ?? .75;
  const minimumResidenceScore = assembly.minimumResidenceScore ?? .5;
  for (const [name, value] of [['minimumCoverage', minimumCoverage],
    ['minimumPurity', minimumPurity]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1)
      throw new RangeError(`${name} must be in (0,1]`);
  }
  if (!Number.isFinite(minimumResidenceScore) || minimumResidenceScore <= 0
    || minimumResidenceScore > 1) throw new RangeError('minimumResidenceScore must be in (0,1]');
  const referenceActivations = [...(assembly.referenceActivations ?? [])]
    .sort((left, right) => left.siteId - right.siteId);
  const referenceSites = new Set<number>();
  for (const value of referenceActivations) {
    if (!Number.isInteger(value.siteId) || value.siteId < 0 || value.siteId >= siteCount
      || !Number.isFinite(value.meanActivation) || value.meanActivation < 0)
      throw new Error('readout assembly reference activation is invalid');
    if (!domain.has(value.siteId) || referenceSites.has(value.siteId))
      throw new Error('readout assembly reference activation lies outside its domain or is duplicated');
    referenceSites.add(value.siteId);
  }
  return { assemblyId: assembly.assemblyId, siteIds, enclosingDomainSiteIds,
    referenceActivations, minimumResidenceScore, minimumCoverage, minimumPurity };
}

function emptyUnknown(reason: DistributedPredictionCloneReasonV2): DistributedPredictionCloneResultV2 {
  const fieldRun: DistributedFieldRunV1 = { version: "DistributedFieldRunV1", steps: 0,
    acceptedSteps: 0, rejectedSteps: 0, leaderSiteIds: [], finalActivations: [] };
  return { version: "DistributedPredictionCloneResultV2", status: "unknown", reason,
    reachedAssemblyIds: [], reaches: [], fieldRun,
    attractorReadout: { version: "DistributedAttractorReadoutV1", coreSiteIds: [], dwellSteps: 0,
      returnRate: 0, escapeRate: 1, evidenceLevel: "none", ambiguous: false, run: fieldRun } };
}

function validateSeedPopulation(value: unknown, field: string, siteCount: number): readonly number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sites = [...new Set(value as number[])].sort((left, right) => left - right);
  if (sites.length !== value.length) throw new Error(`${field} must contain unique sites`);
  for (const siteId of sites) {
    if (!Number.isInteger(siteId) || siteId < 0 || siteId >= siteCount)
      throw new RangeError(`${field} contains unknown site: ${siteId}`);
  }
  return sites;
}

function validateSeedDrives(value: unknown, field: string,
  siteCount: number): readonly SparseFieldDriveV1[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const bySite = new Map<number, number>();
  for (const item of value as readonly unknown[]) {
    if (item === null || typeof item !== "object")
      throw new Error(`${field} must contain weighted drives`);
    const drive = item as { readonly siteId?: unknown; readonly intensity?: unknown };
    if (!Number.isSafeInteger(drive.siteId) || (drive.siteId as number) < 0
      || (drive.siteId as number) >= siteCount || !Number.isFinite(drive.intensity)
      || (drive.intensity as number) <= 0 || (drive.intensity as number) > 1) {
      throw new RangeError(`${field} contains invalid weighted drive`);
    }
    const siteId = drive.siteId as number, intensity = drive.intensity as number;
    bySite.set(siteId, Math.max(bySite.get(siteId) ?? 0, intensity));
  }
  return [...bySite].sort(([left], [right]) => left - right)
    .map(([siteId, intensity]) => ({ siteId, intensity }));
}

function drivesSiteIds(drives: readonly SparseFieldDriveV1[]): readonly number[] {
  return drives.map(value => value.siteId).sort((left, right) => left - right);
}

function requireMatchingMembership(ids: readonly number[], drives: readonly SparseFieldDriveV1[],
  field: string): void {
  const expected = [...ids].sort((left, right) => left - right);
  const actual = drivesSiteIds(drives);
  if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index]))
    throw new Error(`${field}-weighted-site-membership-mismatch`);
}

function samePopulation(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((siteId, index) => siteId === right[index]);
}

/**
 * A strictly read-only prediction replica.  The source snapshot supplies the
 * potential and bonds; every run constructs its own transient activation.
 * Results are decoded only from sites actually visited by that simulation.
 */
export class DistributedPredictionCloneV2 {
  readonly #snapshot: DistributedMediumSnapshotV1;
  readonly #source: DistributedPhysicalMedium3DV1;

  constructor(snapshot: DistributedMediumSnapshotV1) {
    // Persistent potential and bonds are copied once into the read-only clone.
    // Training-time fast activation is explicitly excluded.  Individual
    // stochastic seeds then allocate only their transient activation vector
    // inside `probe`; they do not rebuild the 32^3 substrate.
    this.#snapshot = structuredClone({ ...snapshot,
      sites: snapshot.sites.map(site => ({ ...site, activation: 0 })) }) as DistributedMediumSnapshotV1;
    this.#source = DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot);
  }

  snapshot(): DistributedMediumSnapshotV1 {
    return structuredClone(this.#snapshot) as DistributedMediumSnapshotV1;
  }

  run(request: DistributedPredictionCloneRequestV2): DistributedPredictionCloneResultV2 {
    const steps = request.steps ?? 180;
    if (!Number.isInteger(steps) || steps < 1) throw new RangeError("prediction steps must be positive");
    const currentPerception = validateSeedPopulation(request.currentPerceptionSeedSiteIds,
      "currentPerceptionSeedSiteIds", this.#snapshot.sites.length);
    if (currentPerception === null) return emptyUnknown("missing-currentPerceptionSeedSiteIds");
    const currentPerceptionDrives = request.currentPerceptionSeedDrives === undefined
      ? currentPerception.map(siteId => ({ siteId, intensity: 1 }))
      : validateSeedDrives(request.currentPerceptionSeedDrives,
        "currentPerceptionSeedDrives", this.#snapshot.sites.length);
    if (currentPerceptionDrives === null) return emptyUnknown("missing-currentPerceptionSeedSiteIds");
    requireMatchingMembership(currentPerception, currentPerceptionDrives,
      "currentPerception");
    if (!Array.isArray(request.realPrefixSeedSiteIds) || request.realPrefixSeedSiteIds.length === 0)
      return emptyUnknown("missing-realPrefixSeedSiteIds");
    const realPrefix = request.realPrefixSeedSiteIds.map((pulse) =>
      validateSeedPopulation(pulse, "realPrefixSeedSiteIds", this.#snapshot.sites.length));
    if (realPrefix.some(pulse => pulse === null)) return emptyUnknown("missing-realPrefixSeedSiteIds");
    if (request.realPrefixSeedDrives !== undefined
      && request.realPrefixSeedDrives.length !== realPrefix.length)
      throw new Error("realPrefixSeedDrives pulse count mismatch");
    const realPrefixDrives = realPrefix.map((pulse, index) => {
      const drives = request.realPrefixSeedDrives === undefined
        ? pulse!.map(siteId => ({ siteId, intensity: 1 }))
        : validateSeedDrives(request.realPrefixSeedDrives[index],
          `realPrefixSeedDrives-${index}`, this.#snapshot.sites.length);
      if (drives === null) return null;
      requireMatchingMembership(pulse!, drives, `realPrefix-${index}`);
      return drives;
    });
    if (realPrefixDrives.some(pulse => pulse === null))
      return emptyUnknown("missing-realPrefixSeedSiteIds");
    const actionSiteIds = validateSeedPopulation(request.actionSeedSiteIds,
      "actionSeedSiteIds", this.#snapshot.sites.length);
    if (actionSiteIds === null) return emptyUnknown("missing-actionSeedSiteIds");
    const actionDrives = request.actionSeedDrives === undefined
      ? actionSiteIds.map(siteId => ({ siteId, intensity: 1 }))
      : validateSeedDrives(request.actionSeedDrives,
        "actionSeedDrives", this.#snapshot.sites.length);
    if (actionDrives === null) return emptyUnknown("missing-actionSeedSiteIds");
    requireMatchingMembership(actionSiteIds, actionDrives, "action");
    if (request.currentPerceptionMode === 'sequential-prefix'
      && !samePopulation(currentPerception, realPrefix[0]!)) {
      // In R1 the current perception is the first real, decaying prefix pulse.
      // Reject a caller that supplies a different historical prefix instead of
      // silently validating currentPerception and then never injecting it.
      return emptyUnknown("sequential-prefix-current-perception-mismatch");
    }
    // Keep the ordered real prefix and the candidate action visibly separate:
    // the clone must inject the observed prefix before the hypothetical action.
    const realPrefixInputs = realPrefixDrives as readonly (readonly SparseFieldDriveV1[])[];
    const action = actionDrives;
    const sequentialInputs = [...realPrefixInputs, action];
    if (steps < sequentialInputs.length) return emptyUnknown("insufficient-sequential-seed-steps");
    const defaultDomainSiteIds = [...new Set(request.readoutAssemblies
      .flatMap(assembly => assembly.siteIds))].sort((left, right) => left - right);
    const assemblies = request.readoutAssemblies.map((assembly) =>
      validateAssembly(assembly, this.#snapshot.sites.length, defaultDomainSiteIds));
    if (new Set(assemblies.map((assembly) => assembly.assemblyId)).size !== assemblies.length) {
      throw new Error("readout assembly ids must be unique");
    }
    // The field is simulated exactly once. Candidate assemblies never enter
    // the seed; after the run they are only passive masks over the terminal
    // physical residence core.
    const attractorReadout = request.currentPerceptionMode === 'held-boundary'
      ? this.#source.probeConditionedSequence(currentPerceptionDrives, sequentialInputs,
        request.seed, steps)
      : this.#source.probeSequential(sequentialInputs, request.seed, steps);
    const reaches: DistributedPredictionAssemblyReachV1[] = [];
    const readoutUniverseSiteIds = [...new Set(assemblies.flatMap(assembly =>
      assembly.enclosingDomainSiteIds))].sort((left, right) => left - right);
    for (let index = 0; index < assemblies.length; index += 1) {
      const assembly = assemblies[index]!;
      const physicalMembers = assembly.siteIds.filter(siteId => {
        const site = this.#snapshot.sites[siteId]!;
        return site.potentialDepth >= this.#snapshot.config.minimumActiveMagnitude
          && site.supportMass >= this.#snapshot.config.minimumActiveMagnitude;
      });
      if (attractorReadout.evidenceLevel === 'none'
        || physicalMembers.length / assembly.siteIds.length < assembly.minimumCoverage) continue;
      const measured = assembly.referenceActivations.length > 0
        && (attractorReadout.terminalActivations?.length ?? 0) > 0
        ? physicalActivationResidenceMatchV1(attractorReadout.terminalActivations!,
          assembly.referenceActivations, assembly.enclosingDomainSiteIds,
          readoutUniverseSiteIds)
        : (() => {
          const domain = new Set(assembly.enclosingDomainSiteIds);
          const terminalInDomain = attractorReadout.coreSiteIds.filter(siteId => domain.has(siteId));
          const match = physicalResidenceMatchV1(terminalInDomain, assembly.siteIds);
          return { domainMassFraction: match.coverage, profileOverlap: match.purity,
            score: match.score };
        })();
      if (assembly.referenceActivations.length > 0
        ? measured.score < assembly.minimumResidenceScore
        : measured.domainMassFraction < assembly.minimumCoverage
          || measured.profileOverlap < assembly.minimumPurity) continue;
      reaches.push({ assemblyId: assembly.assemblyId,
        reachedFraction: measured.domainMassFraction, purity: measured.profileOverlap,
        residenceScore: measured.score,
        visitedSiteIds: attractorReadout.coreSiteIds.filter(siteId =>
          assembly.siteIds.includes(siteId)) });
    }
    reaches.sort((left, right) => right.residenceScore - left.residenceScore
      || left.assemblyId.localeCompare(right.assemblyId, "en"));
    if (reaches.length === 0) {
      return {
        version: "DistributedPredictionCloneResultV2",
        status: "unknown",
        reason: "trajectory-did-not-reach-readout-assembly",
        reachedAssemblyIds: [],
        reaches: [],
        fieldRun: attractorReadout.run,
        attractorReadout,
      };
    }
    if (attractorReadout.ambiguous) {
      return {
        version: "DistributedPredictionCloneResultV2",
        status: "ambiguous",
        reason: "multiple-readout-assemblies-indistinguishable",
        reachedAssemblyIds: reaches.map(reach => reach.assemblyId)
          .sort((left, right) => left.localeCompare(right, 'en')),
        reaches,
        fieldRun: attractorReadout.run,
        attractorReadout,
      };
    }
    if (reaches.length > 1 && reaches[0]!.residenceScore - reaches[1]!.residenceScore < .1) {
      return {
        version: "DistributedPredictionCloneResultV2",
        status: "ambiguous",
        reason: "multiple-readout-assemblies-indistinguishable",
        reachedAssemblyIds: reaches.filter(reach => reaches[0]!.residenceScore
          - reach.residenceScore < .1).map((reach) => reach.assemblyId).sort((left, right) =>
          left.localeCompare(right, 'en')),
        reaches,
        fieldRun: attractorReadout.run,
        attractorReadout,
      };
    }
    const winner = reaches[0]!;
    return {
      version: "DistributedPredictionCloneResultV2",
      status: "reached",
      reason: "reached-readout-assembly",
      reachedAssemblyIds: [winner.assemblyId],
      reaches,
      fieldRun: attractorReadout.run,
      attractorReadout,
    };
  }

  runMany(
    request: Omit<DistributedPredictionCloneRequestV2, "seed"> & { readonly seeds: readonly bigint[] },
  ): readonly DistributedPredictionCloneResultV2[] {
    return request.seeds.map((seed) => this.run({
      currentPerceptionSeedSiteIds: request.currentPerceptionSeedSiteIds,
      ...(request.currentPerceptionSeedDrives === undefined ? {} : {
        currentPerceptionSeedDrives: request.currentPerceptionSeedDrives,
      }),
      currentPerceptionMode: request.currentPerceptionMode,
      realPrefixSeedSiteIds: request.realPrefixSeedSiteIds,
      ...(request.realPrefixSeedDrives === undefined ? {} : {
        realPrefixSeedDrives: request.realPrefixSeedDrives,
      }),
      actionSeedSiteIds: request.actionSeedSiteIds,
      ...(request.actionSeedDrives === undefined ? {} : {
        actionSeedDrives: request.actionSeedDrives,
      }),
      readoutAssemblies: request.readoutAssemblies,
      steps: request.steps,
      seed,
    }));
  }
}

export function runDistributedPredictionCloneV2(
  snapshot: DistributedMediumSnapshotV1,
  request: DistributedPredictionCloneRequestV2,
): DistributedPredictionCloneResultV2 {
  return new DistributedPredictionCloneV2(snapshot).run(request);
}
