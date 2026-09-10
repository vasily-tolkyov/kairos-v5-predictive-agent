import { assert } from './util.js';
import { DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3, DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  type DistributedMemorySnapshotV3 as MemorySnapshot,
  type KairosV5DistributedPhysicalMemoryV4 as MemorySnapshotV4 } from './distributed-hierarchical-memory.js';

export const DISTRIBUTED_MEMORY_V4_VERSION = 'KairosV5DistributedPhysicalMemoryV4' as const;

/**
 * Snapshot contract predicates shared by the runtime (restore path) and the
 * compute worker (save-time serialization).  Keeping one implementation in a
 * leaf module lets the worker validate without importing the runtime — which
 * would drag the Minecraft body adapter into the worker thread.
 */
export function assertDistributedMemorySnapshotV3(value: unknown): asserts value is MemorySnapshot {
  assert(typeof value === 'object' && value !== null
    && (value as { readonly version?: unknown }).version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3
    && (value as { readonly hierarchy?: unknown }).hierarchy === DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  'legacy-experience-snapshot-is-audit-only');
}

export function assertDistributedMemorySnapshotV4(value: unknown): asserts value is MemorySnapshotV4 {
  assert(typeof value === 'object' && value !== null
    && (value as { readonly version?: unknown }).version === DISTRIBUTED_MEMORY_V4_VERSION
    && (value as { readonly hierarchy?: unknown }).hierarchy === DISTRIBUTED_HIERARCHY_SEMANTICS_V2
    && typeof (value as { readonly timescales?: unknown }).timescales === 'object'
    && (value as { readonly timescales?: { readonly version?: unknown } }).timescales?.version
      === 'DistributedHierarchicalTimescaleSnapshotV1',
  'invalid-distributed-timescale-snapshot');
  const timescales = (value as MemorySnapshotV4).timescales;
  for (const layer of [timescales.r1, timescales.r2, timescales.r2a]) {
    assert(layer.version === 'DistributedMediumProtocolSnapshotV2'
      && layer.protocol === 'distributed-medium-timescales-v2'
      && /^[a-f0-9]{64}$/.test(layer.lawIdentitySha256),
    'invalid-distributed-timescale-layer');
  }
  assert(timescales.r1.lawIdentitySha256 === timescales.r2.lawIdentitySha256
    && timescales.r1.lawIdentitySha256 === timescales.r2a.lawIdentitySha256,
  'distributed-timescale-law-identity-diverged');
}

export function v3SnapshotFromV4(value: MemorySnapshotV4): MemorySnapshot {
  const { timescales: _timescales, ...base } = value;
  return { ...base, version: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 } as MemorySnapshot;
}
