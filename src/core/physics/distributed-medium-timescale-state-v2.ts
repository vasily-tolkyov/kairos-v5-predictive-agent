import {
  advanceArousalV1,
  assertMemoryTimescaleLawV1,
  effectiveRecoveryRateV1,
  encodingGainV1,
  memoryTimescaleLawConfigV1,
  type MemoryTimescaleLawConfigV1,
  type MediumArousalStateV1,
  type MeasuredSalienceV1,
} from '../learning/memory-timescales.js';

/**
 * DESIGN-002 state is deliberately separate from DistributedMediumSnapshotV1.
 * The old physical snapshot remains audit-only; no constructor accepts it and
 * no optional fields are added to the V1 protocol.
 */
export interface DistributedMediumTimescaleSnapshotV2 {
  readonly version: 'DistributedMediumTimescaleSnapshotV2';
  readonly protocol: 'memory-timescales-v2';
  readonly arousal: number;
  readonly logicalTime: number;
  readonly rehearsalCounts: readonly { readonly structureId: string; readonly count: number }[];
}

function requireTime(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
}

function requireStructureId(value: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new RangeError('structureId must be non-empty');
}

/**
 * Medium-owned time state.  Surprise is accepted only as a measured flux at
 * an explicitly ordered observation time; there is no setter for salience,
 * recovery rate or arousal.
 */
export class DistributedMediumTimescaleStateV2 {
  readonly #law: MemoryTimescaleLawConfigV1;
  #arousal: MediumArousalStateV1 = { version: 'MediumArousalStateV1', arousal: 0, logicalTime: 0 };
  readonly #rehearsalCounts = new Map<string, number>();

  constructor(law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()) {
    assertMemoryTimescaleLawV1(law);
    this.#law = Object.freeze({ ...law });
  }

  get arousal(): number { return this.#arousal.arousal; }
  get logicalTime(): number { return this.#arousal.logicalTime; }

  /** Advance experience time and decay the medium-owned arousal state. */
  advanceTo(logicalTime: number): void {
    requireTime(logicalTime, 'logicalTime');
    if (logicalTime < this.logicalTime) throw new Error('timescale-logical-time-reversed');
    this.#arousal = advanceArousalV1(this.#arousal, 0, logicalTime - this.logicalTime, this.#law);
  }

  /** Deposit a measured surprise flux; unknown changes must pass zero. */
  depositSurpriseFlux(observedAt: number, surpriseFlux: number): void {
    requireTime(observedAt, 'observedAt');
    if (observedAt < this.logicalTime) throw new Error('surprise-observation-time-reversed');
    this.#arousal = advanceArousalV1(this.#arousal, surpriseFlux,
      observedAt - this.logicalTime, this.#law);
  }

  rehearsalCount(structureId: string): number {
    requireStructureId(structureId);
    return this.#rehearsalCounts.get(structureId) ?? 0;
  }

  recordRehearsal(structureId: string): number {
    requireStructureId(structureId);
    const next = this.rehearsalCount(structureId) + 1;
    this.#rehearsalCounts.set(structureId, next);
    return next;
  }

  /** Derive rate from measurements and this state's own rehearsal count. */
  effectiveRecoveryRate(structureId: string, measurement: Omit<MeasuredSalienceV1, 'rehearsalCount'>): number {
    const count = this.rehearsalCount(structureId);
    return effectiveRecoveryRateV1({ ...measurement, version: 'MeasuredSalienceV1', rehearsalCount: count }, this.#law);
  }

  encodingGain(): number { return encodingGainV1(this.arousal, this.#law); }

  snapshot(): DistributedMediumTimescaleSnapshotV2 {
    return {
      version: 'DistributedMediumTimescaleSnapshotV2', protocol: 'memory-timescales-v2',
      arousal: this.#arousal.arousal, logicalTime: this.#arousal.logicalTime,
      rehearsalCounts: [...this.#rehearsalCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([structureId, count]) => ({ structureId, count })),
    };
  }

  static restore(snapshot: DistributedMediumTimescaleSnapshotV2,
    law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): DistributedMediumTimescaleStateV2 {
    if (snapshot.version !== 'DistributedMediumTimescaleSnapshotV2'
      || snapshot.protocol !== 'memory-timescales-v2') throw new Error('unsupported-timescale-v2-snapshot');
    requireTime(snapshot.arousal, 'snapshot arousal');
    if (snapshot.arousal > 1) throw new RangeError('snapshot arousal must be bounded');
    requireTime(snapshot.logicalTime, 'snapshot logicalTime');
    const state = new DistributedMediumTimescaleStateV2(law);
    state.#arousal = { version: 'MediumArousalStateV1', arousal: snapshot.arousal,
      logicalTime: snapshot.logicalTime };
    let previous = '';
    for (const item of snapshot.rehearsalCounts) {
      requireStructureId(item.structureId);
      if (item.structureId <= previous) throw new Error('timescale rehearsal ids must be sorted and unique');
      if (!Number.isSafeInteger(item.count) || item.count < 0) throw new RangeError('rehearsal count must be nonnegative integer');
      previous = item.structureId;
      state.#rehearsalCounts.set(item.structureId, item.count);
    }
    return state;
  }
}
