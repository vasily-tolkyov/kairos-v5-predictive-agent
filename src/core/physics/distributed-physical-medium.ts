import { SplitMix64 } from "../random.js";
import type {
  DistributedAssemblyCompetitionReadoutV1,
  DistributedAssemblyProbeSpecV1,
  DistributedAssemblyResidenceReadoutV1,
  DistributedAttractorReadoutV1,
  DistributedBindingSnapshotV1,
  DistributedBondReferenceV1,
  DistributedBondStateV1,
  DistributedCoactivationAssemblyEvidenceV1,
  DistributedEpisodeV1,
  DistributedEvidenceLevelV1,
  DistributedFieldRunV1,
  DistributedMediumConfigInputV1,
  DistributedMediumConfigV1,
  DistributedMediumNameV1,
  DistributedMediumSnapshotV1,
  DistributedProbePulseInputV1,
  DistributedSiteSelectionStateV1,
  DistributedSiteStateV1,
  DistributedTileSnapshotV1,
  DistributedTraceFootprintV1,
  SparseFieldDriveV1,
  SparseFieldPulseV1,
} from "./distributed-physical-contracts.js";

const TILE_SIZE = 32 as const;
const TILE_VOLUME = TILE_SIZE * TILE_SIZE * TILE_SIZE;
const DEFAULT_SEED_HEX = "4b4149524f535635";
const EPSILON = 1e-12;
const UINT32_SCALE = 4_294_967_296;
// One observation of a distributed target population may only recruit a
// small fibre.  Repetition strengthens that fibre; it must not spend the
// source site's complete plastic out-degree on redundant samples from the
// same population.  With the frozen out-degree of eight this leaves room for
// later observed continuations and delayed eligibility.
const NEW_DIRECTED_FIBRE_WIDTH = 2;
// A delayed channel has already survived repeated cross-event differential
// qualification and must enter a distributed terminal basin rather than a
// single lucky site.  Four remains sparse and, after the two ordinary links
// in each preceding segment, exactly respects the frozen eight-edge cap.
const ELIGIBILITY_DIRECTED_FIBRE_WIDTH = 4;

interface MutableBond {
  readonly fromSiteId: number;
  readonly toSiteId: number;
  symmetricCoupling: number;
  directedConductance: number;
  supportMass: number;
  lastUpdatedAt: number;
  readonly kind: "local" | "plastic-directed";
}

interface MutableFootprint {
  readonly traceId: string;
  readonly depositedAt: number;
  readonly siteIds: readonly number[];
  readonly pulseSiteIds: readonly (readonly number[])[];
  readonly bondReferences: readonly DistributedBondReferenceV1[];
  readonly pulseCount: number;
  supportMass: number;
}

interface MutableCoactivationAssembly {
  readonly assemblyId: string;
  readonly terminalPulseSiteIds: readonly number[];
  readonly memberTraceIds: Set<string>;
  supportMass: number;
  lastUpdatedAt: number;
}

interface LocalAttractorTopologyV1 {
  readonly basinSiteIds: readonly (readonly number[])[];
  readonly basinIndexBySite: Int32Array<ArrayBufferLike>;
}

interface TerminalFieldStatisticsV1 {
  readonly topology: LocalAttractorTopologyV1;
  readonly totalSteps: number;
  /** Basins held by an external query boundary are inputs, not results. */
  readonly excludedReadoutBasins: ReadonlySet<number>;
  /**
   * Sites driven by the one terminal pulse of this readout.  A distributed
   * afferent population may legitimately occupy more than one disconnected
   * local basin; the pulse is the physical evidence that those basins are one
   * higher-order coactivation assembly.  It is deliberately kept separate
   * from the lattice topology so simultaneous, unrelated queries are not
   * silently made neighbours.
   */
  readonly coactivationSeedSiteIds: ReadonlySet<number>;
  /** A physically indexed repeated terminal population, if one covers the
   * query seeds.  It is kept separate from local lattice topology. */
  readonly coactivationAssembly: DistributedCoactivationAssemblyEvidenceV1 | null;
  /** Fraction of the indexed population represented by the query seeds. */
  readonly coactivationCoverage: number;
  /** Bounded transient exchange coefficient derived from live evidence. */
  readonly coactivationResonanceStrength: number;
  /** Samples in which every queried member was simultaneously active. */
  coactivationJointSamples: number;
  coactivationSamples: number;
  /** Assembly-level residence measured from the actual terminal member
   * activations.  This is separate from local-basin coDominantHistory because
   * one repeated event may legitimately occupy several disconnected basins. */
  coactivationResidentDwellSteps: number;
  coactivationResidenceReturns: number;
  coactivationResidenceExits: number;
  coactivationPreviousResident: boolean;
  /**
   * Passive readout measurements for learned terminal populations.  These
   * candidates are never seeded and never alter the field; they let an
   * ordered prefix/action continuation identify a distributed terminal only
   * when the rollout actually reaches its members.  Explicit terminal seeds
   * keep using the legacy coactivation fields above.
   */
  readonly passiveAssemblyMeasurements: PassiveAssemblyMeasurementV1[];
  /** Union of all passive terminal populations competing for this readout.
   * It is a transient denominator for relative concentration only; it is not
   * a learned bond or a new physical coordinate. */
  readonly passiveAssemblyDomainSiteIds: readonly number[];
  readonly allowPassiveAssemblyReadout: boolean;
  readonly coDominantCounts: Float64Array<ArrayBufferLike>;
  readonly integratedBasinMass: Float64Array<ArrayBufferLike>;
  readonly integratedSiteActivation: Float64Array<ArrayBufferLike>;
  readonly coDominantHistory: number[][];
  sampleCount: number;
}

interface PassiveAssemblyMeasurementV1 {
  readonly assembly: DistributedCoactivationAssemblyEvidenceV1;
  readonly memberSiteIds: readonly number[];
  readonly reachedSiteIds: Set<number>;
  readonly lateReachedSiteIds: Set<number>;
  /** Integrated activation actually measured on each member in the late
   * readout window.  This profile is observation data, never a copied
   * historical template. */
  readonly integratedMemberActivation: Map<number, number>;
  sampleCount: number;
  coverageSum: number;
  puritySum: number;
  /** Coverage-only residence is retained separately from the stricter
   * concentration-qualified residence.  It lets the decoder report two
   * genuinely competing reached populations as ambiguous without treating
   * diffuse low-level residue as a unique result. */
  coverageResidenceSteps: number;
  terminalCoverageResidenceSteps: number;
  coveragePreviousResident: boolean;
  jointSamples: number;
  dwellSteps: number;
  returns: number;
  exits: number;
  previousResident: boolean;
  terminalResidenceSteps: number;
  arrivalObserved: boolean;
}

interface PassiveAssemblyReadoutV1 {
  readonly kind: "unique" | "ambiguous" | "none";
  readonly measurement?: PassiveAssemblyMeasurementV1;
  readonly coverage?: number;
  readonly resonance?: number;
  readonly escapeRate?: number;
  readonly returnRate?: number;
  readonly measuredSiteIds?: readonly number[];
  readonly terminalActivations?: readonly {
    readonly siteId: number;
    readonly meanActivation: number;
  }[];
  readonly evidenceLevel?: DistributedEvidenceLevelV1;
}

interface AssemblyFieldStatisticsV1 {
  readonly candidateSiteIds: readonly number[];
  readonly candidateSiteSet: ReadonlySet<number>;
  readonly enclosingDomainSiteIds: readonly number[];
  readonly omittedSiteIds: readonly number[];
  readonly omittedSiteSet: ReadonlySet<number>;
  readonly totalSteps: number;
  readonly actuallyReachedSiteIds: Set<number>;
  /** Late-window activation profile measured from the rollout. */
  readonly integratedCandidateActivation: Map<number, number>;
  sampleCount: number;
  coverageSum: number;
  puritySum: number;
  omittedRestorationSum: number;
  dwellSteps: number;
  returns: number;
  exits: number;
  previousResident: boolean;
}

type RandomDrawV1 = SplitMix64 | (() => number);

interface R1CompatiblePulseV1 {
  readonly version: "R1SparseFieldPulseV1";
  readonly ordinal: number;
  readonly dwellSeconds: number;
  readonly drives: readonly { readonly siteId: number; readonly intensity: number }[];
}

