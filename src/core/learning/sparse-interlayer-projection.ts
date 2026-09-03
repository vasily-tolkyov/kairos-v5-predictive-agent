import { assert } from '../../util.js';
import { SplitMix64 } from '../random.js';
import type { SparseFieldPulseV1 } from '../physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 } from '../physics/distributed-physical-medium.js';
import type { DistributedSiteDriveV1 } from './distributed-r1-contracts.js';

const PROJECTION_SALT = 0xd1b54a32d192ed03n;
const SOURCE_ID_SALT = 0x94d049bb133111ebn;

export interface SparseInterlayerProjectionBindingV1 {
  readonly sourceSiteId: number;
  readonly targetSiteIds: readonly number[];
  readonly observationCount: number;
}

export interface SparseInterlayerProjectionStateV1 {
  readonly version: 'SparseInterlayerProjectionStateV1';
  readonly projectionId: string;
  readonly seedHex: string;
  readonly allocationSequence: number;
  readonly candidateCount: number;
  readonly winnerCount: number;
  readonly bindings: readonly SparseInterlayerProjectionBindingV1[];
}

export interface SparseInterlayerProjectionConfigV1 {
  readonly projectionId: string;
  readonly seed: bigint;
  readonly candidateCount?: number;
  readonly winnerCount?: number;
}

export interface SparseInterlayerSourcePulseV1 {
  readonly pulseId: string;
  readonly offset: number;
  readonly dwellSeconds?: number;
  readonly drives: readonly DistributedSiteDriveV1[];
  /** Source-lattice adjacency only.  These identities select already bound
   * target fibres as target-lattice neighbourhood anchors; source coordinates
   * never cross the layer boundary. */
  readonly sourceNeighborhoods?: readonly {
    readonly sourceSiteId: number;
    readonly neighborSiteIds: readonly number[];
  }[];
}

