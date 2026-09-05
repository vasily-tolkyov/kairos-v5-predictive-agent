import type { DistributedBondReferenceV1, DistributedMediumSnapshotV1 } from '../physics/distributed-physical-contracts.js';
import type { DistributedPhysicalMedium3DV1 } from '../physics/distributed-physical-medium.js';
import { SplitMix64 } from '../random.js';
import { memoryTimescaleLawConfigV1 } from './memory-timescales.js';

export interface ReplayIdleSignalsV1 {
  readonly goalActive: boolean;
  readonly pendingAttention: boolean;
  readonly novelty: number;
  readonly unknown: number;
}

export interface ReplayPlanEntryV1 {
  readonly traceId: string;
  readonly siteIds: readonly number[];
  readonly bondReferences: readonly DistributedBondReferenceV1[];
}

export interface ConsolidationReplayPlanV1 {
  readonly version: 'ConsolidationReplayPlanV1';
  readonly provenance: 'replay';
  readonly selected: readonly ReplayPlanEntryV1[];
  readonly seed: string;
}

/** The writer surface is deliberately unable to change support or evidence. */
export interface ReplayWritePortV1 {
  hasSite(siteId: number): boolean;
  hasBond(reference: DistributedBondReferenceV1): boolean;
  refreshPotentialDepth(siteId: number, amount: number): void;
  strengthenExistingBond(reference: DistributedBondReferenceV1, amount: number): void;
  recordRehearsal(traceId: string): void;
  homeostaticDownscale(factor: number): void;
}

/** Adapter that exposes only the approved replay whitelist of a live medium. */
export class DistributedMediumReplayWriterV1 implements ReplayWritePortV1 {
  readonly #medium: DistributedPhysicalMedium3DV1;
  readonly #onRehearsal: (traceId: string) => void;

  constructor(medium: DistributedPhysicalMedium3DV1, onRehearsal: (traceId: string) => void) {
    this.#medium = medium;
    this.#onRehearsal = onRehearsal;
  }

  hasSite(siteId: number): boolean { return this.#medium.replayHasSite(siteId); }
  hasBond(reference: DistributedBondReferenceV1): boolean { return this.#medium.replayHasBond(reference); }
  refreshPotentialDepth(siteId: number, amount: number): void {
    this.#medium.replayRefreshPotentialDepth(siteId, amount);
  }
  strengthenExistingBond(reference: DistributedBondReferenceV1, amount: number): void {
    this.#medium.replayStrengthenExistingBond(reference, amount);
  }
  recordRehearsal(traceId: string): void {
    if (!this.#medium.replayHasTrace(traceId)) throw new Error('replay trace is not present');
    this.#onRehearsal(traceId);
  }
  homeostaticDownscale(factor: number): void { this.#medium.replayHomeostaticDownscale(factor); }
}

export interface ConsolidationReplayReceiptV1 {
  readonly version: 'ConsolidationReplayReceiptV1';
  readonly provenance: 'replay';
  readonly selectedTraceIds: readonly string[];
  readonly rehearsalTraceIds: readonly string[];
  readonly homeostaticFactor: number;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer`);
}

function finiteUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be in [0,1]`);
}

/** Replay is allowed only when the controller reports a genuinely idle state. */
export function idleForConsolidationReplayV1(signals: ReplayIdleSignalsV1): boolean {
  finiteUnit(signals.novelty, 'novelty');
  finiteUnit(signals.unknown, 'unknown');
  return !signals.goalActive && !signals.pendingAttention && signals.novelty <= 0.1 && signals.unknown <= 0.1;
}

function seedToBigInt(seed: bigint | string): bigint {
  if (typeof seed === 'bigint') return seed;
  if (!/^(?:0x)?[0-9a-f]+$/iu.test(seed)) throw new RangeError('replay seed must be hexadecimal');
  return BigInt(seed.startsWith('0x') || seed.startsWith('0X') ? seed : `0x${seed}`);
}

/**
 * Select only already-active complete footprints. No result labels, salience,
 * support edits or new physical structures are constructed by this function.
 */
export function buildConsolidationReplayPlanV1(snapshot: DistributedMediumSnapshotV1,
  seed: bigint | string, maxTraces = 8): ConsolidationReplayPlanV1 {
  if (snapshot.version !== 'DistributedMediumSnapshotV1') throw new Error('unsupported replay source snapshot');
  positiveInteger(maxTraces, 'maxTraces');
  const eligible = snapshot.footprints.filter(footprint => footprint.supportMass > 0
    && footprint.siteIds.length > 0
    && footprint.siteIds.every(siteId => snapshot.sites[siteId]?.potentialDepth !== undefined
      && snapshot.sites[siteId]!.potentialDepth > 0)
    && footprint.bondReferences.every(reference => snapshot.learnedBonds.some(bond =>
      bond.kind === reference.kind && bond.fromSiteId === reference.fromSiteId
      && bond.toSiteId === reference.toSiteId && bond.supportMass > 0
      && (reference.kind === 'local' ? bond.symmetricCoupling : bond.directedConductance) > 0)))
    .map(footprint => ({ traceId: footprint.traceId, siteIds: [...footprint.siteIds],
      bondReferences: footprint.bondReferences.map(reference => ({ ...reference })) }));
  const random = new SplitMix64(seedToBigInt(seed));
  const shuffled = [...eligible];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random.uniform() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  const selected = shuffled.slice(0, Math.min(maxTraces, shuffled.length))
    .sort((left, right) => left.traceId.localeCompare(right.traceId, 'en'));
  return { version: 'ConsolidationReplayPlanV1', provenance: 'replay', selected,
    seed: `0x${seedToBigInt(seed).toString(16)}` };
}

/** Validate all replay writes before mutating a live medium. */
export function validateConsolidationReplayPlanV1(plan: ConsolidationReplayPlanV1,
  writer: ReplayWritePortV1): void {
  if (plan.version !== 'ConsolidationReplayPlanV1' || plan.provenance !== 'replay')
    throw new Error('invalid consolidation replay plan');
  for (const entry of plan.selected) {
    for (const siteId of entry.siteIds)
      if (!writer.hasSite(siteId)) throw new Error(`replay site is not present: ${siteId}`);
    for (const reference of entry.bondReferences)
      if (!writer.hasBond(reference)) throw new Error('replay bond is not present');
  }
}

/** Execute only the replay whitelist; no trusted-real-event writer is called. */
export function executeConsolidationReplayV1(plan: ConsolidationReplayPlanV1,
  writer: ReplayWritePortV1): ConsolidationReplayReceiptV1 {
  validateConsolidationReplayPlanV1(plan, writer);
  const law = memoryTimescaleLawConfigV1();
  const potentialRefresh = 0.01;
  const bondRefresh = 0.01;
  const homeostaticFactor = law.homeostaticDownscaleFactor;
  for (const entry of plan.selected) {
    for (const siteId of entry.siteIds) {
      writer.refreshPotentialDepth(siteId, potentialRefresh);
    }
    for (const reference of entry.bondReferences) {
      writer.strengthenExistingBond(reference, bondRefresh);
    }
    writer.recordRehearsal(entry.traceId);
  }
  writer.homeostaticDownscale(homeostaticFactor);
  return { version: 'ConsolidationReplayReceiptV1', provenance: 'replay',
    selectedTraceIds: plan.selected.map(entry => entry.traceId),
    rehearsalTraceIds: plan.selected.map(entry => entry.traceId), homeostaticFactor };
}