interface R1CompatibleEpisodeV1 {
  readonly version: "R1DistributedEpisodeV1";
  readonly eventId: string;
  readonly eventSha256: string;
  readonly pulses: readonly R1CompatiblePulseV1[];
  readonly patternSha256: string;
  readonly sourceFrameCount: number;
  readonly retainedTransitionWaveCount: number;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requirePositive(value: number, name: string): void {
  requireFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function requireNonnegative(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

function parseSeed(seedHex: string): bigint {
  if (!/^(?:0x)?[0-9a-f]+$/iu.test(seedHex)) throw new RangeError("seedHex must contain hexadecimal digits");
  return BigInt(seedHex.startsWith("0x") || seedHex.startsWith("0X") ? seedHex : `0x${seedHex}`);
}

export function distributedMediumConfig(
  name: DistributedMediumNameV1,
  seedHex = DEFAULT_SEED_HEX,
  overrides: Partial<Omit<DistributedMediumConfigV1, "version" | "name" | "seedHex">> = {},
): DistributedMediumConfigV1 {
  const config: DistributedMediumConfigV1 = {
    version: "DistributedMediumConfigV1",
    name,
    seedHex,
    tileSize: TILE_SIZE,
    maxTiles: 32,
    dt: 0.04,
    diffusion: 0.08,
    temperature: 0.18,
    recoveryRate: 0.002,
    localCoupling: 0.08,
    activationDissipation: 0.12,
    potentialLearningRate: 0.25,
    symmetricLearningRate: 0.08,
    directedLearningRate: 0.12,
    minimumActiveMagnitude: 1e-7,
    maximumActivation: 4,
    maxPlasticLongRangeOut: 8,
    ...overrides,
  };
  validateConfig(config);
  return Object.freeze({ ...config });
}

function resolveConfig(input: DistributedMediumConfigInputV1): DistributedMediumConfigV1 {
  return distributedMediumConfig(input.name, input.seedHex ?? DEFAULT_SEED_HEX, input);
}

function validateConfig(config: DistributedMediumConfigV1): void {
  if (config.version !== "DistributedMediumConfigV1") throw new Error("unsupported distributed medium config");
  parseSeed(config.seedHex);
  if (config.name.length === 0) throw new RangeError("distributed medium name must be non-empty");
  if (config.tileSize !== TILE_SIZE) throw new RangeError("tileSize is frozen at 32");
  if (!Number.isInteger(config.maxTiles) || config.maxTiles < 1 || config.maxTiles > 32) {
    throw new RangeError("maxTiles must be an integer from 1 through 32");
  }
  if (config.dt !== 0.04 || config.diffusion !== 0.08 || config.temperature !== 0.18 || config.recoveryRate !== 0.002) {
    throw new RangeError("dt, diffusion, temperature, and recoveryRate are frozen physical parameters");
  }
  requireNonnegative(config.localCoupling, "localCoupling");
  requirePositive(config.activationDissipation, "activationDissipation");
  requirePositive(config.potentialLearningRate, "potentialLearningRate");
  requirePositive(config.symmetricLearningRate, "symmetricLearningRate");
  requirePositive(config.directedLearningRate, "directedLearningRate");
  requirePositive(config.minimumActiveMagnitude, "minimumActiveMagnitude");
  requirePositive(config.maximumActivation, "maximumActivation");
  if (config.maxPlasticLongRangeOut !== 8) throw new RangeError("maxPlasticLongRangeOut is frozen at 8");
}

function cloneConfig(config: DistributedMediumConfigV1): DistributedMediumConfigV1 {
  return { ...config };
}

function tileKey(coordinate: readonly [number, number, number]): string {
  return `${coordinate[0]},${coordinate[1]},${coordinate[2]}`;
}

function bondKey(fromSiteId: number, toSiteId: number): string {
  return `${fromSiteId}>${toSiteId}`;
}

function localBondKey(left: number, right: number): string {
  return left < right ? `${left}>${right}` : `${right}>${left}`;
}

function coactivationAssemblyId(siteIds: readonly number[]): string {
  // Opaque identity of one physical terminal population.  No result label,
  // semantic name, coordinate or score participates in this identity.
  return `coactivation:${siteIds.join(',')}`;
}

function terminalPopulation(footprint: Pick<MutableFootprint, "pulseSiteIds" | "pulseCount" | "siteIds">): readonly number[] | null {
  if (footprint.pulseSiteIds.length === footprint.pulseCount) {
    return footprint.pulseSiteIds.at(-1) ?? null;
  }
  // A legacy single-pulse snapshot can be reconstructed from siteIds.  A
  // legacy multi-pulse snapshot cannot: its union has no same-time meaning.
  return footprint.pulseCount === 1 ? footprint.siteIds : null;
}

function phi(value: number): number {
  return Math.max(0, Math.tanh(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mixUint32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function sweepUniformGenerator(seedLow: number, seedHigh: number): () => number {
  let state = mixUint32(seedLow ^ Math.imul(seedHigh, 0x9e3779b1));
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_SCALE;
  };
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Normalize one read-only probe population.  The numeric compatibility form
 * denotes unit intensity.  Weighted entries retain their supplied intensity;
 * if converging wires name a site more than once, the strongest wire wins
 * (deterministic `max`) instead of summing and manufacturing excitation.  A
 * duplicate in the legacy numeric form remains an error so its old contract
 * is unchanged.
 */
export function normalizeDistributedProbePulseV1(
  pulse: DistributedProbePulseInputV1,
  label = "probe pulse",
): readonly SparseFieldDriveV1[] {
  if (!Array.isArray(pulse) || pulse.length === 0) {
    throw new RangeError(`${label} must be non-empty`);
  }
  const weighted = typeof pulse[0] !== "number";
  const maximumBySite = new Map<number, number>();
  for (const value of pulse as readonly unknown[]) {
    if (!weighted) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${label} must contain nonnegative integer site ids`);
      }
      if (maximumBySite.has(value)) throw new Error(`${label} must contain unique site ids`);
      maximumBySite.set(value, 1);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${label} must use either numeric ids or weighted drives`);
    }
    const drive = value as Partial<SparseFieldDriveV1>;
    const siteId = drive.siteId, intensity = drive.intensity;
    if (siteId === undefined || intensity === undefined
      || !Number.isInteger(siteId) || siteId < 0
      || !Number.isFinite(intensity) || intensity <= 0 || intensity > 1) {
      throw new Error(`${label} contains an invalid weighted drive`);
    }
    maximumBySite.set(siteId, Math.max(maximumBySite.get(siteId) ?? 0, intensity));
  }
  return [...maximumBySite].sort(([left], [right]) => left - right)
    .map(([siteId, intensity]) => ({ siteId, intensity }));
}

function snapshotFootprint(footprint: MutableFootprint): DistributedTraceFootprintV1 {
  return {
    version: "DistributedTraceFootprintV1",
    traceId: footprint.traceId,
    footprintId: footprint.traceId,
    depositedAt: footprint.depositedAt,
    siteIds: [...footprint.siteIds],
    pulseSiteIds: footprint.pulseSiteIds.map((sites) => [...sites]),
    bondReferences: footprint.bondReferences.map((reference) => ({ ...reference })),
    directedBondIds: footprint.bondReferences
      .filter((reference) => reference.kind === "plastic-directed")
      .map((reference) => bondKey(reference.fromSiteId, reference.toSiteId))
      .sort(),
    pulseCount: footprint.pulseCount,
    supportMass: footprint.supportMass,
  };
}

function snapshotBond(bond: MutableBond): DistributedBondStateV1 {
  return { ...bond };
}

function asRandom(seed: bigint | SplitMix64): SplitMix64 {
  return typeof seed === "bigint" ? new SplitMix64(seed) : seed;
}

function uniform(random: RandomDrawV1): number {
  const value = typeof random === "function" ? random() : random.uniform();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random draw must be finite in [0,1)");
  }
  return value;
}

export class MediumCapacityExhaustedError extends Error {
  readonly code = "medium-capacity-exhausted" as const;

  constructor() {
    super("medium-capacity-exhausted");
    this.name = "MediumCapacityExhaustedError";
  }
}

export class DistributedPhysicalMedium3DV1 {
  readonly #config: DistributedMediumConfigV1;
  readonly #tiles: DistributedTileSnapshotV1[] = [];
  readonly #tileIndices = new Map<string, number>();
  #potentialDepth: Float64Array<ArrayBufferLike> = new Float64Array(0);
  #activation: Float64Array<ArrayBufferLike> = new Float64Array(0);
  #dissipation: Float64Array<ArrayBufferLike> = new Float64Array(0);
  #supportMass: Float64Array<ArrayBufferLike> = new Float64Array(0);
  #lastUpdatedAt: Float64Array<ArrayBufferLike> = new Float64Array(0);
  #bindings: (string | null)[] = [];
  readonly #bindingSites = new Map<string, readonly number[]>();
  readonly #localEnhancements = new Map<string, MutableBond>();
  #localEnhancementAdjacency: (Map<number, MutableBond> | undefined)[] = [];
  readonly #directedBonds = new Map<string, MutableBond>();
  readonly #directedOut = new Map<number, Set<number>>();
  readonly #directedIn = new Map<number, Set<number>>();
  #directedOutgoingAdjacency: (Map<number, MutableBond> | undefined)[] = [];
  #directedIncomingAdjacency: (Map<number, MutableBond> | undefined)[] = [];
  #directedOutgoingConductance: Float64Array<ArrayBufferLike> = new Float64Array(0);
  readonly #footprints = new Map<string, MutableFootprint>();
  readonly #coactivationAssemblies = new Map<string, MutableCoactivationAssembly>();
  #localNeighborTable = new Int32Array(0);
  #localNeighborCounts = new Uint8Array(0);
  #logicalTime = 0;
  #allocationSequence = 0;
  #metropolisSequence = 0;
  #attractorTopologyRevision = 0;
  #cachedAttractorTopology: { readonly revision: number;
    readonly value: LocalAttractorTopologyV1 } | null = null;

  constructor(input: DistributedMediumConfigInputV1) {
    this.#config = resolveConfig(input);
    this.#expandTile([0, 0, 0]);
  }

  static fromSnapshot(snapshot: DistributedMediumSnapshotV1): DistributedPhysicalMedium3DV1 {
    if (snapshot.version !== "DistributedMediumSnapshotV1") throw new Error("unsupported distributed medium snapshot");
    validateConfig(snapshot.config);
    const medium = new DistributedPhysicalMedium3DV1(snapshot.config);
    for (let index = 1; index < snapshot.tiles.length; index += 1) {
      medium.#expandTile(snapshot.tiles[index]!.tileCoordinate);
    }
    if (snapshot.sites.length !== medium.siteCount) throw new Error("distributed snapshot site count mismatch");
    snapshot.tiles.forEach((tile, index) => {
      const actual = medium.#tiles[index];
      if (actual === undefined || tile.tileIndex !== actual.tileIndex
        || !sameNumbers(tile.tileCoordinate, actual.tileCoordinate)
        || tile.firstSiteId !== actual.firstSiteId || tile.siteCount !== actual.siteCount) {
        throw new Error("distributed snapshot tile topology mismatch");
      }
    });
    for (const site of snapshot.sites) {
      medium.#assertSiteId(site.siteId);
      if (!sameNumbers(site.coordinate, medium.#coordinateOf(site.siteId))) {
        throw new Error(`distributed snapshot coordinate mismatch at site ${site.siteId}`);
      }
      requireNonnegative(site.potentialDepth, "site potentialDepth");
      requireNonnegative(site.activation, "site activation");
      requirePositive(site.dissipation, "site dissipation");
      requireNonnegative(site.supportMass, "site supportMass");
      requireNonnegative(site.lastUpdatedAt, "site lastUpdatedAt");
      medium.#potentialDepth[site.siteId] = site.potentialDepth;
      medium.#activation[site.siteId] = site.activation;
      medium.#dissipation[site.siteId] = site.dissipation;
      medium.#supportMass[site.siteId] = site.supportMass;
      medium.#lastUpdatedAt[site.siteId] = site.lastUpdatedAt;
    }
    for (const binding of snapshot.bindings) medium.bindSites(binding.bindingId, binding.siteIds);
    for (const bond of snapshot.learnedBonds) medium.#restoreBond(bond);
    for (const footprint of snapshot.footprints) {
      if (medium.#footprints.has(footprint.traceId)) throw new Error("duplicate distributed footprint");
      medium.#footprints.set(footprint.traceId, {
        traceId: footprint.traceId,
        depositedAt: footprint.depositedAt,
        siteIds: [...footprint.siteIds],
        pulseSiteIds: (footprint.pulseSiteIds ?? [footprint.siteIds]).map((sites) => [...sites]),
        bondReferences: footprint.bondReferences.map((reference) => ({ ...reference })),
        pulseCount: footprint.pulseCount,
        supportMass: footprint.supportMass,
      });
    }
    if (snapshot.coactivationAssemblies !== undefined) {
      for (const assembly of snapshot.coactivationAssemblies) {
        medium.#restoreCoactivationAssembly(assembly);
      }
    } else {
      // Older snapshots did not carry the derived index.  Rebuild it from
      // immutable footprint participation; no physical state is invented.
      for (const footprint of medium.#footprints.values())
        medium.#recordCoactivationAssembly(footprint);
    }
    requireNonnegative(snapshot.logicalTime, "snapshot logicalTime");
    medium.#logicalTime = snapshot.logicalTime;
    medium.#allocationSequence = snapshot.allocationSequence;
    medium.#metropolisSequence = snapshot.metropolisSequence;
    return medium;
  }

  get config(): DistributedMediumConfigV1 {
    return cloneConfig(this.#config);
  }

  get logicalTime(): number {
    return this.#logicalTime;
  }

  get tileCount(): number {
    return this.#tiles.length;
  }

  get siteCount(): number {
    return this.#potentialDepth.length;
  }

  allocateSites(count: number, random: RandomDrawV1): readonly number[] {
    if (!Number.isInteger(count) || count < 1) throw new RangeError("site candidate count must be positive");
    while (this.#unboundCount() < count) this.#expandNextTile();
    const unbound: number[] = [];
    for (let siteId = 0; siteId < this.siteCount; siteId += 1) {
      if (this.#bindings[siteId] === null) unbound.push(siteId);
    }
    const seed = unbound[Math.floor(uniform(random) * unbound.length)]!;
    const candidates: number[] = [];
    const seen = new Set<number>([seed]);
    const queue = [seed];
    while (queue.length > 0 && candidates.length < count) {
      const siteId = queue.shift()!;
      if (this.#bindings[siteId] === null) candidates.push(siteId);
      const neighbors = [...this.#localNeighbors(siteId)];
      for (let index = neighbors.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(uniform(random) * (index + 1));
        [neighbors[index], neighbors[swap]] = [neighbors[swap]!, neighbors[index]!];
      }
      for (const neighbor of neighbors) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (candidates.length < count) {
      const remaining = unbound.filter((siteId) => !seen.has(siteId));
      while (candidates.length < count) {
        const index = Math.floor(uniform(random) * remaining.length);
        candidates.push(remaining.splice(index, 1)[0]!);
      }
    }
    this.#allocationSequence += 1;
    return candidates;
  }

  /**
   * Allocate target-lattice candidates in the neighbourhood of already
   * allocated target sites.  The anchors are identities in this medium; no
   * source-layer coordinate is accepted or transformed.  Breadth-first
   * traversal over this medium's own six-neighbour topology keeps a newly
   * learned inter-layer fibre near the fibres of physically adjacent source
   * sites while retaining local stochastic symmetry breaking.
   */
  allocateSitesNear(anchorSiteIds: readonly number[], count: number,
    random: RandomDrawV1): readonly number[] {
    if (!Number.isInteger(count) || count < 1) throw new RangeError("site candidate count must be positive");
    const anchors = [...new Set(anchorSiteIds)];
    if (anchors.length !== anchorSiteIds.length) throw new Error("anchor sites must be unique");
    if (anchors.length === 0) return this.allocateSites(count, random);
    for (const siteId of anchors) this.#assertSiteId(siteId);
    while (this.#unboundCount() < count) this.#expandNextTile();

    for (let index = anchors.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(uniform(random) * (index + 1));
      [anchors[index], anchors[swap]] = [anchors[swap]!, anchors[index]!];
    }
    const seen = new Set<number>(anchors);
    const queue = [...anchors];
    const candidates: number[] = [];
    while (queue.length > 0 && candidates.length < count) {
      const siteId = queue.shift()!;
      if (this.#bindings[siteId] === null) candidates.push(siteId);
      const neighbors = [...this.#localNeighbors(siteId)];
      for (let index = neighbors.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(uniform(random) * (index + 1));
        [neighbors[index], neighbors[swap]] = [neighbors[swap]!, neighbors[index]!];
      }
      for (const neighbor of neighbors) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    if (candidates.length !== count) throw new MediumCapacityExhaustedError();
    this.#allocationSequence += 1;
    return candidates;
  }

  competeForSites(candidateSiteIds: readonly number[], winnerCount: number, random: RandomDrawV1): readonly number[] {
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > candidateSiteIds.length) {
      throw new RangeError("winnerCount must fit the candidate set");
    }
    const candidates = [...new Set(candidateSiteIds)];
    if (candidates.length !== candidateSiteIds.length) throw new Error("site candidates must be unique");
    for (const siteId of candidates) {
      this.#assertSiteId(siteId);
      if (this.#bindings[siteId] !== null) throw new Error(`site ${siteId} is already bound`);
    }
    const tie = new Map(candidates.map((siteId) => [siteId, uniform(random)]));
    const score = (siteId: number, selected: readonly number[]): number => {
      const localSelected = this.#localNeighbors(siteId).filter((neighbor) => selected.includes(neighbor)).length;
      const localBound = this.#localNeighbors(siteId).filter((neighbor) => this.#bindings[neighbor] !== null).length;
      return this.#activation[siteId]! + 0.25 * this.#potentialDepth[siteId]!
        + 0.05 * this.#supportMass[siteId]! + 0.35 * localSelected - 0.1 * localBound
        + tie.get(siteId)! * 1e-9;
    };
    const selected: number[] = [];
    while (selected.length < winnerCount) {
      const remaining = candidates.filter((siteId) => !selected.includes(siteId));
      remaining.sort((left, right) => score(right, selected) - score(left, selected) || left - right);
      selected.push(remaining[0]!);
    }
    return selected;
  }

  bindSites(bindingId: string, siteIds: readonly number[]): void {
    if (bindingId.length === 0) throw new RangeError("bindingId must be non-empty");
    const unique = [...new Set(siteIds)].sort((left, right) => left - right);
    if (unique.length === 0 || unique.length !== siteIds.length) throw new Error("binding sites must be non-empty and unique");
    const existing = this.#bindingSites.get(bindingId);
    if (existing !== undefined) {
      if (!sameNumbers(existing, unique)) throw new Error(`binding ${bindingId} cannot be reassigned`);
      return;
    }
    for (const siteId of unique) {
      this.#assertSiteId(siteId);
      if (this.#bindings[siteId] !== null) throw new Error(`site ${siteId} is already bound`);
    }
    for (const siteId of unique) this.#bindings[siteId] = bindingId;
    this.#bindingSites.set(bindingId, unique);
  }

  bindingSites(bindingId: string): readonly number[] | null {
    const sites = this.#bindingSites.get(bindingId);
    return sites === undefined ? null : [...sites];
  }

  siteSelectionState(siteIds: readonly number[]): readonly DistributedSiteSelectionStateV1[] {
    return siteIds.map((siteId) => {
      const site = this.site(siteId);
      return {
        ...site,
        boundNeighborCount: this.#localNeighbors(siteId).filter((neighbor) => this.#bindings[neighbor] !== null).length,
      };
    });
  }

  applyPulse(pulse: SparseFieldPulseV1, strength = 1): DistributedTraceFootprintV1 {
    return this.applyEpisode({
      version: "DistributedEpisodeV1",
      traceId: pulse.pulseId ?? `trusted-pulse-${this.#allocationSequence}-${this.#footprints.size}`,
      provenance: "trusted-real-event",
      pulses: [pulse],
    }, strength);
  }

  applyEpisode(episode: DistributedEpisodeV1 | R1CompatibleEpisodeV1, strength = 1): DistributedTraceFootprintV1 {
    const physicalEpisode = episode.version === "R1DistributedEpisodeV1"
      ? this.#adaptR1Episode(episode)
      : episode;
    this.#validateEpisode(physicalEpisode, strength);
    if (this.#footprints.has(physicalEpisode.traceId)) throw new Error(`duplicate distributed trace: ${physicalEpisode.traceId}`);
    const siteIds = new Set<number>();
    const bondReferences = new Map<string, DistributedBondReferenceV1>();
    for (const pulse of physicalEpisode.pulses) {
      const dwellWeight = Math.max(1, (pulse.dwellSeconds ?? this.#config.dt) / this.#config.dt);
      for (const drive of pulse.drives) {
        const amount = drive.intensity * strength * dwellWeight;
        siteIds.add(drive.siteId);
        this.#activation[drive.siteId] = clamp(
          this.#activation[drive.siteId]! + amount,
          0,
          this.#config.maximumActivation,
        );
        this.#potentialDepth[drive.siteId] = this.#potentialDepth[drive.siteId]!
          + this.#config.potentialLearningRate * amount;
        this.#lastUpdatedAt[drive.siteId] = this.#logicalTime;
      }
      // Symmetric learning is restricted to the fixed six-neighbour lattice.
      // Enumerating every pair of sites in a rich population and then rejecting
      // all non-neighbours is O(n^2) but physically identical to visiting each
      // driven site's six neighbours.  The latter keeps the distributed code
      // large without turning population size into an artificial time penalty.
      const intensityBySite = new Map(pulse.drives.map((drive) => [drive.siteId, drive.intensity]));
      for (const a of pulse.drives) {
        for (const neighborId of this.#localNeighbors(a.siteId)) {
          if (neighborId <= a.siteId) continue;
          const neighborIntensity = intensityBySite.get(neighborId);
          if (neighborIntensity === undefined) continue;
          const reference = this.#strengthenLocalBond(
            a.siteId,
            neighborId,
            Math.min(a.intensity, neighborIntensity) * strength * dwellWeight,
          );
          bondReferences.set(`local:${localBondKey(a.siteId, neighborId)}`, reference);
        }
      }
    }
    // Evidence support counts independent real episodes, not frames or dwell.
    // A long unchanged observation can deepen residence without impersonating
    // repeated evidence from independent events.
    for (const siteId of siteIds) this.#supportMass[siteId] = this.#supportMass[siteId]! + strength;
    for (let pulseIndex = 1; pulseIndex < physicalEpisode.pulses.length; pulseIndex += 1) {
      const before = physicalEpisode.pulses[pulseIndex - 1]!;
      const after = physicalEpisode.pulses[pulseIndex]!;
      this.#learnDirectedPopulationTransition(before, after, pulseIndex, strength, bondReferences);
    }
    for (const eligibility of physicalEpisode.temporalEligibility ?? []) {
      const before = physicalEpisode.pulses[eligibility.fromPulseIndex]!;
      const after = physicalEpisode.pulses[eligibility.toPulseIndex]!;
      this.#learnDirectedPopulationTransition(before, after,
        eligibility.toPulseIndex, strength * eligibility.strength, bondReferences,
        ELIGIBILITY_DIRECTED_FIBRE_WIDTH);
    }
    const footprint: MutableFootprint = {
      traceId: physicalEpisode.traceId,
      depositedAt: this.#logicalTime,
      siteIds: [...siteIds].sort((left, right) => left - right),
      pulseSiteIds: physicalEpisode.pulses.map((pulse) => pulse.drives
        .map((drive) => drive.siteId).sort((left, right) => left - right)),
      bondReferences: [...bondReferences.values()].sort(
        (left, right) => left.fromSiteId - right.fromSiteId || left.toSiteId - right.toSiteId || left.kind.localeCompare(right.kind),
      ),
      pulseCount: physicalEpisode.pulses.length,
      supportMass: strength,
    };
    this.#footprints.set(physicalEpisode.traceId, footprint);
    this.#recordCoactivationAssembly(footprint);
    this.#invalidateAttractorTopology();
    return snapshotFootprint(footprint);
  }

  settle(seed: bigint | SplitMix64, steps: number): DistributedFieldRunV1 {
    const result = this.#simulate(this.#activation, asRandom(seed), steps);
    this.#activation = result.activation;
    this.#metropolisSequence += steps;
    return result.run;
  }

  probe(seedSiteIds: readonly number[], seed: bigint | SplitMix64, steps: number): DistributedAttractorReadoutV1 {
    const activation = new Float64Array(this.#activation);
    for (const siteId of [...new Set(seedSiteIds)]) {
      this.#assertSiteId(siteId);
      activation[siteId] = Math.max(1, activation[siteId]!);
    }
    const terminalField = this.#newTerminalFieldStatistics(steps, [], seedSiteIds);
    const result = this.#simulate(activation, asRandom(seed), steps, terminalField, 0);
    return this.#readAttractor(result.run, terminalField);
  }

  /**
   * Read-only rollout with distinct, ordered afferent populations.  Every
   * pulse is injected into the transient activation in the supplied order;
   * persistent potential, bonds, footprints, and counters are untouched.
   */
  probeSequential(seedPulses: readonly DistributedProbePulseInputV1[], seed: bigint | SplitMix64,
    steps: number): DistributedAttractorReadoutV1 {
    if (seedPulses.length === 0) throw new Error("sequential probe requires at least one pulse");
    if (!Number.isInteger(steps) || steps < seedPulses.length)
      throw new RangeError("sequential probe steps must cover every input pulse");
    const normalized = seedPulses.map((pulse, pulseIndex) => {
      const drives = normalizeDistributedProbePulseV1(pulse,
        `sequential probe pulse ${pulseIndex}`);
      drives.forEach(drive => this.#assertSiteId(drive.siteId));
      return drives;
    });
    let activation: Float64Array = new Float64Array(this.#activation);
    const random = asRandom(seed);
    let acceptedSteps = 0, rejectedSteps = 0, directedTransportMass = 0;
    const leaderSiteIds: number[] = [];
    let finalActivations: DistributedFieldRunV1['finalActivations'] = [];
    const terminalField = this.#newTerminalFieldStatistics(steps, [],
      normalized.at(-1)!.map((drive) => drive.siteId), true);
    let globalStepOffset = 0;
    normalized.forEach((pulse, pulseIndex) => {
      this.#seedProbeDrives(activation, pulse);
      const phaseSteps = pulseIndex + 1 < normalized.length ? 1 : steps - pulseIndex;
      const phase = this.#simulate(activation, random, phaseSteps, terminalField, globalStepOffset);
      activation = phase.activation;
      acceptedSteps += phase.run.acceptedSteps;
      rejectedSteps += phase.run.rejectedSteps;
      directedTransportMass += phase.run.directedTransportMass ?? 0;
      leaderSiteIds.push(...phase.run.leaderSiteIds);
      finalActivations = phase.run.finalActivations;
      globalStepOffset += phaseSteps;
    });
    const run: DistributedFieldRunV1 = { version: "DistributedFieldRunV1", steps,
      acceptedSteps, rejectedSteps, directedTransportMass, leaderSiteIds, finalActivations };
    return this.#readAttractor(run, terminalField);
  }

  /**
   * Read-only rollout under a currently observed condition field.
   *
   * R3 is an external boundary condition, not another historical event in the
   * proposed sequence. Its afferent population is held throughout the
   * hypothetical prefix/action rollout and released with the clone. The held
   * population routes excitation but its own basin is not decoded as a result.
   */
  probeConditionedSequence(conditionSiteIds: DistributedProbePulseInputV1,
    seedPulses: readonly DistributedProbePulseInputV1[], seed: bigint | SplitMix64,
    steps: number): DistributedAttractorReadoutV1 {
    if (conditionSiteIds.length === 0) {
      throw new Error("conditioned probe requires a non-empty unique condition population");
    }
    // Preserve the legacy duplicate-id rejection while allowing weighted
    // converging wires to be explicitly aggregated by the normalizer.
    if (typeof conditionSiteIds[0] === "number"
      && new Set(conditionSiteIds as readonly number[]).size !== conditionSiteIds.length) {
      throw new Error("conditioned probe requires a non-empty unique condition population");
    }
    const conditionDrives = normalizeDistributedProbePulseV1(conditionSiteIds, "condition population");
    conditionDrives.forEach(drive => this.#assertSiteId(drive.siteId));
    const condition = conditionDrives.map(drive => drive.siteId);
    if (seedPulses.length === 0) throw new Error("conditioned probe requires at least one sequential pulse");
    if (!Number.isInteger(steps) || steps < seedPulses.length)
      throw new RangeError("conditioned probe steps must cover every input pulse");
    const normalized = seedPulses.map((pulse, pulseIndex) => {
      const drives = normalizeDistributedProbePulseV1(pulse,
        `conditioned probe pulse ${pulseIndex}`);
      drives.forEach(drive => this.#assertSiteId(drive.siteId));
      return drives;
    });
    let activation: Float64Array = new Float64Array(this.#activation);
    this.#seedProbeDrives(activation, conditionDrives);
    const random = asRandom(seed);
    let acceptedSteps = 0, rejectedSteps = 0, directedTransportMass = 0;
    const leaderSiteIds: number[] = [];
    let finalActivations: DistributedFieldRunV1['finalActivations'] = [];
    const terminalField = this.#newTerminalFieldStatistics(steps, condition,
      normalized.at(-1)!.map((drive) => drive.siteId), true);
    let globalStepOffset = 0;
    normalized.forEach((pulse, pulseIndex) => {
      this.#seedProbeDrives(activation, pulse);
      const phaseSteps = pulseIndex + 1 < normalized.length ? 1 : steps - pulseIndex;
      const phase = this.#simulate(activation, random, phaseSteps, terminalField,
        globalStepOffset, conditionDrives);
      activation = phase.activation;
      acceptedSteps += phase.run.acceptedSteps;
      rejectedSteps += phase.run.rejectedSteps;
      directedTransportMass += phase.run.directedTransportMass ?? 0;
      leaderSiteIds.push(...phase.run.leaderSiteIds);
      finalActivations = phase.run.finalActivations;
      globalStepOffset += phaseSteps;
    });
    const run: DistributedFieldRunV1 = { version: "DistributedFieldRunV1", steps,
      acceptedSteps, rejectedSteps, directedTransportMass, leaderSiteIds, finalActivations };
    return this.#readAttractor(run, terminalField);
  }

  /**
   * Read a learned terminal population without injecting that population.
   * The ordered/weighted route is the only source of excitation; the named
   * sites are a passive physical mask used solely to measure whether the
   * rollout actually arrived there.  This distinction is required when an
   * historical result population is available as evidence but must not be
   * copied into a prediction seed.
   */
  probeSequentialAtReadout(seedPulses: readonly DistributedProbePulseInputV1[],
    readoutSiteIds: readonly number[], readoutDomainSiteIds: readonly number[],
    seed: bigint | SplitMix64, steps: number): DistributedAttractorReadoutV1 {
    return this.#probeSequenceAtReadout([], seedPulses, readoutSiteIds,
      readoutDomainSiteIds, seed, steps, false);
  }

  /** Conditioned counterpart of probeSequentialAtReadout. */
  probeConditionedSequenceAtReadout(conditionSiteIds: DistributedProbePulseInputV1,
    seedPulses: readonly DistributedProbePulseInputV1[],
    readoutSiteIds: readonly number[], readoutDomainSiteIds: readonly number[],
    seed: bigint | SplitMix64, steps: number): DistributedAttractorReadoutV1 {
    return this.#probeSequenceAtReadout(conditionSiteIds, seedPulses, readoutSiteIds,
      readoutDomainSiteIds, seed, steps, true);
  }

  #probeSequenceAtReadout(conditionSiteIds: DistributedProbePulseInputV1,
    seedPulses: readonly DistributedProbePulseInputV1[],
    readoutSiteIds: readonly number[], readoutDomainSiteIds: readonly number[],
    seed: bigint | SplitMix64, steps: number, holdCondition: boolean):
    DistributedAttractorReadoutV1 {
    if (seedPulses.length === 0)
      throw new Error('passive readout probe requires at least one sequential pulse');
    if (!Number.isInteger(steps) || steps < seedPulses.length)
      throw new RangeError('passive readout probe steps must cover every input pulse');
    const conditionDrives = conditionSiteIds.length === 0 ? []
      : normalizeDistributedProbePulseV1(conditionSiteIds, 'passive readout condition');
    if (holdCondition && conditionDrives.length === 0)
      throw new Error('conditioned passive readout probe requires a non-empty condition');
    conditionDrives.forEach(drive => this.#assertSiteId(drive.siteId));
    const normalized = seedPulses.map((pulse, pulseIndex) => {
      const drives = normalizeDistributedProbePulseV1(pulse,
        `passive readout pulse ${pulseIndex}`);
      drives.forEach(drive => this.#assertSiteId(drive.siteId));
      return drives;
    });
    const candidate = this.#normalizeAssemblySiteIds(readoutSiteIds,
      'passive readout candidate');
    const domain = this.#normalizeAssemblySiteIds(readoutDomainSiteIds,
      'passive readout domain');
    const domainSet = new Set(domain);
    if (candidate.some(siteId => !domainSet.has(siteId)))
      throw new Error('passive readout candidate lies outside its domain');
    // AssemblyFieldStatistics records only the candidate population and never
    // seeds it.  The common domain keeps purity comparable across competing
    // candidates instead of normalising each candidate against its own noise.
    const fields = this.#newAssemblyFieldStatistics([{
      candidateSiteIds: candidate,
      enclosingDomainSiteIds: domain,
    }], steps);
    let activation: Float64Array = new Float64Array(this.#activation);
    if (holdCondition) this.#seedProbeDrives(activation, conditionDrives);
    const random = asRandom(seed);
    let acceptedSteps = 0, rejectedSteps = 0, directedTransportMass = 0;
    const leaderSiteIds: number[] = [];
    let finalActivations: DistributedFieldRunV1['finalActivations'] = [];
    let globalStepOffset = 0;
    normalized.forEach((pulse, pulseIndex) => {
      this.#seedProbeDrives(activation, pulse);
      const phaseSteps = pulseIndex + 1 < normalized.length ? 1 : steps - pulseIndex;
      const phase = this.#simulate(activation, random, phaseSteps, undefined,
        globalStepOffset, holdCondition ? conditionDrives : [], fields);
      activation = phase.activation;
      acceptedSteps += phase.run.acceptedSteps;
      rejectedSteps += phase.run.rejectedSteps;
      directedTransportMass += phase.run.directedTransportMass ?? 0;
      leaderSiteIds.push(...phase.run.leaderSiteIds);
      finalActivations = phase.run.finalActivations;
      globalStepOffset += phaseSteps;
    });
    const run: DistributedFieldRunV1 = { version: 'DistributedFieldRunV1', steps,
      acceptedSteps, rejectedSteps, directedTransportMass, leaderSiteIds, finalActivations };
    const residence = this.#readAssemblyField(fields[0]!, run);
    // A non-stable passive mask is explicitly unknown to the caller.  Keep
    // the measured evidence level for audit, but do not expose partially
    // reached sites as a successful attractor.
    return {
      version: 'DistributedAttractorReadoutV1',
      coreSiteIds: residence.stable ? [...residence.actuallyReachedSiteIds] : [],
      dwellSteps: residence.dwellSteps,
      returnRate: residence.returnRate,
      escapeRate: residence.escapeRate,
      evidenceLevel: residence.evidenceLevel,
      ambiguous: false,
      terminalActivations: residence.terminalActivations ?? [],
      run,
    };
  }

  probeSequentialAgainstAssemblies(seedPulses: readonly (readonly number[])[],
    assemblies: readonly DistributedAssemblyProbeSpecV1[], seed: bigint | SplitMix64,
    steps: number): DistributedAssemblyCompetitionReadoutV1 {
    return this.#probeSequenceAgainstAssemblies([], seedPulses, assemblies, seed, steps, false);
  }

  probeConditionedSequenceAgainstAssemblies(conditionSiteIds: readonly number[],
    seedPulses: readonly (readonly number[])[],
    assemblies: readonly DistributedAssemblyProbeSpecV1[], seed: bigint | SplitMix64,
    steps: number): DistributedAssemblyCompetitionReadoutV1 {
    return this.#probeSequenceAgainstAssemblies(conditionSiteIds, seedPulses,
      assemblies, seed, steps, true);
  }

  /**
   * Qualification perturbation for one anonymous physical assembly.  The
   * omitted quarter is never clamped or copied back; restoration can only come
   * from the same local stochastic dynamics used by production prediction.
   */
  probeCandidateAssemblyResidence(candidateSiteIds: readonly number[],
    enclosingDomainSiteIds: readonly number[], perturbationOrdinal: number,
    seed: bigint | SplitMix64, steps: number): DistributedAssemblyResidenceReadoutV1 {
    if (!Number.isInteger(perturbationOrdinal) || perturbationOrdinal < 0)
      throw new RangeError('assembly perturbation ordinal must be a nonnegative integer');
    const candidate = this.#normalizeAssemblySiteIds(candidateSiteIds, 'candidate');
    const omitted = candidate.filter((_siteId, position) =>
      (position + perturbationOrdinal) % 4 === 0);
    const retained = candidate.filter(siteId => !omitted.includes(siteId));
    if (retained.length === 0) throw new Error('assembly perturbation removed every candidate site');
    const fields = this.#newAssemblyFieldStatistics([{ candidateSiteIds: candidate,
      enclosingDomainSiteIds, omittedSiteIds: omitted }], steps);
    const activation = new Float64Array(this.#activation);
    retained.forEach(siteId => { activation[siteId] = Math.max(1, activation[siteId]!); });
    const terminalField = this.#newTerminalFieldStatistics(steps);
    const result = this.#simulate(activation, asRandom(seed), steps, terminalField, 0, [], fields);
    return this.#readAssemblyField(fields[0]!, result.run);
  }

  #probeSequenceAgainstAssemblies(conditionSiteIds: readonly number[],
    seedPulses: readonly (readonly number[])[], assemblies: readonly DistributedAssemblyProbeSpecV1[],
    seed: bigint | SplitMix64, steps: number, holdCondition: boolean):
  DistributedAssemblyCompetitionReadoutV1 {
    if (seedPulses.length === 0) throw new Error('assembly probe requires at least one sequential pulse');
    if (!Number.isInteger(steps) || steps < seedPulses.length)
      throw new RangeError('assembly probe steps must cover every input pulse');
    const condition = conditionSiteIds.length === 0 ? []
      : this.#normalizeAssemblySiteIds(conditionSiteIds, 'condition');
    if (holdCondition && condition.length === 0)
      throw new Error('conditioned assembly probe requires a non-empty condition population');
    const normalized = seedPulses.map((pulse, index) =>
      this.#normalizeAssemblySiteIds(pulse, `sequential pulse ${index}`));
    const assemblyFields = this.#newAssemblyFieldStatistics(assemblies, steps);
    let activation: Float64Array = new Float64Array(this.#activation);
    if (holdCondition) condition.forEach(siteId => { activation[siteId] = Math.max(1, activation[siteId]!); });
    const random = asRandom(seed);
    let acceptedSteps = 0, rejectedSteps = 0, directedTransportMass = 0;
    const leaderSiteIds: number[] = [];
    let finalActivations: DistributedFieldRunV1['finalActivations'] = [];
    const conditionDrives = condition.map(siteId => ({ siteId, intensity: 1 }));
    const terminalField = this.#newTerminalFieldStatistics(steps,
      holdCondition ? condition : [], normalized.at(-1)!);
    let globalStepOffset = 0;
    normalized.forEach((pulse, pulseIndex) => {
      pulse.forEach(siteId => { activation[siteId] = Math.max(1, activation[siteId]!); });
      const phaseSteps = pulseIndex + 1 < normalized.length ? 1 : steps - pulseIndex;
      const phase = this.#simulate(activation, random, phaseSteps, terminalField,
        globalStepOffset, holdCondition ? conditionDrives : [], assemblyFields);
      activation = phase.activation;
      acceptedSteps += phase.run.acceptedSteps;
      rejectedSteps += phase.run.rejectedSteps;
      directedTransportMass += phase.run.directedTransportMass ?? 0;
      leaderSiteIds.push(...phase.run.leaderSiteIds);
      finalActivations = phase.run.finalActivations;
      globalStepOffset += phaseSteps;
    });
    const run: DistributedFieldRunV1 = { version: 'DistributedFieldRunV1', steps,
      acceptedSteps, rejectedSteps, directedTransportMass, leaderSiteIds, finalActivations };
    return { version: 'DistributedAssemblyCompetitionReadoutV1',
      attractorReadout: this.#readAttractor(run, terminalField),
      assemblies: assemblyFields.map(field => this.#readAssemblyField(field, run)) };
  }

  #readAttractor(run: DistributedFieldRunV1,
    terminalField: TerminalFieldStatisticsV1): DistributedAttractorReadoutV1 {
    const terminalActivations = terminalField.sampleCount === 0 ? []
      : Array.from(terminalField.integratedSiteActivation.entries())
        .filter(([, activation]) => activation >= this.#config.minimumActiveMagnitude)
        .map(([siteId, activation]) => ({ siteId,
          meanActivation: activation / terminalField.sampleCount }));
    let passiveAssembly = this.#passiveAssemblyReadout(terminalField);
    const passiveWasAmbiguous = passiveAssembly.kind === 'ambiguous';
    // A continuation can reach a distributed terminal population without a
    // single local basin winning the ordinary lattice readout.  If passive
    // measurements satisfy the same physical quorum/dwell/escape gates, use
    // that measured population as the readout; no terminal members were
    // injected by the query.
    if (passiveAssembly.kind === "unique") {
      const measurement = passiveAssembly.measurement!;
      return {
        version: "DistributedAttractorReadoutV1",
        coreSiteIds: [...passiveAssembly.measuredSiteIds!],
        dwellSteps: measurement.dwellSteps,
        returnRate: passiveAssembly.returnRate!,
        escapeRate: passiveAssembly.escapeRate!,
        evidenceLevel: passiveAssembly.evidenceLevel!,
        ambiguous: false,
        terminalActivations: passiveAssembly.terminalActivations ?? terminalActivations,
        coactivationAssemblyId: measurement.assembly.assemblyId,
        coactivationCoverage: passiveAssembly.coverage!,
        coactivationResonance: passiveAssembly.resonance!,
        run,
      };
    }
    // The substrate is distributed.  A readout therefore measures residence
    // of complete learned local basins, using the activation mass of every
    // participating site, rather than collapsing each field tick to its one
    // globally strongest lattice point.  Upstream populations may retain
    // residual excitation after propagation; unless their whole basin remains
    // co-dominant they are not a second terminal attractor.
    const maximumDwell = terminalField.coDominantCounts.reduce(
      (maximum, count) => Math.max(maximum, count), 0);
    if (terminalField.sampleCount === 0 || maximumDwell === 0) {
      return {
        version: "DistributedAttractorReadoutV1",
        coreSiteIds: [],
        dwellSteps: 0,
        returnRate: 0,
        escapeRate: 1,
        evidenceLevel: "none",
        ambiguous: passiveAssembly.kind === "ambiguous",
        terminalActivations,
        run,
      };
    }
    const persistenceWindow = terminalField.coDominantHistory.slice(
      -Math.max(1, Math.floor(terminalField.sampleCount * .25)));
    const persistentCounts = new Float64Array(terminalField.topology.basinSiteIds.length);
    persistenceWindow.forEach(frame => frame.forEach(basinIndex => {
      persistentCounts[basinIndex] = persistentCounts[basinIndex]! + 1;
    }));
    // A basin that was strong earlier in the rollout is not a terminal
    // result merely because its integrated dwell remains large.  Measure the
    // contiguous residence at the end of the actual field run as well.  This
    // keeps an upstream/intermediate visit out of the readout while retaining
    // genuinely co-dominant terminal populations (which share the same tail).
    const terminalResidence = new Int32Array(terminalField.topology.basinSiteIds.length);
    for (let basinIndex = 0; basinIndex < terminalResidence.length; basinIndex += 1) {
      for (let index = terminalField.coDominantHistory.length - 1; index >= 0; index -= 1) {
        if (!terminalField.coDominantHistory[index]!.includes(basinIndex)) break;
        terminalResidence[basinIndex] = terminalResidence[basinIndex]! + 1;
      }
    }
    const rankedBasins = terminalField.topology.basinSiteIds
      .map((siteIds, basinIndex) => ({ basinIndex, siteIds,
        dwell: terminalField.coDominantCounts[basinIndex]!,
        mass: terminalField.integratedBasinMass[basinIndex]!,
        persistent: persistentCounts[basinIndex]!,
        terminalResidence: terminalResidence[basinIndex]! }))
      .filter(value => value.dwell > 0)
      .sort((left, right) => right.persistent - left.persistent
        || right.dwell - left.dwell || right.mass - left.mass
        || left.siteIds[0]! - right.siteIds[0]!);
    // Only a meaningful contiguous terminal tail can override the ordinary
    // accumulated ranking.  A one- or two-sample tail is often a residual
    // fluctuation; it must not displace a well-supported downstream basin.
    const terminalMinimumResidence = Math.max(2,
      Math.ceil(terminalField.sampleCount * .1));
    const terminalBasins = rankedBasins.filter(value =>
      value.terminalResidence >= terminalMinimumResidence)
      .sort((left, right) => right.terminalResidence - left.terminalResidence
        || right.persistent - left.persistent || right.dwell - left.dwell
        || left.siteIds[0]! - right.siteIds[0]!);
    const primary = terminalBasins[0] ?? rankedBasins[0];
    if (primary === undefined) {
      return {
        version: "DistributedAttractorReadoutV1",
        coreSiteIds: [], dwellSteps: 0, returnRate: 0, escapeRate: 1,
        evidenceLevel: "none", ambiguous: passiveAssembly.kind === "ambiguous", run,
        terminalActivations,
      };
    }
    // If the passive decoder saw more than one learned population, retain the
    // ordinary accumulated ranking for the independent tie-break below.  A
    // terminal-tail ranking can otherwise select whichever passive population
    // happens to receive the last residual pulse and turn a genuinely diffuse
    // rollout into a false unique result.
    const secondaryPool = passiveWasAmbiguous ? [] : terminalBasins;
    const ordinaryPrimary = rankedBasins[0];
    // A passive terminal mask may contain a downstream population together
    // with an upstream residue.  When the ordinary field ranking points at
    // that residue but the contiguous terminal tail has exactly one different
    // basin, the tail is the physical evidence that identifies the terminal
    // winner.  If the ordinary and tail rankings agree, retain ambiguity: the
    // passive mask has supplied no independent way to choose between its
    // reached populations (the diffuse-competition case).
    const passiveResolvedByTerminalTail = passiveWasAmbiguous
      && terminalBasins.length === 1
      && ordinaryPrimary !== undefined
      && terminalBasins[0]!.basinIndex !== ordinaryPrimary.basinIndex;
    const selectedPrimary = passiveWasAmbiguous
      ? (passiveResolvedByTerminalTail ? terminalBasins[0] : ordinaryPrimary)
      : primary;
    if (selectedPrimary === undefined) {
      return {
        version: "DistributedAttractorReadoutV1",
        coreSiteIds: [], dwellSteps: 0, returnRate: 0, escapeRate: 1,
        evidenceLevel: "none", ambiguous: true, run, terminalActivations,
      };
    }
    const effectivePrimary = selectedPrimary;
    const seededBasins = new Set<number>();
    for (const siteId of terminalField.coactivationSeedSiteIds) {
      const basinIndex = terminalField.topology.basinIndexBySite[siteId]!;
      if (basinIndex >= 0 && !terminalField.excludedReadoutBasins.has(basinIndex))
        seededBasins.add(basinIndex);
    }
    // Initial populations are not themselves an ambiguity: a current frame
    // commonly seeds several learned fibres before one terminal basin wins.
    // Retain ambiguity only when two independently seeded basins remain
    // materially present in the terminal field.  This preserves the genuine
    // independent-population case without making an upstream transient visit
    // veto a downstream terminal winner.
    const materiallySeededBasins = rankedBasins.filter(value =>
      seededBasins.has(value.basinIndex)
      && value.dwell >= maximumDwell * .25);
    const selectedBasins = [effectivePrimary, ...secondaryPool.filter(value =>
      value.basinIndex !== effectivePrimary.basinIndex
      && effectivePrimary.persistent > 0
      && value.persistent >= effectivePrimary.persistent * .75
      && value.dwell >= maximumDwell * .25
      && value.terminalResidence >= effectivePrimary.terminalResidence * .75)];
    let coreSiteIds = selectedBasins.flatMap(({ siteIds }) => {
      const maximumSiteMass = siteIds.reduce((maximum, siteId) =>
        Math.max(maximum, terminalField.integratedSiteActivation[siteId]!), 0);
      return siteIds.filter(siteId => terminalField.integratedSiteActivation[siteId]!
        >= Math.max(this.#config.minimumActiveMagnitude, maximumSiteMass * .25));
    }).sort((left, right) => left - right);
    // A same-time population is a higher-order assembly only when that exact
    // population has been observed in at least two trusted episodes and every
    // basin selected by the terminal field is seeded by it.  This preserves
    // ambiguity for an unseeded residual/alternative basin and for synthetic
    // queries that merely happen to stimulate two separate basins.  No result
    // label, distance, or threshold change is involved.
    const coactivationResonance = terminalField.coactivationSamples === 0 ? 0
      : terminalField.coactivationJointSamples / terminalField.coactivationSamples;
    // A repeated terminal population is allowed to span several disconnected
    // local lattice basins.  Requiring the ordinary winner to be one of the
    // seeded basins would make the unrelated background basin veto a valid
    // higher-order assembly.  The assembly still needs live repeated physical
    // evidence and a measured terminal quorum below; no metadata alone can
    // clear ambiguity.
    const coactivationCandidate = terminalField.coactivationAssembly !== null
      && coactivationResonance > 0;
    let coactivationAssembly = false;
    if (coactivationCandidate) {
      // The terminal population itself is the readout object when its
      // repeated members have real measured activation.  Do not infer this
      // from the audit index: require a three-quarter quorum in the terminal
      // samples, matching the existing physical assembly-residence gate.
      const assemblySites = terminalField.coactivationAssembly.terminalPulseSiteIds;
      const measuredAssemblySites = assemblySites.filter(siteId =>
        terminalField.integratedSiteActivation[siteId]!
          / Math.max(1, terminalField.sampleCount)
          >= this.#config.minimumActiveMagnitude);
      if (measuredAssemblySites.length / assemblySites.length >= .75) {
        coactivationAssembly = true;
        coreSiteIds = [...new Set([...coreSiteIds, ...measuredAssemblySites])]
          .sort((left, right) => left - right);
      }
    }
    if (coreSiteIds.length === 0) {
      return {
        version: "DistributedAttractorReadoutV1",
        coreSiteIds: [], dwellSteps: 0, returnRate: 0, escapeRate: 1,
        evidenceLevel: "none", ambiguous: passiveAssembly.kind === "ambiguous", run,
        terminalActivations,
      };
    }
    // A passive mask can legitimately see more than one learned population
    // during a rollout.  When the ordinary terminal field has nevertheless
    // converged to one physical basin, use that independently measured basin
    // to identify the one reached population.  This resolves an upstream
    // visit without allowing a semantic assembly id or a historical template
    // to choose the result; diffuse populations with no matching terminal
    // core remain ambiguous.
    if (passiveWasAmbiguous && !passiveResolvedByTerminalTail
      && selectedBasins.length === 1) {
      const core = new Set(coreSiteIds);
      const matches = terminalField.passiveAssemblyMeasurements.filter(measurement => {
        const memberCount = measurement.memberSiteIds.length;
        const reachedFraction = measurement.lateReachedSiteIds.size / memberCount;
        const overlap = measurement.memberSiteIds.filter(siteId => core.has(siteId)).length;
        return measurement.arrivalObserved && reachedFraction >= .75
          && overlap / memberCount >= .75
          && overlap / Math.max(1, core.size) >= .75;
      });
      const reachedCompetitors = terminalField.passiveAssemblyMeasurements.filter(measurement => {
        if (matches.length === 1 && measurement === matches[0]) return false;
        const sampleCount = Math.max(1, measurement.sampleCount);
        const coverage = measurement.coverageSum / sampleCount;
        const measuredFraction = measurement.lateReachedSiteIds.size
          / measurement.memberSiteIds.length;
        if (!measurement.arrivalObserved || coverage < .75
          || measurement.coverageResidenceSteps / sampleCount < .75
          || measuredFraction < .75) return false;
        const overlap = measurement.memberSiteIds.filter(siteId => core.has(siteId)).length;
        const smaller = Math.min(measurement.memberSiteIds.length, core.size);
        return overlap / Math.max(1, smaller) < .75;
      });
      if (matches.length === 1 && reachedCompetitors.length === 0) {
        const measurement = matches[0]!;
        const sampleCount = Math.max(1, measurement.sampleCount);
        const coverage = measurement.coverageSum / sampleCount;
        const purity = measurement.puritySum / sampleCount;
        const dwellFraction = measurement.dwellSteps / sampleCount;
        const meanSupport = measurement.memberSiteIds.reduce(
          (sum, siteId) => sum + this.#supportMass[siteId]!, 0)
          / measurement.memberSiteIds.length;
        const measuredSiteIds = [...measurement.lateReachedSiteIds]
          .sort((left, right) => left - right);
        passiveAssembly = { kind: 'unique', measurement, coverage,
          resonance: dwellFraction,
          escapeRate: 1 - dwellFraction,
          returnRate: measurement.returns + measurement.exits === 0
            ? (measurement.dwellSteps > 0 ? 1 : 0)
            : measurement.returns / (measurement.returns + measurement.exits),
          measuredSiteIds,
          terminalActivations: measuredSiteIds.map(siteId => ({ siteId,
            meanActivation: (measurement.integratedMemberActivation.get(siteId) ?? 0)
              / sampleCount })),
          evidenceLevel: this.#evidenceLevel(meanSupport) };
        coreSiteIds = measuredSiteIds;
      }
    }
    // A distributed coactivation assembly is one physical terminal event even
    // when its members occupy several disconnected local basins.  Measure its
    // residence over the union of the selected basins; counting only the
    // primary basin would turn ordinary switching between co-active members
    // into a false escape signal.  Non-assembly readouts retain the historical
    // primary-basin metric exactly.
    let dwellSteps = effectivePrimary.dwell;
    let returns = 0;
    let exits = 0;
    if (coactivationAssembly) {
      // Use member-level residence collected during the same stochastic
      // rollout.  A union of local basin ids would still mistake switching
      // or an unrelated basin for an assembly; these counters require the
      // actual repeated population's activation quorum at each sample.
      dwellSteps = terminalField.coactivationResidentDwellSteps;
      returns = terminalField.coactivationResidenceReturns;
      exits = terminalField.coactivationResidenceExits;
    } else {
      for (let index = 1; index < terminalField.coDominantHistory.length; index += 1) {
        const wasCore = terminalField.coDominantHistory[index - 1]!.includes(effectivePrimary.basinIndex);
        const isCore = terminalField.coDominantHistory[index]!.includes(effectivePrimary.basinIndex);
        if (!wasCore && isCore) returns += 1;
        if (wasCore && !isCore) exits += 1;
      }
    }
    const meanSupport = coreSiteIds.reduce((sum, siteId) => sum + this.#supportMass[siteId]!, 0) / coreSiteIds.length;
    return {
      version: "DistributedAttractorReadoutV1",
      coreSiteIds,
      dwellSteps,
      returnRate: returns + exits === 0 ? 1 : returns / (returns + exits),
      escapeRate: 1 - dwellSteps / terminalField.sampleCount,
      evidenceLevel: this.#evidenceLevel(meanSupport),
      ambiguous: (selectedBasins.length > 1 && !coactivationAssembly)
        || (passiveAssembly.kind === "ambiguous" && !passiveResolvedByTerminalTail)
        || (materiallySeededBasins.length > 1 && !coactivationAssembly),
      terminalActivations,
      ...(coactivationAssembly ? {
        coactivationAssemblyId: terminalField.coactivationAssembly!.assemblyId,
        coactivationCoverage: terminalField.coactivationCoverage,
        coactivationResonance,
      } : {}),
      run,
    };
  }

  /**
   * Apply the same in-place recovery operation with measured, structure-level
   * rates.  The medium object itself is retained so R1/R2/R2A owners holding
   * this reference cannot diverge.  Missing entries deliberately use the
   * frozen base rate; callers must not pass unknown structure identities.
   */
  recoverWithStructureRates(elapsed: number,
    rates: ReadonlyMap<string, number>): void {
    requireNonnegative(elapsed, "elapsed");
    if (rates.size > 0) {
      const known = new Set<string>();
      for (let siteId = 0; siteId < this.siteCount; siteId += 1) known.add(`site:${siteId}`);
      for (const footprint of this.#footprints.values()) known.add(`trace:${footprint.traceId}`);
      for (const bond of this.#localEnhancements.values())
        known.add(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`);
      for (const bond of this.#directedBonds.values())
        known.add(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`);
      for (const assembly of this.#coactivationAssemblies.values())
        known.add(`assembly:${assembly.assemblyId}`);
      for (const [structureId, rate] of rates) {
        if (!known.has(structureId)) throw new Error(`unknown recovery structure: ${structureId}`);
        requireNonnegative(rate, `recovery rate for ${structureId}`);
      }
    }
    const decay = (structureId: string): number =>
      Math.exp(-(rates.get(structureId) ?? this.#config.recoveryRate) * elapsed);
    for (let siteId = 0; siteId < this.siteCount; siteId += 1) {
      const slowFactor = decay(`site:${siteId}`);
      this.#potentialDepth[siteId] = this.#potentialDepth[siteId]! * slowFactor;
      this.#supportMass[siteId] = this.#supportMass[siteId]! * slowFactor;
      this.#activation[siteId] = this.#activation[siteId]!
        * Math.exp(-this.#dissipation[siteId]! * elapsed);
    }
    for (const [key, bond] of this.#localEnhancements) {
      const slowFactor = decay(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`);
      bond.symmetricCoupling *= slowFactor; bond.supportMass *= slowFactor;
      if (bond.supportMass < this.#config.minimumActiveMagnitude) {
        this.#localEnhancements.delete(key);
        this.#localEnhancementAdjacency[bond.fromSiteId]?.delete(bond.toSiteId);
        this.#localEnhancementAdjacency[bond.toSiteId]?.delete(bond.fromSiteId);
      }
    }
    for (const [key, bond] of this.#directedBonds) {
      const slowFactor = decay(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`);
      bond.directedConductance *= slowFactor; bond.supportMass *= slowFactor;
      if (bond.supportMass < this.#config.minimumActiveMagnitude) this.#deleteDirectedBond(key, bond);
    }
    this.#directedOutgoingConductance.fill(0);
    for (const bond of this.#directedBonds.values()) {
      this.#directedOutgoingConductance[bond.fromSiteId]
        = this.#directedOutgoingConductance[bond.fromSiteId]! + bond.directedConductance;
    }
    for (const footprint of this.#footprints.values())
      footprint.supportMass *= decay(`trace:${footprint.traceId}`);
    for (const assembly of this.#coactivationAssemblies.values()) {
      assembly.supportMass *= decay(`assembly:${assembly.assemblyId}`);
      assembly.lastUpdatedAt = this.#logicalTime;
    }
    this.#invalidateAttractorTopology();
    this.#logicalTime += elapsed;
  }

  recover(elapsed: number): void {
    this.recoverWithStructureRates(elapsed, new Map());
  }

  site(siteId: number): DistributedSiteStateV1 {
    this.#assertSiteId(siteId);
    return {
      siteId,
      coordinate: this.#coordinateOf(siteId),
      potentialDepth: this.#potentialDepth[siteId]!,
      activation: this.#activation[siteId]!,
      dissipation: this.#dissipation[siteId]!,
      supportMass: this.#supportMass[siteId]!,
      lastUpdatedAt: this.#lastUpdatedAt[siteId]!,
    };
  }

  bondsFrom(siteId: number): readonly DistributedBondStateV1[] {
    this.#assertSiteId(siteId);
    const bonds: DistributedBondStateV1[] = this.#localNeighbors(siteId).map((neighbor) => {
      const enhancement = this.#localEnhancements.get(localBondKey(siteId, neighbor));
      return {
        fromSiteId: siteId,
        toSiteId: neighbor,
        symmetricCoupling: this.#config.localCoupling + (enhancement?.symmetricCoupling ?? 0),
        directedConductance: 0,
        supportMass: enhancement?.supportMass ?? 0,
        lastUpdatedAt: enhancement?.lastUpdatedAt ?? 0,
        kind: "local",
      };
    });
    for (const target of this.#directedOut.get(siteId) ?? []) {
      const bond = this.#directedBonds.get(bondKey(siteId, target));
      if (bond !== undefined) bonds.push(snapshotBond(bond));
    }
    return bonds.sort((left, right) => left.toSiteId - right.toSiteId || left.kind.localeCompare(right.kind));
  }

  footprint(traceId: string): DistributedTraceFootprintV1 | null {
    const footprint = this.#footprints.get(traceId);
    return footprint === undefined ? null : snapshotFootprint(footprint);
  }

  /**
   * Return the derived index of repeated same-time terminal populations.
   * This is read-only evidence over real footprints; it is not a rule table
   * and cannot be used to create or strengthen a field.
   */
  coactivationAssemblies(): readonly DistributedCoactivationAssemblyEvidenceV1[] {
    return [...this.#coactivationAssemblies.values()]
      .map((assembly) => this.#snapshotCoactivationAssembly(assembly))
      .sort((left, right) => left.assemblyId.localeCompare(right.assemblyId, 'en'));
  }

  isFootprintActive(traceOrId: string | { readonly footprintId: string }): boolean {
    const traceId = typeof traceOrId === "string" ? traceOrId : traceOrId.footprintId;
    const footprint = this.#footprints.get(traceId);
    return footprint !== undefined && this.#isFootprintActiveInternal(footprint);
  }

  #isFootprintActiveInternal(footprint: MutableFootprint): boolean {
    if (footprint.supportMass < this.#config.minimumActiveMagnitude) return false;
    const terminal = terminalPopulation(footprint) ?? footprint.siteIds;
    const activeTerminal = terminal.filter((siteId) =>
      this.#potentialDepth[siteId]! >= this.#config.minimumActiveMagnitude
      && this.#supportMass[siteId]! >= this.#config.minimumActiveMagnitude).length;
    if (activeTerminal / Math.max(1, terminal.length) < 0.25) return false;
    if (footprint.pulseCount <= 1 || footprint.bondReferences.length === 0) return true;
    return footprint.bondReferences.some((reference) => this.#bondReferenceActive(reference));
  }

  snapshot(): DistributedMediumSnapshotV1 {
    const sites = Array.from({ length: this.siteCount }, (_, siteId) => this.site(siteId));
    const learnedBonds = [
      ...[...this.#localEnhancements.values()].map(snapshotBond),
      ...[...this.#directedBonds.values()].map(snapshotBond),
    ].sort((left, right) => left.fromSiteId - right.fromSiteId || left.toSiteId - right.toSiteId
      || left.kind.localeCompare(right.kind));
    const bindings: DistributedBindingSnapshotV1[] = [...this.#bindingSites]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bindingId, siteIds]) => ({ bindingId, siteIds: [...siteIds] }));
    const coactivationAssemblies = this.coactivationAssemblies();
    return {
      version: "DistributedMediumSnapshotV1",
      config: cloneConfig(this.#config),
      logicalTime: this.#logicalTime,
      tiles: this.#tiles.map((tile) => ({ ...tile, tileCoordinate: [...tile.tileCoordinate] as [number, number, number] })),
      sites,
      learnedBonds,
      localBondCount: this.#countLocalBonds(),
      bindings,
      footprints: [...this.#footprints.values()].sort((left, right) => left.traceId.localeCompare(right.traceId)).map(snapshotFootprint),
      ...(coactivationAssemblies.length === 0 ? {} : { coactivationAssemblies }),
      allocationSequence: this.#allocationSequence,
      metropolisSequence: this.#metropolisSequence,
    };
  }

  readonlyClone(): ReadOnlyDistributedPhysicalMedium3DV1 {
    return new ReadOnlyDistributedPhysicalMedium3DV1(this.snapshot());
  }

  #validateEpisode(episode: DistributedEpisodeV1, strength: number): void {
    if (episode.version !== "DistributedEpisodeV1" || episode.provenance !== "trusted-real-event") {
      throw new Error("distributed deposition requires a trusted real event");
    }
    if (episode.traceId.length === 0 || episode.pulses.length === 0) throw new RangeError("episode must be non-empty");
    requirePositive(strength, "episode strength");
    let previousOffset = -Infinity;
    for (const pulse of episode.pulses) {
      if (pulse.version !== "SparseFieldPulseV1" || pulse.pulseId === "" || pulse.drives.length === 0) {
        throw new Error("invalid sparse field pulse");
      }
      requireNonnegative(pulse.offset, "pulse offset");
      if (pulse.dwellSeconds !== undefined) requirePositive(pulse.dwellSeconds, "pulse dwellSeconds");
      if (pulse.offset < previousOffset) throw new Error("episode pulses must be time ordered");
      previousOffset = pulse.offset;
      const seen = new Set<number>();
      for (const drive of pulse.drives) {
        this.#assertSiteId(drive.siteId);
        requirePositive(drive.intensity, "drive intensity");
        if (drive.intensity > 1) throw new RangeError("drive intensity must not exceed 1");
        if (seen.has(drive.siteId)) throw new Error("a pulse cannot drive the same site twice");
        seen.add(drive.siteId);
      }
    }
    for (const eligibility of episode.temporalEligibility ?? []) {
      if (!Number.isInteger(eligibility.fromPulseIndex)
        || !Number.isInteger(eligibility.toPulseIndex)
        || eligibility.fromPulseIndex < 0
        || eligibility.toPulseIndex >= episode.pulses.length
        || eligibility.fromPulseIndex >= eligibility.toPulseIndex) {
        throw new RangeError("temporal eligibility indexes must name an earlier and a later real pulse");
      }
      requirePositive(eligibility.strength, "temporal eligibility strength");
      if (eligibility.strength > 1) throw new RangeError("temporal eligibility strength cannot exceed one");
    }
  }

  #seedProbeDrives(activation: Float64Array,
    drives: readonly SparseFieldDriveV1[]): void {
    for (const drive of drives) {
      this.#assertSiteId(drive.siteId);
      activation[drive.siteId] = Math.max(drive.intensity, activation[drive.siteId]!);
    }
  }

  #bondReferenceActive(reference: DistributedBondReferenceV1): boolean {
    const bond = reference.kind === "local"
      ? this.#localEnhancements.get(localBondKey(reference.fromSiteId, reference.toSiteId))
      : this.#directedBonds.get(bondKey(reference.fromSiteId, reference.toSiteId));
    return bond !== undefined && bond.supportMass >= this.#config.minimumActiveMagnitude
      && (reference.kind === "local"
        ? bond.symmetricCoupling >= this.#config.minimumActiveMagnitude
        : bond.directedConductance >= this.#config.minimumActiveMagnitude);
  }

  #adaptR1Episode(episode: R1CompatibleEpisodeV1): DistributedEpisodeV1 {
    if (episode.eventId.length === 0 || episode.pulses.length === 0) throw new Error("invalid R1 distributed episode");
    let offset = 0;
    return {
      version: "DistributedEpisodeV1",
      traceId: episode.eventId,
      provenance: "trusted-real-event",
      pulses: episode.pulses.map((pulse) => {
        requireNonnegative(pulse.dwellSeconds, "R1 pulse dwellSeconds");
        const converted: SparseFieldPulseV1 = {
          version: "SparseFieldPulseV1",
          pulseId: `${episode.eventId}:pulse:${pulse.ordinal}`,
          offset,
          dwellSeconds: pulse.dwellSeconds,
          drives: pulse.drives.map((drive) => ({ ...drive })),
        };
        offset += pulse.dwellSeconds;
        return converted;
      }),
    };
  }

  #strengthenLocalBond(left: number, right: number, amount: number): DistributedBondReferenceV1 {
    const key = localBondKey(left, right);
    let bond = this.#localEnhancements.get(key);
    if (bond === undefined) {
      const [fromSiteId, toSiteId] = left < right ? [left, right] : [right, left];
      bond = {
        fromSiteId,
        toSiteId,
        symmetricCoupling: 0,
        directedConductance: 0,
        supportMass: 0,
        lastUpdatedAt: this.#logicalTime,
        kind: "local",
      };
      this.#localEnhancements.set(key, bond);
      const leftAdjacency = this.#localEnhancementAdjacency[bond.fromSiteId]
        ?? new Map<number, MutableBond>();
      const rightAdjacency = this.#localEnhancementAdjacency[bond.toSiteId]
        ?? new Map<number, MutableBond>();
      leftAdjacency.set(bond.toSiteId, bond);
      rightAdjacency.set(bond.fromSiteId, bond);
      this.#localEnhancementAdjacency[bond.fromSiteId] = leftAdjacency;
      this.#localEnhancementAdjacency[bond.toSiteId] = rightAdjacency;
    }
    bond.symmetricCoupling += this.#config.symmetricLearningRate * amount;
    bond.supportMass += amount;
    bond.lastUpdatedAt = this.#logicalTime;
    return { fromSiteId: bond.fromSiteId, toSiteId: bond.toSiteId, kind: "local" };
  }

  #strengthenDirectedBond(fromSiteId: number, toSiteId: number, amount: number): DistributedBondReferenceV1 | null {
    if (fromSiteId === toSiteId) return null;
    const key = bondKey(fromSiteId, toSiteId);
    let bond = this.#directedBonds.get(key);
    if (bond === undefined) {
      const outgoing = this.#directedOut.get(fromSiteId) ?? new Set<number>();
      if (outgoing.size >= this.#config.maxPlasticLongRangeOut) return null;
      bond = {
        fromSiteId,
        toSiteId,
        symmetricCoupling: 0,
        directedConductance: 0,
        supportMass: 0,
        lastUpdatedAt: this.#logicalTime,
        kind: "plastic-directed",
      };
      this.#directedBonds.set(key, bond);
      outgoing.add(toSiteId);
      this.#directedOut.set(fromSiteId, outgoing);
      const incoming = this.#directedIn.get(toSiteId) ?? new Set<number>();
      incoming.add(fromSiteId);
      this.#directedIn.set(toSiteId, incoming);
      const outgoingAdjacency = this.#directedOutgoingAdjacency[fromSiteId]
        ?? new Map<number, MutableBond>();
      const incomingAdjacency = this.#directedIncomingAdjacency[toSiteId]
        ?? new Map<number, MutableBond>();
      outgoingAdjacency.set(toSiteId, bond);
      incomingAdjacency.set(fromSiteId, bond);
      this.#directedOutgoingAdjacency[fromSiteId] = outgoingAdjacency;
      this.#directedIncomingAdjacency[toSiteId] = incomingAdjacency;
    }
    const conductanceIncrease = this.#config.directedLearningRate * amount;
    bond.directedConductance += conductanceIncrease;
    this.#directedOutgoingConductance[fromSiteId]
      = this.#directedOutgoingConductance[fromSiteId]! + conductanceIncrease;
    bond.supportMass += amount;
    bond.lastUpdatedAt = this.#logicalTime;
    return { fromSiteId, toSiteId, kind: "plastic-directed" };
  }

  /**
   * Learn a sparse temporal fibre between two actually co-active populations.
   *
   * Existing channels whose targets are present in the new pulse are always
   * reinforced.  New channels compete only for the remaining width of this
   * observed population's fibre (two sites), rather than filling the global
   * eight-edge limit.  Consequently a repeatedly observed continuation gets
   * deeper without excluding a later, physically distinct continuation.
   *
   * The competition sees only target-site field state, target intensity and
   * local six-neighbour co-activation.  The tiny stochastic term comes from
   * the medium seed, committed episode ordinal, temporal edge ordinal and
   * physical source identity.  Trace labels, result labels and input hashes
   * never participate.
   */
  #learnDirectedPopulationTransition(
    before: SparseFieldPulseV1,
    after: SparseFieldPulseV1,
    pulseIndex: number,
    strength: number,
    bondReferences: Map<string, DistributedBondReferenceV1>,
    populationWidth = NEW_DIRECTED_FIBRE_WIDTH,
  ): void {
    const targets = [...after.drives].sort((left, right) => left.siteId - right.siteId);
    for (const source of [...before.drives].sort((left, right) => left.siteId - right.siteId)) {
      const outgoing = this.#directedOut.get(source.siteId) ?? new Set<number>();
      const represented = targets.filter((target) => outgoing.has(target.siteId));

      for (const target of represented) {
        const reference = this.#strengthenDirectedBond(
          source.siteId,
          target.siteId,
          Math.min(source.intensity, target.intensity) * strength,
        );
        if (reference !== null) bondReferences.set(`directed:${bondKey(source.siteId, target.siteId)}`, reference);
      }

      const remainingPopulationWidth = Math.max(0, populationWidth - represented.length);
      const remainingOutDegree = Math.max(0, this.#config.maxPlasticLongRangeOut - outgoing.size);
      const recruitCount = Math.min(remainingPopulationWidth, remainingOutDegree);
      if (recruitCount === 0) continue;

      const random = this.#plasticCompetitionRandom(source.siteId, pulseIndex);
      const scored = targets
        .filter((target) => !outgoing.has(target.siteId))
        .map((target) => ({
          target,
          score: this.#directedRecruitmentScore(target.siteId, target.intensity) + random.uniform() * 0.02,
        }))
        .sort((left, right) => right.score - left.score || left.target.siteId - right.target.siteId)
        .slice(0, recruitCount);
      for (const { target } of scored) {
        const reference = this.#strengthenDirectedBond(
          source.siteId,
          target.siteId,
          Math.min(source.intensity, target.intensity) * strength,
        );
        if (reference !== null) bondReferences.set(`directed:${bondKey(source.siteId, target.siteId)}`, reference);
      }
    }
  }

  #directedRecruitmentScore(siteId: number, intensity: number): number {
    const neighbors = this.#localNeighbors(siteId);
    const localCoactivation = neighbors.length === 0 ? 0 : neighbors
      .reduce((sum, neighbor) => sum + phi(this.#activation[neighbor]!), 0) / neighbors.length;
    return intensity
      + 0.20 * phi(this.#activation[siteId]!)
      + 0.10 * Math.tanh(this.#potentialDepth[siteId]!)
      + 0.05 * Math.tanh(this.#supportMass[siteId]!)
      + 0.15 * localCoactivation;
  }

  #plasticCompetitionRandom(sourceSiteId: number, pulseIndex: number): SplitMix64 {
    const episodeOrdinal = this.#footprints.size + 1;
    const seed = BigInt.asUintN(64,
      parseSeed(this.#config.seedHex)
      ^ BigInt(episodeOrdinal) * 0x9e3779b97f4a7c15n
      ^ BigInt(pulseIndex + 1) * 0xbf58476d1ce4e5b9n
      ^ BigInt(sourceSiteId + 1) * 0x94d049bb133111ebn);
    return new SplitMix64(seed);
  }

  #restoreBond(snapshot: DistributedBondStateV1): void {
    this.#assertSiteId(snapshot.fromSiteId);
    this.#assertSiteId(snapshot.toSiteId);
    requireNonnegative(snapshot.symmetricCoupling, "bond symmetricCoupling");
    requireNonnegative(snapshot.directedConductance, "bond directedConductance");
    requireNonnegative(snapshot.supportMass, "bond supportMass");
    if (snapshot.kind === "local") {
      if (!this.#areLocalNeighbors(snapshot.fromSiteId, snapshot.toSiteId)) throw new Error("local bond endpoints are not neighbors");
      const restored = { ...snapshot };
      this.#localEnhancements.set(localBondKey(snapshot.fromSiteId, snapshot.toSiteId), restored);
      const leftAdjacency = this.#localEnhancementAdjacency[snapshot.fromSiteId]
        ?? new Map<number, MutableBond>();
      const rightAdjacency = this.#localEnhancementAdjacency[snapshot.toSiteId]
        ?? new Map<number, MutableBond>();
      leftAdjacency.set(snapshot.toSiteId, restored);
      rightAdjacency.set(snapshot.fromSiteId, restored);
      this.#localEnhancementAdjacency[snapshot.fromSiteId] = leftAdjacency;
      this.#localEnhancementAdjacency[snapshot.toSiteId] = rightAdjacency;
      return;
    }
    const key = bondKey(snapshot.fromSiteId, snapshot.toSiteId);
    const outgoing = this.#directedOut.get(snapshot.fromSiteId) ?? new Set<number>();
    if (!outgoing.has(snapshot.toSiteId) && outgoing.size >= this.#config.maxPlasticLongRangeOut) {
      throw new Error("snapshot exceeds the directed out-degree limit");
    }
    outgoing.add(snapshot.toSiteId);
    this.#directedOut.set(snapshot.fromSiteId, outgoing);
    const incoming = this.#directedIn.get(snapshot.toSiteId) ?? new Set<number>();
    incoming.add(snapshot.fromSiteId);
    this.#directedIn.set(snapshot.toSiteId, incoming);
    const restored = { ...snapshot };
    this.#directedBonds.set(key, restored);
    const outgoingAdjacency = this.#directedOutgoingAdjacency[snapshot.fromSiteId]
      ?? new Map<number, MutableBond>();
    const incomingAdjacency = this.#directedIncomingAdjacency[snapshot.toSiteId]
      ?? new Map<number, MutableBond>();
    outgoingAdjacency.set(snapshot.toSiteId, restored);
    incomingAdjacency.set(snapshot.fromSiteId, restored);
    this.#directedOutgoingAdjacency[snapshot.fromSiteId] = outgoingAdjacency;
    this.#directedIncomingAdjacency[snapshot.toSiteId] = incomingAdjacency;
    this.#directedOutgoingConductance[snapshot.fromSiteId]
      = this.#directedOutgoingConductance[snapshot.fromSiteId]! + snapshot.directedConductance;
  }

  #deleteDirectedBond(key: string, bond: MutableBond): void {
    this.#directedBonds.delete(key);
    this.#directedOutgoingConductance[bond.fromSiteId] = Math.max(0,
      this.#directedOutgoingConductance[bond.fromSiteId]! - bond.directedConductance);
    this.#directedOutgoingAdjacency[bond.fromSiteId]?.delete(bond.toSiteId);
    this.#directedIncomingAdjacency[bond.toSiteId]?.delete(bond.fromSiteId);
    const outgoing = this.#directedOut.get(bond.fromSiteId);
    outgoing?.delete(bond.toSiteId);
    if (outgoing?.size === 0) this.#directedOut.delete(bond.fromSiteId);
    const incoming = this.#directedIn.get(bond.toSiteId);
    incoming?.delete(bond.fromSiteId);
    if (incoming?.size === 0) this.#directedIn.delete(bond.toSiteId);
  }

  #simulate(initial: Float64Array, random: SplitMix64, steps: number,
    terminalField?: TerminalFieldStatisticsV1, globalStepOffset = 0,
    sustainedDriveDrives: readonly SparseFieldDriveV1[] = [],
    assemblyFields: readonly AssemblyFieldStatisticsV1[] = []): {
      activation: Float64Array; run: DistributedFieldRunV1 } {
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError("steps must be a nonnegative integer");
    const activation = new Float64Array(initial);
    const phiActivation = new Float64Array(activation.length);
    for (let siteId = 0; siteId < activation.length; siteId += 1) {
      if (activation[siteId]! < 0) {
        throw new Error("distributed activation must be a nonnegative excitation resource");
      }
      phiActivation[siteId] = phi(activation[siteId]!);
    }
    const frontier = new Set<number>();
    for (let siteId = 0; siteId < activation.length; siteId += 1) {
      if (activation[siteId]! >= this.#config.minimumActiveMagnitude) this.#addFrontier(frontier, siteId);
    }
    let acceptedSteps = 0;
    let rejectedSteps = 0;
    let directedTransportMass = 0;
    const leaderSiteIds: number[] = [];
    const decay = Math.exp(-this.#config.activationDissipation * this.#config.dt);
    const proposalSigma = Math.sqrt(2 * this.#config.diffusion * this.#config.dt);
    for (let step = 0; step < steps; step += 1) {
      // The only extra source admitted during a conditioned query is the
      // actual current R3 boundary. It never changes persistent field state.
      for (const drive of sustainedDriveDrives) {
        const siteId = drive.siteId;
        if (activation[siteId]! < drive.intensity) activation[siteId] = drive.intensity;
        phiActivation[siteId] = phi(activation[siteId]!);
        this.#addFrontier(frontier, siteId);
      }
      if (frontier.size === 0) break;
      const fullFrontier = frontier.size === this.siteCount;
      const frontierIds = fullFrontier
        ? Array.from({ length: this.siteCount }, (_unused, siteId) => siteId)
        : [...frontier].sort((left, right) => left - right);
      for (const siteId of frontierIds) {
        activation[siteId] = activation[siteId]! * decay;
        if (activation[siteId]! < this.#config.minimumActiveMagnitude) activation[siteId] = 0;
        phiActivation[siteId] = phi(activation[siteId]!);
      }
      // A repeated same-time population has a higher-order assembly channel
      // in addition to the lattice's six-neighbour bonds.  This is a
      // transient, finite-conductance exchange over the queried members: it
      // conserves their total excitation and only reduces within-assembly
      // variance.  It never mutates persistent sites/bonds and is absent when
      // no live repeated assembly was found.
      if (terminalField !== undefined) this.#applyTransientCoactivationResonance(
        activation, phiActivation, terminalField, frontier);
      // `steps` denotes physical field ticks, not a number of globally shared
      // lottery tickets.  During one tick every site in the active frontier
      // receives one local Metropolis micro-proposal, in a seeded random
      // order.  This is a random-sequential Monte-Carlo sweep: each microstep
      // still changes only one local site, while a larger distributed pattern
      // no longer makes physical time run proportionally slower.
      // Thermal agitation redistributes a finite excitation population.  It
      // never acts as an independent source term at every lattice site.  The
      // external pulse above is the only source; dissipation and the local
      // Kawasaki exchanges below can only preserve or reduce its total mass.
      // Learned directed channels likewise move that same mass and remain a
      // non-equilibrium flux outside the scalar energy.
      directedTransportMass += this.#applyDirectedTransport(
        activation, phiActivation, frontierIds, frontier);

      const proposalOrder = [...frontierIds];
      // One 64-bit draw names this physical tick.  Cheap deterministic
      // substream then provides the sweep's thermal/acceptance draws.  This is
      // exactly the same stochastic field contract while avoiding millions of
      // BigInt operations.
      const sweepSeed = random.nextUint64();
      const seedLow = Number(sweepSeed & 0xffff_ffffn) >>> 0;
      const seedHigh = Number((sweepSeed >> 32n) & 0xffff_ffffn) >>> 0;
      const sweepUniform = sweepUniformGenerator(seedLow, seedHigh);
      let spareGaussian: number | null = null;
      const sweepGaussian = (): number => {
        if (spareGaussian !== null) {
          const value = spareGaussian;
          spareGaussian = null;
          return value;
        }
        // Marsaglia's polar transform is an exact standard-normal sampler and
        // avoids trigonometric work.  It changes no temperature or diffusion
        // parameter; it only accelerates the same Gaussian proposal law.
        let left = 0, right = 0, radiusSquared = 0;
        do {
          left = 2 * sweepUniform() - 1;
          right = 2 * sweepUniform() - 1;
          radiusSquared = left * left + right * right;
        } while (radiusSquared <= 0 || radiusSquared >= 1);
        const multiplier = Math.sqrt(-2 * Math.log(radiusSquared) / radiusSquared);
        spareGaussian = right * multiplier;
        return left * multiplier;
      };
      for (let index = proposalOrder.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(sweepUniform() * (index + 1));
        [proposalOrder[index], proposalOrder[swap]] = [proposalOrder[swap]!, proposalOrder[index]!];
      }
      for (const siteId of proposalOrder) {
        const neighborCount = this.#localNeighborCounts[siteId]!;
        const neighbor = this.#localNeighborTable[siteId * 6
          + Math.floor(sweepUniform() * neighborCount)]!;
        const current = activation[siteId]!;
        const neighborCurrent = activation[neighbor]!;
        const transfer = proposalSigma * sweepGaussian();
        const proposal = current - transfer;
        const neighborProposal = neighborCurrent + transfer;
        if (proposal < 0 || neighborProposal < 0
          || proposal > this.#config.maximumActivation
          || neighborProposal > this.#config.maximumActivation) {
          rejectedSteps += 1;
          continue;
        }
        // The external conservative field is unchanged by this two-site
        // proposal. Compute it once, then evaluate both states against that
        // exact same local environment. This removes duplicate map/neighbor
        // walks without changing a proposal or its Metropolis probability.
        const enhancement = this.#localEnhancementAdjacency[siteId]?.get(neighbor);
        const mutualCoupling = this.#config.localCoupling
          + (enhancement?.symmetricCoupling ?? 0);
        const leftOutsideField = this.#localConservativeField(siteId, phiActivation)
          - mutualCoupling * phiActivation[neighbor]!;
        const rightOutsideField = this.#localConservativeField(neighbor, phiActivation)
          - mutualCoupling * phiActivation[siteId]!;
        const currentEnergy = this.#pairEnergyWithFixedEnvironment(
          siteId, neighbor, current, neighborCurrent,
          phiActivation[siteId]!, phiActivation[neighbor]!,
          leftOutsideField, rightOutsideField, mutualCoupling);
        const proposalPhi = phi(proposal);
        const neighborProposalPhi = phi(neighborProposal);
        const proposalEnergy = this.#pairEnergyWithFixedEnvironment(
          siteId, neighbor, proposal, neighborProposal,
          proposalPhi, neighborProposalPhi,
          leftOutsideField, rightOutsideField, mutualCoupling);
        // The Gaussian transfer proposal is symmetric and keeps
        // a_i + a_j invariant.  Acceptance therefore remains the frozen
        // exp(-DeltaE/T) rule with no hidden Hastings, threshold, or Top-K
        // correction.
        const delta = proposalEnergy - currentEnergy;
        const acceptanceProbability = delta <= 0 ? 1 : Math.exp(-delta / this.#config.temperature);
        if (sweepUniform() < acceptanceProbability) {
          activation[siteId] = proposal;
          activation[neighbor] = neighborProposal;
          phiActivation[siteId] = proposalPhi;
          phiActivation[neighbor] = neighborProposalPhi;
          acceptedSteps += 1;
          this.#addFrontier(frontier, siteId);
          this.#addFrontier(frontier, neighbor);
        } else {
          rejectedSteps += 1;
        }
      }
      // A zero site with no active neighbour or directed input cannot change
      // under a conservative pair proposal. Remove it even after a wave once
      // touched the complete 32^3 block; otherwise `frontier===siteCount`
      // becomes an irreversible bookkeeping state and every later tick scans
      // thousands of physically inactive locations.
      for (const candidate of [...frontier]) {
        if (activation[candidate] === 0 && this.#allInfluencesInactive(candidate, activation)) frontier.delete(candidate);
      }
      let leader = -1;
      let strongest = this.#config.minimumActiveMagnitude;
      if (fullFrontier) {
        for (let candidate = 0; candidate < this.siteCount; candidate += 1) {
          if (activation[candidate]! > strongest) {
            strongest = activation[candidate]!;
            leader = candidate;
          }
        }
      } else {
        for (const candidate of frontier) {
          if (activation[candidate]! > strongest) {
            strongest = activation[candidate]!;
            leader = candidate;
          }
        }
      }
      if (leader >= 0) leaderSiteIds.push(leader);
      if (terminalField !== undefined) {
        this.#recordTerminalField(terminalField, globalStepOffset + step, activation, frontier);
      }
      if (assemblyFields.length > 0) this.#recordAssemblyFields(
        assemblyFields, globalStepOffset + step, activation);
    }
    const finalFrontier = frontier.size === this.siteCount
      ? Array.from({ length: this.siteCount }, (_unused, siteId) => siteId)
      : [...frontier];
    const finalActivations = finalFrontier
      .filter((siteId) => activation[siteId]! >= this.#config.minimumActiveMagnitude)
      .sort((left, right) => left - right)
      .map((siteId) => ({ siteId, activation: activation[siteId]! }));
    return {
      activation,
      run: {
        version: "DistributedFieldRunV1",
        steps,
        acceptedSteps,
        rejectedSteps,
        directedTransportMass,
        leaderSiteIds,
        finalActivations,
      },
    };
  }

  #applyTransientCoactivationResonance(activation: Float64Array,
    phiActivation: Float64Array, terminalField: TerminalFieldStatisticsV1,
    frontier: Set<number>): void {
    const strength = terminalField.coactivationResonanceStrength;
    if (strength <= 0 || terminalField.coactivationAssembly === null
      || terminalField.coactivationSeedSiteIds.size < 2) return;
    // The query may deliberately omit a quarter of the population during a
    // robustness probe.  Resonance therefore acts on the complete, already
    // learned terminal population, not only on the members that happened to
    // be supplied by this query.  Otherwise an omitted member can never be
    // restored and a distributed assembly is reduced to a set of unrelated
    // local wells.  The population is still selected solely by the live
    // repeated physical assembly above; an arbitrary query cannot create it.
    const sites = [...terminalField.coactivationAssembly.terminalPulseSiteIds]
      .sort((left, right) => left - right);
    // The collective conductance is learned from the assembly's own repeated
    // support mass and the frozen symmetric-learning coefficient.  Applying
    // it for one physical dt yields a finite, mass-conserving transport over
    // the observed population; it is neither a new persistent bond nor a
    // threshold adjustment.  A partial query is proportionally weaker.
    const learnedConductance = Math.min(1,
      terminalField.coactivationAssembly.supportMass * this.#config.symmetricLearningRate);
    const rate = Math.min(.25,
      learnedConductance * this.#config.dt * terminalField.coactivationCoverage);
    if (rate <= 0) return;
    let total = 0;
    for (const siteId of sites) total += activation[siteId]!;
    const mean = total / sites.length;
    const deltas = sites.map(siteId => rate * (mean - activation[siteId]!));
    // Correct floating-point drift so this higher-order exchange is exactly
    // mass-conserving to the precision of the stored field.
    const correction = deltas.reduce((sum, value) => sum + value, 0) / sites.length;
    for (let index = 0; index < sites.length; index += 1) {
      const siteId = sites[index]!;
      const next = activation[siteId]! + deltas[index]! - correction;
      if (next < -EPSILON || next > this.#config.maximumActivation + EPSILON)
        throw new Error('coactivation resonance violated finite excitation bounds');
      activation[siteId] = clamp(next, 0, this.#config.maximumActivation);
      phiActivation[siteId] = phi(activation[siteId]!);
      if (activation[siteId]! >= this.#config.minimumActiveMagnitude)
        this.#addFrontier(frontier, siteId);
    }
  }

  #localConservativeField(siteId: number, phiActivation: Float64Array): number {
    let interaction = 0;
    const offset = siteId * 6;
    const count = this.#localNeighborCounts[siteId]!;
    for (let index = 0; index < count; index += 1) {
      interaction += this.#config.localCoupling * phiActivation[this.#localNeighborTable[offset + index]!]!;
    }
    const enhancements = this.#localEnhancementAdjacency[siteId];
    if (enhancements !== undefined) {
      for (const [neighbor, enhancement] of enhancements) {
        interaction += enhancement.symmetricCoupling * phiActivation[neighbor]!;
      }
    }
    return interaction;
  }

  #pairEnergyWithFixedEnvironment(leftSiteId: number, rightSiteId: number,
    leftActivation: number, rightActivation: number,
    leftPhi: number, rightPhi: number,
    leftOutsideField: number, rightOutsideField: number,
    mutualCoupling: number): number {
    return 0.5 * leftActivation * leftActivation - this.#potentialDepth[leftSiteId]! * leftPhi
      + 0.5 * rightActivation * rightActivation - this.#potentialDepth[rightSiteId]! * rightPhi
      - leftOutsideField * leftPhi - rightOutsideField * rightPhi
      - mutualCoupling * leftPhi * rightPhi;
  }

  #applyDirectedTransport(activation: Float64Array, phiActivation: Float64Array,
    frontierIds: readonly number[], frontier: Set<number>): number {
    const requested: Array<{ source: number; target: number; amount: number }> = [];
    const incoming = new Map<number, number>();
    for (const source of frontierIds) {
      const sourceActivation = activation[source]!;
      if (sourceActivation < this.#config.minimumActiveMagnitude) continue;
      const outgoing = this.#directedOutgoingAdjacency[source];
      if (outgoing === undefined || outgoing.size === 0) continue;
      const candidates: Array<{ target: number; amount: number }> = [];
      let total = 0;
      for (const [target, bond] of outgoing) {
        const targetCapacity = 1 - activation[target]! / this.#config.maximumActivation;
        if (targetCapacity <= 0) continue;
        const amount = this.#config.dt * bond.directedConductance
          * phiActivation[source]! * targetCapacity;
        if (amount <= 0) continue;
        candidates.push({ target, amount });
        total += amount;
      }
      const sourceScale = total <= sourceActivation || total === 0 ? 1 : sourceActivation / total;
      for (const candidate of candidates) {
        const amount = candidate.amount * sourceScale;
        requested.push({ source, target: candidate.target, amount });
        incoming.set(candidate.target, (incoming.get(candidate.target) ?? 0) + amount);
      }
    }
    if (requested.length === 0) return 0;
    const targetScale = new Map<number, number>();
    for (const [target, amount] of incoming) {
      const capacity = this.#config.maximumActivation - activation[target]!;
      targetScale.set(target, amount <= capacity || amount === 0 ? 1 : capacity / amount);
    }
    const deltas = new Map<number, number>();
    for (const transfer of requested) {
      const amount = transfer.amount * targetScale.get(transfer.target)!;
      deltas.set(transfer.source, (deltas.get(transfer.source) ?? 0) - amount);
      deltas.set(transfer.target, (deltas.get(transfer.target) ?? 0) + amount);
    }
    let transportedMass = 0;
    for (const [siteId, delta] of deltas) {
      const next = activation[siteId]! + delta;
      if (next < -EPSILON || next > this.#config.maximumActivation + EPSILON) {
        throw new Error("directed transport violated finite excitation bounds");
      }
      activation[siteId] = clamp(next, 0, this.#config.maximumActivation);
      phiActivation[siteId] = phi(activation[siteId]!);
      if (activation[siteId]! >= this.#config.minimumActiveMagnitude) this.#addFrontier(frontier, siteId);
    }
    for (const transfer of requested) {
      transportedMass += transfer.amount * targetScale.get(transfer.target)!;
    }
    return transportedMass;
  }

  #allInfluencesInactive(siteId: number, activation: Float64Array): boolean {
    if (this.#localNeighbors(siteId).some((neighbor) => activation[neighbor]! >= this.#config.minimumActiveMagnitude)) {
      return false;
    }
    for (const source of this.#directedIn.get(siteId) ?? []) {
      if (activation[source]! >= this.#config.minimumActiveMagnitude) return false;
    }
    return true;
  }

  #addFrontier(frontier: Set<number>, siteId: number): void {
    if (frontier.size === this.siteCount) return;
    frontier.add(siteId);
    if (frontier.size === this.siteCount) return;
    for (const neighbor of this.#localNeighbors(siteId)) frontier.add(neighbor);
    for (const target of this.#directedOut.get(siteId) ?? []) frontier.add(target);
  }

  #evidenceLevel(meanSupport: number): DistributedEvidenceLevelV1 {
    if (meanSupport >= 8) return "predictive-stable";
    if (meanSupport >= 2) return "repeated-correlation";
    if (meanSupport > 0) return "single-observation";
    return "none";
  }

  #invalidateAttractorTopology(): void {
    this.#attractorTopologyRevision += 1;
    this.#cachedAttractorTopology = null;
  }

  #localAttractorTopology(): LocalAttractorTopologyV1 {
    if (this.#cachedAttractorTopology?.revision === this.#attractorTopologyRevision) {
      return this.#cachedAttractorTopology.value;
    }
    const minimum = this.#config.minimumActiveMagnitude;
    const parent = new Int32Array(this.siteCount).fill(-1);
    for (let siteId = 0; siteId < this.siteCount; siteId += 1) {
      if (this.#potentialDepth[siteId]! >= minimum && this.#supportMass[siteId]! >= minimum) {
        parent[siteId] = siteId;
      }
    }
    const find = (siteId: number): number => {
      let root = siteId;
      while (parent[root] !== root) root = parent[root]!;
      let current = siteId;
      while (parent[current] !== current) {
        const next = parent[current]!;
        parent[current] = root;
        current = next;
      }
      return root;
    };
    const union = (left: number, right: number): void => {
      const leftRoot = find(left), rightRoot = find(right);
      if (leftRoot !== rightRoot) parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    };
    for (const bond of this.#localEnhancements.values()) {
      if (bond.symmetricCoupling < minimum || bond.supportMass < minimum) continue;
      if (parent[bond.fromSiteId]! < 0 || parent[bond.toSiteId]! < 0) continue;
      union(bond.fromSiteId, bond.toSiteId);
    }
    const groups = new Map<number, number[]>();
    for (let siteId = 0; siteId < this.siteCount; siteId += 1) {
      if (parent[siteId]! < 0) continue;
      const root = find(siteId), values = groups.get(root) ?? [];
      values.push(siteId); groups.set(root, values);
    }
    const basinSiteIds = [...groups.values()]
      .map(siteIds => siteIds.sort((left, right) => left - right))
      .sort((left, right) => left[0]! - right[0]!);
    const basinIndexBySite = new Int32Array(this.siteCount).fill(-1);
    basinSiteIds.forEach((siteIds, basinIndex) => {
      siteIds.forEach(siteId => { basinIndexBySite[siteId] = basinIndex; });
    });
    const value: LocalAttractorTopologyV1 = { basinSiteIds, basinIndexBySite };
    this.#cachedAttractorTopology = { revision: this.#attractorTopologyRevision, value };
    return value;
  }

  #newTerminalFieldStatistics(totalSteps: number,
    excludedReadoutSiteIds: readonly number[] = [],
    coactivationSeedSiteIds: readonly number[] = [],
    allowPassiveAssemblyReadout = false): TerminalFieldStatisticsV1 {
    const topology = this.#localAttractorTopology();
    const excludedReadoutBasins = new Set<number>();
    for (const siteId of excludedReadoutSiteIds) {
      const basinIndex = topology.basinIndexBySite[siteId]!;
      if (basinIndex >= 0) excludedReadoutBasins.add(basinIndex);
    }
    const normalizedSeeds = [...new Set(coactivationSeedSiteIds)].sort((left, right) => left - right);
    normalizedSeeds.forEach((siteId) => this.#assertSiteId(siteId));
    const coactivation = normalizedSeeds.length > 1
      ? this.#findCoactivationAssembly(normalizedSeeds) : null;
    // Repetition and coverage determine a bounded transient conductance.  It
    // is never persisted as a bond and cannot operate without a live physical
    // assembly; a query over unrelated populations therefore receives zero.
    const coactivationResonanceStrength = coactivation === null ? 0
      : clamp((coactivation.assembly.independentEpisodeCount / 8)
        * coactivation.coverage, 0, 1);
    const passiveAssemblyMeasurements = allowPassiveAssemblyReadout
      && coactivation === null
      ? [...this.#coactivationAssemblies.values()]
        // A passive candidate must already have repeated physical support.
        // Active footprint checks mirror #findCoactivationAssembly and keep
        // recovered metadata from becoming a query result.
        .filter((assembly) => assembly.terminalPulseSiteIds.length >= 2
          && assembly.supportMass >= this.#config.minimumActiveMagnitude
          && [...assembly.memberTraceIds].filter((traceId) => {
            const footprint = this.#footprints.get(traceId);
            return footprint !== undefined && this.#isFootprintActiveInternal(footprint);
          }).length >= 2)
        .map((assembly) => {
          const memberSiteIds = [...assembly.terminalPulseSiteIds]
            .sort((left, right) => left - right);
          return {
            assembly: this.#snapshotCoactivationAssembly(assembly),
            memberSiteIds,
            reachedSiteIds: new Set<number>(),
            lateReachedSiteIds: new Set<number>(),
            integratedMemberActivation: new Map<number, number>(),
            sampleCount: 0,
            coverageSum: 0,
            puritySum: 0,
            coverageResidenceSteps: 0,
            terminalCoverageResidenceSteps: 0,
            coveragePreviousResident: false,
            jointSamples: 0,
            dwellSteps: 0,
            returns: 0,
            exits: 0,
            previousResident: false,
            terminalResidenceSteps: 0,
            arrivalObserved: false,
          } satisfies PassiveAssemblyMeasurementV1;
        })
      : [];
    const passiveAssemblyDomainSiteIds = [...new Set(passiveAssemblyMeasurements
      .flatMap(measurement => measurement.memberSiteIds))]
      .sort((left, right) => left - right);
    return { topology, totalSteps, excludedReadoutBasins,
      coactivationSeedSiteIds: new Set(normalizedSeeds),
      coactivationAssembly: coactivation?.assembly ?? null,
      coactivationCoverage: coactivation?.coverage ?? 0,
      coactivationResonanceStrength,
      coactivationJointSamples: 0,
      coactivationSamples: 0,
      coactivationResidentDwellSteps: 0,
      coactivationResidenceReturns: 0,
      coactivationResidenceExits: 0,
      coactivationPreviousResident: false,
      passiveAssemblyMeasurements,
      passiveAssemblyDomainSiteIds,
      allowPassiveAssemblyReadout,
      coDominantCounts: new Float64Array(topology.basinSiteIds.length),
      integratedBasinMass: new Float64Array(topology.basinSiteIds.length),
      integratedSiteActivation: new Float64Array(this.siteCount),
      coDominantHistory: [], sampleCount: 0 };
  }

  #recordCoactivationAssembly(footprint: MutableFootprint): void {
    // Only the final pulse is a terminal population.  For old snapshots that
    // lack pulse-level data on a multi-pulse episode, an empty list is used;
    // the union of all pulses must never be mistaken for same-time activity.
    const terminal = terminalPopulation(footprint) ?? [];
    const normalized = [...new Set(terminal)].sort((left, right) => left - right);
    if (normalized.length < 2) return;
    const assemblyId = coactivationAssemblyId(normalized);
    const existing = this.#coactivationAssemblies.get(assemblyId);
    if (existing === undefined) {
      this.#coactivationAssemblies.set(assemblyId, {
        assemblyId,
        terminalPulseSiteIds: normalized,
        memberTraceIds: new Set([footprint.traceId]),
        supportMass: footprint.supportMass,
        lastUpdatedAt: footprint.depositedAt,
      });
      return;
    }
    existing.memberTraceIds.add(footprint.traceId);
    existing.supportMass += footprint.supportMass;
    existing.lastUpdatedAt = Math.max(existing.lastUpdatedAt, footprint.depositedAt);
  }

  #snapshotCoactivationAssembly(assembly: MutableCoactivationAssembly):
    DistributedCoactivationAssemblyEvidenceV1 {
    const memberTraceIds = [...assembly.memberTraceIds].sort((left, right) =>
      left.localeCompare(right, 'en'));
    return {
      version: 'DistributedCoactivationAssemblyEvidenceV1',
      assemblyId: assembly.assemblyId,
      terminalPulseSiteIds: [...assembly.terminalPulseSiteIds],
      memberTraceIds,
      independentEpisodeCount: memberTraceIds.length,
      supportMass: assembly.supportMass,
      lastUpdatedAt: assembly.lastUpdatedAt,
    };
  }

  #restoreCoactivationAssembly(snapshot: DistributedCoactivationAssemblyEvidenceV1): void {
    if (snapshot.version !== 'DistributedCoactivationAssemblyEvidenceV1')
      throw new Error('unsupported distributed coactivation assembly');
    const terminalPulseSiteIds = [...new Set(snapshot.terminalPulseSiteIds)]
      .sort((left, right) => left - right);
    if (terminalPulseSiteIds.length < 2
      || terminalPulseSiteIds.length !== snapshot.terminalPulseSiteIds.length
      || terminalPulseSiteIds.some(siteId => {
        try { this.#assertSiteId(siteId); return false; } catch { return true; }
      })) {
      throw new Error('invalid distributed coactivation assembly population');
    }
    if (snapshot.assemblyId !== coactivationAssemblyId(terminalPulseSiteIds))
      throw new Error('distributed coactivation assembly identity mismatch');
    if (this.#coactivationAssemblies.has(snapshot.assemblyId))
      throw new Error('duplicate distributed coactivation assembly');
    const memberTraceIds = [...new Set(snapshot.memberTraceIds)].sort((left, right) =>
      left.localeCompare(right, 'en'));
    if (memberTraceIds.length !== snapshot.memberTraceIds.length || memberTraceIds.length < 1
      || memberTraceIds.some(traceId => {
        const footprint = this.#footprints.get(traceId);
        const terminal = footprint === undefined ? null : terminalPopulation(footprint);
        return terminal === null || !sameNumbers(terminal, terminalPulseSiteIds);
      }))
      throw new Error('distributed coactivation assembly member mismatch');
    requireNonnegative(snapshot.supportMass, 'coactivation assembly supportMass');
    requireNonnegative(snapshot.lastUpdatedAt, 'coactivation assembly lastUpdatedAt');
    if (snapshot.independentEpisodeCount !== memberTraceIds.length)
      throw new Error('distributed coactivation assembly episode count mismatch');
    this.#coactivationAssemblies.set(snapshot.assemblyId, {
      assemblyId: snapshot.assemblyId,
      terminalPulseSiteIds,
      memberTraceIds: new Set(memberTraceIds),
      supportMass: snapshot.supportMass,
      lastUpdatedAt: snapshot.lastUpdatedAt,
    });
  }

  #findCoactivationAssembly(seedSiteIds: readonly number[]): {
    readonly assembly: DistributedCoactivationAssemblyEvidenceV1;
    readonly coverage: number;
  } | null {
    const normalized = [...new Set(seedSiteIds)].sort((left, right) => left - right);
    const candidates: Array<{
      readonly assembly: DistributedCoactivationAssemblyEvidenceV1;
      readonly coverage: number;
      readonly activeMemberCount: number;
    }> = [];
    for (const assembly of this.#coactivationAssemblies.values()) {
      const terminal = assembly.terminalPulseSiteIds;
      if (terminal.length < normalized.length) continue;
      const terminalSet = new Set(terminal);
      if (!normalized.every((siteId) => terminalSet.has(siteId))) continue;
      const coverage = normalized.length / terminal.length;
      // Production branch discovery removes one quarter of a terminal
      // population for a perturbation.  A smaller arbitrary subset is not
      // enough evidence that the query addresses this same assembly.
      if (coverage < .75) continue;
      const activeMemberTraceIds = [...new Set(assembly.memberTraceIds)].filter(traceId => {
        const footprint = this.#footprints.get(traceId);
        return footprint !== undefined && this.#isFootprintActiveInternal(footprint);
      });
      if (activeMemberTraceIds.length < 2) continue;
      candidates.push({ assembly: this.#snapshotCoactivationAssembly({
        ...assembly, memberTraceIds: new Set(activeMemberTraceIds),
      }), coverage, activeMemberCount: activeMemberTraceIds.length });
    }
    candidates.sort((left, right) => right.coverage - left.coverage
      || right.activeMemberCount - left.activeMemberCount
      || left.assembly.assemblyId.localeCompare(right.assembly.assemblyId, 'en'));
    const selected = candidates[0];
    return selected === undefined ? null : { assembly: selected.assembly, coverage: selected.coverage };
  }

  #normalizeAssemblySiteIds(siteIds: readonly number[], label: string): number[] {
    const normalized = [...new Set(siteIds)].sort((left, right) => left - right);
    if (normalized.length === 0 || normalized.length !== siteIds.length)
      throw new Error(`${label} sites must be non-empty and unique`);
    normalized.forEach(siteId => this.#assertSiteId(siteId));
    return normalized;
  }

  #newAssemblyFieldStatistics(specs: readonly DistributedAssemblyProbeSpecV1[],
    totalSteps: number): AssemblyFieldStatisticsV1[] {
    return specs.map((spec, index) => {
      const candidateSiteIds = this.#normalizeAssemblySiteIds(
        spec.candidateSiteIds, `assembly ${index} candidate`);
      const enclosingDomainSiteIds = this.#normalizeAssemblySiteIds(
        spec.enclosingDomainSiteIds, `assembly ${index} enclosing domain`);
      const domain = new Set(enclosingDomainSiteIds);
      if (candidateSiteIds.some(siteId => !domain.has(siteId)))
        throw new Error(`assembly ${index} candidate is outside its enclosing domain`);
      const omittedSiteIds = spec.omittedSiteIds === undefined ? []
        : this.#normalizeAssemblySiteIds(spec.omittedSiteIds, `assembly ${index} omitted`);
      const candidate = new Set(candidateSiteIds);
      if (omittedSiteIds.some(siteId => !candidate.has(siteId)))
        throw new Error(`assembly ${index} omitted site is outside its candidate`);
      return { candidateSiteIds, candidateSiteSet: candidate,
        enclosingDomainSiteIds, omittedSiteIds, omittedSiteSet: new Set(omittedSiteIds),
        totalSteps, actuallyReachedSiteIds: new Set<number>(),
        integratedCandidateActivation: new Map<number, number>(), sampleCount: 0,
        coverageSum: 0, puritySum: 0, omittedRestorationSum: 0,
        dwellSteps: 0, returns: 0, exits: 0, previousResident: false };
    });
  }

  #recordAssemblyFields(fields: readonly AssemblyFieldStatisticsV1[], globalStep: number,
    activation: Float64Array): void {
    for (const field of fields) {
      if (globalStep < Math.floor(field.totalSteps * .5)) continue;
      let maximumDomainActivation = 0, domainMass = 0, candidateMass = 0;
      for (const siteId of field.enclosingDomainSiteIds) {
        const value = activation[siteId]!;
        maximumDomainActivation = Math.max(maximumDomainActivation, value);
        domainMass += value;
        if (field.candidateSiteSet.has(siteId)) candidateMass += value;
      }
      const significance = Math.max(this.#config.minimumActiveMagnitude,
        maximumDomainActivation * .25);
      let reached = 0, restored = 0;
      for (const siteId of field.candidateSiteIds) {
        if (activation[siteId]! < significance) continue;
        reached += 1;
        field.actuallyReachedSiteIds.add(siteId);
        field.integratedCandidateActivation.set(siteId,
          (field.integratedCandidateActivation.get(siteId) ?? 0) + activation[siteId]!);
        if (field.omittedSiteSet.has(siteId)) restored += 1;
      }
      const coverage = reached / field.candidateSiteIds.length;
      const purity = domainMass <= EPSILON ? 0 : candidateMass / domainMass;
      const omittedRestoration = field.omittedSiteIds.length === 0 ? 1
        : restored / field.omittedSiteIds.length;
      const resident = coverage >= .75 && purity >= .75;
      if (resident) field.dwellSteps += 1;
      if (!field.previousResident && resident && field.sampleCount > 0) field.returns += 1;
      if (field.previousResident && !resident) field.exits += 1;
      field.previousResident = resident;
      field.coverageSum += coverage;
      field.puritySum += purity;
      field.omittedRestorationSum += omittedRestoration;
      field.sampleCount += 1;
    }
  }

  #readAssemblyField(field: AssemblyFieldStatisticsV1,
    _run: DistributedFieldRunV1): DistributedAssemblyResidenceReadoutV1 {
    const count = Math.max(1, field.sampleCount);
    const lateCoverage = field.coverageSum / count;
    const latePurity = field.puritySum / count;
    const omittedSiteRestorationRate = field.omittedRestorationSum / count;
    const escapeRate = field.sampleCount === 0 ? 1 : 1 - field.dwellSteps / field.sampleCount;
    const returnRate = field.returns + field.exits === 0
      ? (field.dwellSteps > 0 ? 1 : 0) : field.returns / (field.returns + field.exits);
    const meanSupport = field.candidateSiteIds.reduce((sum, siteId) =>
      sum + this.#supportMass[siteId]!, 0) / field.candidateSiteIds.length;
    const evidenceLevel = this.#evidenceLevel(meanSupport);
    const stable = evidenceLevel !== 'none' && field.sampleCount > 0
      && field.dwellSteps >= Math.ceil(field.sampleCount * .75)
      && lateCoverage >= .75 && latePurity >= .75
      && omittedSiteRestorationRate >= .75 && escapeRate <= .25;
    return { version: 'DistributedAssemblyResidenceReadoutV1',
      candidateSiteIds: [...field.candidateSiteIds],
      enclosingDomainSiteIds: [...field.enclosingDomainSiteIds],
      actuallyReachedSiteIds: [...field.actuallyReachedSiteIds].sort((left, right) => left - right),
      terminalActivations: [...field.integratedCandidateActivation]
        .map(([siteId, activation]) => ({ siteId,
          meanActivation: activation / count }))
        .sort((left, right) => left.siteId - right.siteId),
      lateCoverage, latePurity, omittedSiteRestorationRate,
      dwellSteps: field.dwellSteps, returnRate, escapeRate, evidenceLevel, stable };
  }

  #recordTerminalField(statistics: TerminalFieldStatisticsV1, globalStep: number,
    activation: Float64Array, frontier: ReadonlySet<number>): void {
    if (statistics.allowPassiveAssemblyReadout
      && statistics.passiveAssemblyMeasurements.length > 0) {
      this.#recordPassiveAssemblyMeasurements(statistics, globalStep, activation, frontier);
    }
    if (globalStep < Math.floor(statistics.totalSteps * .5)) return;
    if (statistics.coactivationAssembly !== null) {
      statistics.coactivationSamples += 1;
      if ([...statistics.coactivationSeedSiteIds].every(siteId =>
        activation[siteId]! >= this.#config.minimumActiveMagnitude)) {
        statistics.coactivationJointSamples += 1;
      }
      // Measure residence on the repeated population itself, rather than on
      // whichever local basin happens to carry the largest instantaneous
      // mass.  A member is resident only when its real transient activation
      // is above the same physical minimum used by ordinary readout; the
      // three-quarter quorum is the existing assembly qualification rule.
      const members = statistics.coactivationAssembly.terminalPulseSiteIds;
      const activeMembers = members.filter(siteId =>
        activation[siteId]! >= this.#config.minimumActiveMagnitude).length;
      const resident = activeMembers / members.length >= .75;
      if (resident) statistics.coactivationResidentDwellSteps += 1;
      if (!statistics.coactivationPreviousResident && resident
        && statistics.coactivationSamples > 1) {
        statistics.coactivationResidenceReturns += 1;
      }
      if (statistics.coactivationPreviousResident && !resident) {
        statistics.coactivationResidenceExits += 1;
      }
      statistics.coactivationPreviousResident = resident;
    }
    const basinMass = new Float64Array(statistics.topology.basinSiteIds.length);
    for (const siteId of frontier) {
      const value = activation[siteId]!;
      if (value < this.#config.minimumActiveMagnitude) continue;
      const basinIndex = statistics.topology.basinIndexBySite[siteId]!;
      if (basinIndex < 0 || statistics.excludedReadoutBasins.has(basinIndex)) continue;
      basinMass[basinIndex] = basinMass[basinIndex]! + value;
      statistics.integratedBasinMass[basinIndex]
        = statistics.integratedBasinMass[basinIndex]! + value;
      statistics.integratedSiteActivation[siteId]
        = statistics.integratedSiteActivation[siteId]! + value;
    }
    const maximumMass = basinMass.reduce((maximum, value) => Math.max(maximum, value), 0);
    const coDominant: number[] = [];
    if (maximumMass >= this.#config.minimumActiveMagnitude) {
      for (let basinIndex = 0; basinIndex < basinMass.length; basinIndex += 1) {
        if (basinMass[basinIndex]! < maximumMass * .9) continue;
        statistics.coDominantCounts[basinIndex]
          = statistics.coDominantCounts[basinIndex]! + 1;
        coDominant.push(basinIndex);
      }
    }
    statistics.coDominantHistory.push(coDominant);
    statistics.sampleCount += 1;
  }

  /**
   * Measure already learned terminal populations as passive masks over this
   * rollout.  No candidate population is injected into `activation`; a site
   * counts only after the same physical minimum used by ordinary readout is
   * reached by the simulation.  The late window supplies the existing
   * three-quarter quorum/dwell/escape gates, while `arrivalObserved` records
   * that at least one member was actually reached by the evolving frontier.
   */
  #recordPassiveAssemblyMeasurements(statistics: TerminalFieldStatisticsV1,
    globalStep: number, activation: Float64Array, frontier: ReadonlySet<number>): void {
    const lateStart = Math.floor(statistics.totalSteps * .5);
    // A passive decoder must distinguish a real terminal concentration from
    // the tiny residual excitation that naturally remains after propagation.
    // Use one common, transient domain for all learned terminal populations;
    // per-candidate thresholds would let every nested/overlapping population
    // normalize its own noise and recreate the old false ambiguity.
    let maximumDomainActivation = 0, domainMass = 0;
    for (const siteId of statistics.passiveAssemblyDomainSiteIds) {
      const value = activation[siteId]!;
      maximumDomainActivation = Math.max(maximumDomainActivation, value);
      domainMass += value;
    }
    const significance = Math.max(this.#config.minimumActiveMagnitude,
      maximumDomainActivation * .25);
    for (const measurement of statistics.passiveAssemblyMeasurements) {
      let activeMembers = 0;
      let allMembersActive = true;
      let frontierArrival = false;
      let candidateMass = 0;
      for (const siteId of measurement.memberSiteIds) {
        const value = activation[siteId]!;
        candidateMass += value;
        const active = value >= significance;
        if (active) {
          activeMembers += 1;
          measurement.reachedSiteIds.add(siteId);
          if (globalStep >= lateStart) {
            measurement.lateReachedSiteIds.add(siteId);
            measurement.integratedMemberActivation.set(siteId,
              (measurement.integratedMemberActivation.get(siteId) ?? 0) + value);
          }
        } else {
          allMembersActive = false;
        }
        if (active && frontier.has(siteId)) frontierArrival = true;
      }
      if (frontierArrival) measurement.arrivalObserved = true;
      if (globalStep < lateStart) continue;
      const coverage = activeMembers / measurement.memberSiteIds.length;
      const purity = domainMass <= EPSILON ? 0 : candidateMass / domainMass;
      const resident = coverage >= .75 && purity >= .75;
      const coverageResident = coverage >= .75;
      measurement.sampleCount += 1;
      measurement.coverageSum += coverage;
      measurement.puritySum += purity;
      if (coverageResident) measurement.coverageResidenceSteps += 1;
      measurement.terminalCoverageResidenceSteps = coverageResident
        ? measurement.terminalCoverageResidenceSteps + 1 : 0;
      measurement.coveragePreviousResident = coverageResident;
      if (allMembersActive) measurement.jointSamples += 1;
      if (resident) measurement.dwellSteps += 1;
      measurement.terminalResidenceSteps = resident
        ? measurement.terminalResidenceSteps + 1 : 0;
      if (!measurement.previousResident && resident && measurement.sampleCount > 1) {
        measurement.returns += 1;
      }
      if (measurement.previousResident && !resident) measurement.exits += 1;
      measurement.previousResident = resident;
    }
  }

  #passiveAssemblyReadout(statistics: TerminalFieldStatisticsV1): PassiveAssemblyReadoutV1 {
    if (!statistics.allowPassiveAssemblyReadout
      || statistics.passiveAssemblyMeasurements.length === 0) {
      return { kind: "none" };
    }
    const candidates = statistics.passiveAssemblyMeasurements.map((measurement) => {
      const sampleCount = Math.max(1, measurement.sampleCount);
      const coverage = measurement.coverageSum / sampleCount;
      const purity = measurement.puritySum / sampleCount;
      const dwellFraction = measurement.dwellSteps / sampleCount;
      const coverageDwellFraction = measurement.coverageResidenceSteps / sampleCount;
      const terminalCoverageDwellFraction = measurement.terminalCoverageResidenceSteps / sampleCount;
      const escapeRate = 1 - dwellFraction;
      const returnRate = measurement.returns + measurement.exits === 0
        ? (measurement.dwellSteps > 0 ? 1 : 0)
        : measurement.returns / (measurement.returns + measurement.exits);
      const meanSupport = measurement.memberSiteIds.reduce(
        (sum, siteId) => sum + this.#supportMass[siteId]!, 0)
        / measurement.memberSiteIds.length;
      const evidenceLevel = this.#evidenceLevel(meanSupport);
      const measuredSiteIds = [...measurement.lateReachedSiteIds]
        .sort((left, right) => left - right);
      const qualifies = measurement.arrivalObserved
        && measurement.sampleCount > 0
        && coverage >= .75
        && purity >= .75
        && dwellFraction >= .75
        && measurement.terminalResidenceSteps >= Math.ceil(sampleCount * .5)
        && escapeRate <= .25
        && evidenceLevel !== "none"
        && measuredSiteIds.length / measurement.memberSiteIds.length >= .75;
      return { measurement, coverage, purity, dwellFraction, coverageDwellFraction,
        terminalCoverageDwellFraction,
        escapeRate, returnRate,
        evidenceLevel, measuredSiteIds, qualifies };
    }).filter((candidate) => candidate.qualifies)
      .sort((left, right) => left.measurement.assembly.assemblyId.localeCompare(
        right.measurement.assembly.assemblyId, "en"));
    // A passive decoder has no semantic evidence with which to rank two
    // physically reached populations.  Even a numerically stronger one must
    // remain ambiguous; selecting it would turn diffuse excitation into a
    // historical result template.  This is stricter than ranking by score and
    // leaves the existing physical thresholds unchanged.
    if (candidates.length === 0) {
      // A diffuse rollout can still reach two independent learned terminal
      // populations with comparable coverage while neither has the .75
      // concentration required for a unique result.  Preserve that physical
      // uncertainty instead of letting the ordinary local-basin fallback
      // choose whichever candidate happens to sort first.  Nested populations
      // are not independent competitors: their overlap is measured against
      // the smaller population and the larger/concentrated population may
      // still be selected by the normal qualification path above.
      const reached = statistics.passiveAssemblyMeasurements.map((measurement) => {
        const sampleCount = Math.max(1, measurement.sampleCount);
        const coverage = measurement.coverageSum / sampleCount;
        const purity = measurement.puritySum / sampleCount;
        const measuredCount = measurement.lateReachedSiteIds.size;
        return { measurement, coverage, purity,
          coverageDwellFraction: measurement.coverageResidenceSteps / sampleCount,
          terminalCoverageDwellFraction: measurement.terminalCoverageResidenceSteps / sampleCount,
          measuredFraction: measuredCount / measurement.memberSiteIds.length };
      }).filter(value => value.measurement.arrivalObserved
        && value.coverage >= .75
        && value.coverageDwellFraction >= .75
        && value.measuredFraction >= .75)
        .sort((left, right) => right.purity - left.purity);
      const top = reached[0];
      const independentCompeting = top === undefined ? [] : reached.filter(candidate => {
        if (candidate === top) return false;
        const left = new Set(top.measurement.memberSiteIds);
        const overlap = candidate.measurement.memberSiteIds
          .filter(siteId => left.has(siteId)).length;
        const smaller = Math.min(top.measurement.memberSiteIds.length,
          candidate.measurement.memberSiteIds.length);
        return overlap / Math.max(1, smaller) < .75;
      });
      if (independentCompeting.length > 0) return { kind: "ambiguous" };
      return { kind: "none" };
    }
    if (candidates.length > 1) return { kind: "ambiguous" };
    const winner = candidates[0]!;
    return { kind: "unique", measurement: winner.measurement,
      coverage: winner.coverage,
      resonance: winner.dwellFraction,
      escapeRate: winner.escapeRate,
      returnRate: winner.returnRate,
      measuredSiteIds: winner.measuredSiteIds,
      terminalActivations: winner.measuredSiteIds.map((siteId) => ({
        siteId,
        meanActivation: (winner.measurement.integratedMemberActivation.get(siteId) ?? 0)
          / Math.max(1, winner.measurement.sampleCount),
      })),
      evidenceLevel: winner.evidenceLevel };
  }

  #unboundCount(): number {
    let count = 0;
    for (const binding of this.#bindings) if (binding === null) count += 1;
    return count;
  }

  #expandNextTile(): void {
    if (this.#tiles.length >= this.#config.maxTiles) throw new MediumCapacityExhaustedError();
    const candidateKeys = new Map<string, readonly [number, number, number]>();
    for (const tile of this.#tiles) {
      const [x, y, z] = tile.tileCoordinate;
      const candidates: readonly (readonly [number, number, number])[] = [
        [x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1],
      ];
      for (const coordinate of candidates) {
        const key = tileKey(coordinate);
        if (!this.#tileIndices.has(key)) candidateKeys.set(key, coordinate);
      }
    }
    const selected = [...candidateKeys.values()].sort((left, right) => {
      const leftDistance = Math.abs(left[0]) + Math.abs(left[1]) + Math.abs(left[2]);
      const rightDistance = Math.abs(right[0]) + Math.abs(right[1]) + Math.abs(right[2]);
      return leftDistance - rightDistance || left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    })[0];
    if (selected === undefined) throw new MediumCapacityExhaustedError();
    this.#expandTile(selected);
  }

  #expandTile(tileCoordinate: readonly [number, number, number]): void {
    if (this.#tiles.length >= this.#config.maxTiles) throw new MediumCapacityExhaustedError();
    if (this.#tileIndices.has(tileKey(tileCoordinate))) throw new Error("duplicate distributed tile");
    if (this.#tiles.length > 0) {
      const adjacent = this.#tiles.some((tile) => {
        const delta = Math.abs(tile.tileCoordinate[0] - tileCoordinate[0])
          + Math.abs(tile.tileCoordinate[1] - tileCoordinate[1])
          + Math.abs(tile.tileCoordinate[2] - tileCoordinate[2]);
        return delta === 1;
      });
      if (!adjacent) throw new Error("distributed tiles must form one continuous six-neighbor medium");
    }
    const tileIndex = this.#tiles.length;
    const firstSiteId = tileIndex * TILE_VOLUME;
    this.#tiles.push({ tileIndex, tileCoordinate: [...tileCoordinate] as [number, number, number], firstSiteId, siteCount: TILE_VOLUME });
    this.#tileIndices.set(tileKey(tileCoordinate), tileIndex);
    const nextLength = this.#tiles.length * TILE_VOLUME;
    this.#potentialDepth = this.#extendFloat(this.#potentialDepth, nextLength);
    this.#activation = this.#extendFloat(this.#activation, nextLength);
    this.#dissipation = this.#extendFloat(this.#dissipation, nextLength, this.#config.activationDissipation);
    this.#supportMass = this.#extendFloat(this.#supportMass, nextLength);
    this.#lastUpdatedAt = this.#extendFloat(this.#lastUpdatedAt, nextLength);
    while (this.#bindings.length < nextLength) this.#bindings.push(null);
    this.#localEnhancementAdjacency.length = nextLength;
    this.#directedOutgoingAdjacency.length = nextLength;
    this.#directedIncomingAdjacency.length = nextLength;
    this.#directedOutgoingConductance = this.#extendFloat(this.#directedOutgoingConductance, nextLength);
    // Tile growth can introduce six-neighbour links across a formerly open
    // boundary.  Rebuild one contiguous table for the whole logical medium so
    // the fast dynamics kernel and the auditable neighbour API see identical
    // cross-block topology rather than page-like seams.
    this.#rebuildLocalNeighborTable();
    this.#invalidateAttractorTopology();
  }

  #extendFloat(source: Float64Array, length: number, fill = 0): Float64Array {
    const result = new Float64Array(length);
    result.set(source);
    if (fill !== 0) result.fill(fill, source.length);
    return result;
  }

  #coordinateOf(siteId: number): readonly [number, number, number] {
    const tileIndex = Math.floor(siteId / TILE_VOLUME);
    const local = siteId % TILE_VOLUME;
    const localX = local % TILE_SIZE;
    const localY = Math.floor(local / TILE_SIZE) % TILE_SIZE;
    const localZ = Math.floor(local / (TILE_SIZE * TILE_SIZE));
    const tile = this.#tiles[tileIndex]!;
    return [
      tile.tileCoordinate[0] * TILE_SIZE + localX,
      tile.tileCoordinate[1] * TILE_SIZE + localY,
      tile.tileCoordinate[2] * TILE_SIZE + localZ,
    ];
  }

  #siteIdAt(coordinate: readonly [number, number, number]): number | null {
    const tileCoordinate: readonly [number, number, number] = [
      Math.floor(coordinate[0] / TILE_SIZE),
      Math.floor(coordinate[1] / TILE_SIZE),
      Math.floor(coordinate[2] / TILE_SIZE),
    ];
    const tileIndex = this.#tileIndices.get(tileKey(tileCoordinate));
    if (tileIndex === undefined) return null;
    const localX = coordinate[0] - tileCoordinate[0] * TILE_SIZE;
    const localY = coordinate[1] - tileCoordinate[1] * TILE_SIZE;
    const localZ = coordinate[2] - tileCoordinate[2] * TILE_SIZE;
    return tileIndex * TILE_VOLUME + localX + localY * TILE_SIZE + localZ * TILE_SIZE * TILE_SIZE;
  }

  #computeLocalNeighbors(siteId: number): number[] {
    const [x, y, z] = this.#coordinateOf(siteId);
    const coordinates: readonly (readonly [number, number, number])[] = [
      [x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1],
    ];
    return coordinates.map((coordinate) => this.#siteIdAt(coordinate))
      .filter((candidate): candidate is number => candidate !== null);
  }

  #rebuildLocalNeighborTable(): void {
    const table = new Int32Array(this.siteCount * 6);
    table.fill(-1);
    const counts = new Uint8Array(this.siteCount);
    for (let siteId = 0; siteId < this.siteCount; siteId += 1) {
      const neighbors = this.#computeLocalNeighbors(siteId);
      counts[siteId] = neighbors.length;
      const offset = siteId * 6;
      for (let index = 0; index < neighbors.length; index += 1) table[offset + index] = neighbors[index]!;
    }
    this.#localNeighborTable = table;
    this.#localNeighborCounts = counts;
  }

  #localNeighbors(siteId: number): number[] {
    const count = this.#localNeighborCounts[siteId]!;
    const offset = siteId * 6;
    const neighbors = new Array<number>(count);
    for (let index = 0; index < count; index += 1) neighbors[index] = this.#localNeighborTable[offset + index]!;
    return neighbors;
  }

  #areLocalNeighbors(left: number, right: number): boolean {
    return this.#localNeighbors(left).includes(right);
  }

  #countLocalBonds(): number {
    let directedCount = 0;
    for (let siteId = 0; siteId < this.siteCount; siteId += 1) directedCount += this.#localNeighbors(siteId).length;
    return directedCount / 2;
  }

  #assertSiteId(siteId: number): void {
    if (!Number.isInteger(siteId) || siteId < 0 || siteId >= this.siteCount) throw new RangeError(`unknown site: ${siteId}`);
  }
}

export class ReadOnlyDistributedPhysicalMedium3DV1 {
  readonly #snapshot: DistributedMediumSnapshotV1;

  constructor(snapshot: DistributedMediumSnapshotV1) {
    this.#snapshot = structuredClone(snapshot) as DistributedMediumSnapshotV1;
  }

  snapshot(): DistributedMediumSnapshotV1 {
    return structuredClone(this.#snapshot) as DistributedMediumSnapshotV1;
  }

  site(siteId: number): DistributedSiteStateV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).site(siteId);
  }

  bondsFrom(siteId: number): readonly DistributedBondStateV1[] {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).bondsFrom(siteId);
  }

  footprint(traceId: string): DistributedTraceFootprintV1 | null {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).footprint(traceId);
  }

  coactivationAssemblies(): readonly DistributedCoactivationAssemblyEvidenceV1[] {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).coactivationAssemblies();
  }

  isFootprintActive(traceId: string): boolean {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).isFootprintActive(traceId);
  }

  settle(seed: bigint | SplitMix64, steps: number): DistributedFieldRunV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).settle(seed, steps);
  }

  probe(seedSiteIds: readonly number[], seed: bigint | SplitMix64, steps: number): DistributedAttractorReadoutV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot).probe(seedSiteIds, seed, steps);
  }

  probeSequential(seedPulses: readonly DistributedProbePulseInputV1[], seed: bigint | SplitMix64,
    steps: number): DistributedAttractorReadoutV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot)
      .probeSequential(seedPulses, seed, steps);
  }

  probeConditionedSequence(conditionSiteIds: DistributedProbePulseInputV1,
    seedPulses: readonly DistributedProbePulseInputV1[], seed: bigint | SplitMix64,
    steps: number): DistributedAttractorReadoutV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot)
      .probeConditionedSequence(conditionSiteIds, seedPulses, seed, steps);
  }

