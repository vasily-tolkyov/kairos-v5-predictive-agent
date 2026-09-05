import { SplitMix64 } from '../core/random.js';

export interface ExperimentOscillatorSlotV1 {
  readonly version: 'ExperimentOscillatorSlotV1';
  readonly slotIndex: number;
  readonly scheduled: boolean;
  readonly override: 'opposite-action' | 'suppress-channel' | null;
}

const SLOT_SECONDS = 8;
const SCHEDULE_PERIOD = 4;

function seedValue(seed: bigint | string): bigint {
  if (typeof seed === 'bigint') return BigInt.asUintN(64, seed);
  if (!/^(?:0x)?[0-9a-f]+$/iu.test(seed)) throw new RangeError('oscillator seed must be hexadecimal');
  return BigInt.asUintN(64, BigInt(seed.startsWith('0x') || seed.startsWith('0X') ? seed : `0x${seed}`));
}

/**
 * A phase-locked, state-independent schedule for preregistered meta
 * interventions.  It reads only active experience time and the run seed; it
 * cannot inspect the controller, goal, field or outcome.
 */
export function experimentOscillatorSlotV1(activeSeconds: number,
  runSeed: bigint | string): ExperimentOscillatorSlotV1 {
  if (!Number.isFinite(activeSeconds) || activeSeconds < 0)
    throw new RangeError('oscillator activeSeconds must be finite and nonnegative');
  const slotIndex = Math.floor(activeSeconds / SLOT_SECONDS);
  const scheduled = slotIndex % SCHEDULE_PERIOD === 0;
  if (!scheduled) return { version: 'ExperimentOscillatorSlotV1', slotIndex, scheduled, override: null };
  const random = new SplitMix64(BigInt.asUintN(64, seedValue(runSeed)
    ^ BigInt(slotIndex) * 0x9e3779b97f4a7c15n));
  return { version: 'ExperimentOscillatorSlotV1', slotIndex, scheduled,
    override: random.uniform() < .5 ? 'opposite-action' : 'suppress-channel' };
}