function parseSeed(value: string): bigint {
  assert(/^0x[0-9a-f]+$/i.test(value), 'sparse-interlayer-invalid-seed');
  return BigInt(value);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer`);
}

/**
 * Fixed sparse fibres from source lattice sites into an independent target
 * lattice.  A source coordinate never computes a target coordinate: the
 * target medium draws a local unbound candidate population, runs its own local
 * competition, and permanently binds the winners to that source identity.
 */
export class SparseInterlayerProjectionV1 {
  readonly #medium: DistributedPhysicalMedium3DV1;
  readonly #projectionId: string;
  readonly #seed: bigint;
  readonly #candidateCount: number;
  readonly #winnerCount: number;
  #allocationSequence = 0;
  readonly #bindings = new Map<number, SparseInterlayerProjectionBindingV1>();

  constructor(medium: DistributedPhysicalMedium3DV1,
    config: SparseInterlayerProjectionConfigV1,
    state?: SparseInterlayerProjectionStateV1) {
    if (config.projectionId.length === 0) throw new RangeError('projectionId must be non-empty');
    const candidateCount = config.candidateCount ?? 32, winnerCount = config.winnerCount ?? 8;
    assertPositiveInteger(candidateCount, 'candidateCount');
    assertPositiveInteger(winnerCount, 'winnerCount');
    if (winnerCount > candidateCount) throw new RangeError('winnerCount must not exceed candidateCount');
    this.#medium = medium; this.#projectionId = config.projectionId; this.#seed = config.seed;
    this.#candidateCount = candidateCount; this.#winnerCount = winnerCount;
    if (!state) return;
    assert(state.version === 'SparseInterlayerProjectionStateV1'
      && state.projectionId === this.#projectionId && parseSeed(state.seedHex) === this.#seed
      && state.candidateCount === candidateCount && state.winnerCount === winnerCount,
    'sparse-interlayer-state-identity-mismatch');
    this.#allocationSequence = state.allocationSequence;
    for (const value of state.bindings) {
      assert(Number.isInteger(value.sourceSiteId) && value.sourceSiteId >= 0,
        'sparse-interlayer-invalid-source-site');
      assert(value.targetSiteIds.length === winnerCount
        && new Set(value.targetSiteIds).size === value.targetSiteIds.length,
      'sparse-interlayer-invalid-target-fibre');
      assert(!this.#bindings.has(value.sourceSiteId), 'sparse-interlayer-duplicate-source-site');
      const binding = { ...value, targetSiteIds: [...value.targetSiteIds] };
      this.#medium.bindSites(this.#mediumBindingId(value.sourceSiteId), binding.targetSiteIds);
      this.#bindings.set(value.sourceSiteId, binding);
    }
  }

  #mediumBindingId(sourceSiteId: number): string {
    return `interlayer:${this.#projectionId}:source-site:${sourceSiteId}`;
  }

  #ensureBinding(sourceSiteId: number,
    sourceNeighborSiteIds: readonly number[]): SparseInterlayerProjectionBindingV1 {
    if (!Number.isInteger(sourceSiteId) || sourceSiteId < 0)
      throw new RangeError('source site id must be a nonnegative integer');
    const existing = this.#bindings.get(sourceSiteId);
    if (existing) {
      const updated = { ...existing, observationCount: existing.observationCount + 1 };
      this.#bindings.set(sourceSiteId, updated); return updated;
    }
    const random = new SplitMix64(this.#seed
      ^ (BigInt(this.#allocationSequence + 1) * PROJECTION_SALT)
      ^ (BigInt(sourceSiteId + 1) * SOURCE_ID_SALT));
    const draw = () => random.uniform();
    const targetAnchors = [...new Set(sourceNeighborSiteIds
      .flatMap(neighbor => this.#bindings.get(neighbor)?.targetSiteIds ?? []))].sort((left, right) => left - right);
    const candidates = targetAnchors.length > 0
      ? this.#medium.allocateSitesNear(targetAnchors, this.#candidateCount, draw)
      : this.#medium.allocateSites(this.#candidateCount, draw);
    const targetSiteIds = this.#medium.competeForSites(candidates, this.#winnerCount, draw);
    this.#medium.bindSites(this.#mediumBindingId(sourceSiteId), targetSiteIds);
    const value: SparseInterlayerProjectionBindingV1 = {
      sourceSiteId, targetSiteIds: [...targetSiteIds], observationCount: 1,
    };
    this.#bindings.set(sourceSiteId, value); this.#allocationSequence += 1;
    return value;
  }

  #mappedDrives(sourceDrives: readonly DistributedSiteDriveV1[], allocate: boolean,
    sourceNeighborhoods: SparseInterlayerSourcePulseV1['sourceNeighborhoods'] = []):
  readonly DistributedSiteDriveV1[] {
    const unique = new Map<number, number>();
    for (const drive of sourceDrives) {
      if (!Number.isInteger(drive.siteId) || drive.siteId < 0 || !Number.isFinite(drive.intensity)
        || drive.intensity <= 0 || drive.intensity > 1) throw new Error('invalid sparse interlayer source drive');
      unique.set(drive.siteId, Math.max(unique.get(drive.siteId) ?? 0, drive.intensity));
    }
    const neighborhoodBySite = new Map<number, readonly number[]>();
    for (const neighborhood of sourceNeighborhoods) {
      if (!Number.isInteger(neighborhood.sourceSiteId) || neighborhood.sourceSiteId < 0
        || neighborhood.neighborSiteIds.some(value => !Number.isInteger(value) || value < 0))
        throw new Error('invalid sparse interlayer source neighborhood');
      if (new Set(neighborhood.neighborSiteIds).size !== neighborhood.neighborSiteIds.length)
        throw new Error('sparse interlayer source neighbors must be unique');
      neighborhoodBySite.set(neighborhood.sourceSiteId, [...neighborhood.neighborSiteIds]);
    }
    // Simultaneous source drives are one measured pulse and are represented by
    // the pulse's local/coactive bonds after projection.  They are not spatial
    // neighbours merely because they arrived in the same pulse.  Only an
    // explicitly observed source-lattice neighbourhood may anchor a new target
    // fibre near an already bound source.  This keeps the layer boundary
    // topology honest and prevents unrelated coactivation from merging target
    // basins.
    const result: DistributedSiteDriveV1[] = [];
    for (const [sourceSiteId, intensity] of [...unique].sort(([left], [right]) => left - right)) {
      const binding = allocate
        ? this.#ensureBinding(sourceSiteId, neighborhoodBySite.get(sourceSiteId) ?? [])
        : this.#bindings.get(sourceSiteId);
      if (!binding) continue;
      const fibreIntensity = intensity / Math.sqrt(binding.targetSiteIds.length);
      for (const siteId of binding.targetSiteIds) result.push({ siteId, intensity: fibreIntensity });
    }
    return result.sort((left, right) => left.siteId - right.siteId);
  }

  projectPulse(pulse: SparseInterlayerSourcePulseV1): SparseFieldPulseV1 {
    if (pulse.pulseId.length === 0 || !Number.isFinite(pulse.offset) || pulse.offset < 0)
      throw new Error('invalid sparse interlayer pulse');
    if (pulse.dwellSeconds !== undefined && (!Number.isFinite(pulse.dwellSeconds) || pulse.dwellSeconds <= 0))
      throw new Error('invalid sparse interlayer pulse dwell');
    return { version: 'SparseFieldPulseV1', pulseId: pulse.pulseId, offset: pulse.offset,
      ...(pulse.dwellSeconds === undefined ? {} : { dwellSeconds: pulse.dwellSeconds }),
      drives: this.#mappedDrives(pulse.drives, true, pulse.sourceNeighborhoods) };
  }

  projectEpisode(pulses: readonly SparseInterlayerSourcePulseV1[]): readonly SparseFieldPulseV1[] {
    return pulses.map(value => this.projectPulse(value));
  }

  /** Existing fibre lookup for a read-only open-prefix query; never allocates. */
  lookupPulse(sourceDrives: readonly DistributedSiteDriveV1[]): readonly DistributedSiteDriveV1[] {
    return this.#mappedDrives(sourceDrives, false);
  }

  snapshot(): SparseInterlayerProjectionStateV1 {
    return { version: 'SparseInterlayerProjectionStateV1', projectionId: this.#projectionId,
      seedHex: `0x${this.#seed.toString(16)}`, allocationSequence: this.#allocationSequence,
      candidateCount: this.#candidateCount, winnerCount: this.#winnerCount,
      bindings: [...this.#bindings.values()].sort((left, right) => left.sourceSiteId - right.sourceSiteId)
        .map(value => ({ ...value, targetSiteIds: [...value.targetSiteIds] })) };
  }
}
