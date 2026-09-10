import { deserialize, serialize } from 'node:v8';
import type { DistributedMediumSnapshotV1 } from './distributed-physical-contracts.js';

/** Encode one immutable substrate once for independent seed workers. Shared
 * bytes are transport only; each worker deserializes its own ordinary object
 * and its own transient activation. No learned array is shared for writing. */
export function encodeDistributedSnapshotForWorkersV1(
  snapshot: DistributedMediumSnapshotV1,
): SharedArrayBuffer {
  const encoded = serialize(snapshot);
  const bytes = new SharedArrayBuffer(encoded.byteLength);
  new Uint8Array(bytes).set(encoded);
  return bytes;
}

export function decodeDistributedSnapshotInWorkerV1(
  bytes: SharedArrayBuffer,
): DistributedMediumSnapshotV1 {
  return deserialize(Buffer.from(bytes)) as DistributedMediumSnapshotV1;
}