  probeSequentialAtReadout(seedPulses: readonly DistributedProbePulseInputV1[],
    readoutSiteIds: readonly number[], readoutDomainSiteIds: readonly number[],
    seed: bigint | SplitMix64, steps: number): DistributedAttractorReadoutV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot)
      .probeSequentialAtReadout(seedPulses, readoutSiteIds, readoutDomainSiteIds, seed, steps);
  }

  probeConditionedSequenceAtReadout(conditionSiteIds: DistributedProbePulseInputV1,
    seedPulses: readonly DistributedProbePulseInputV1[],
    readoutSiteIds: readonly number[], readoutDomainSiteIds: readonly number[],
    seed: bigint | SplitMix64, steps: number): DistributedAttractorReadoutV1 {
    return DistributedPhysicalMedium3DV1.fromSnapshot(this.#snapshot)
      .probeConditionedSequenceAtReadout(conditionSiteIds, seedPulses,
        readoutSiteIds, readoutDomainSiteIds, seed, steps);
  }

  allocateSites(): never {
    throw new Error("read-only distributed-medium clone rejects allocation");
  }

  allocateSitesNear(): never {
    throw new Error("read-only distributed-medium clone rejects allocation");
  }

  competeForSites(): never {
    throw new Error("read-only distributed-medium clone rejects allocation competition");
  }

  bindSites(): never {
    throw new Error("read-only distributed-medium clone rejects binding");
  }

  applyPulse(): never {
    throw new Error("read-only distributed-medium clone rejects deposition");
  }

  applyEpisode(): never {
    throw new Error("read-only distributed-medium clone rejects deposition");
  }

  recover(): never {
    throw new Error("read-only distributed-medium clone rejects recovery");
  }
}
