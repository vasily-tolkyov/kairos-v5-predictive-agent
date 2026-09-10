import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assert, canonical } from './util.js';

/**
 * PLAN-008 1.1: streaming canonical writer — byte-identical to canonical()
 * (same key order via localeCompare('en'), same array order, TypedArray →
 * Array.from, identical escaping) but never materializes one large string.
 * Primitives are delegated to JSON.stringify so escaping and number formatting
 * match exactly; only the structural walk is reimplemented.
 */

const encoder = new TextEncoder();
const CHUNK_FLUSH_CHARS = 4 * 1024 * 1024;

class ChunkWriter {
  #parts: string[] = [];
  #length = 0;
  constructor(readonly emit: (chunk: Uint8Array) => void) {}
  push(text: string): void {
    this.#parts.push(text);
    this.#length += text.length;
    if (this.#length >= CHUNK_FLUSH_CHARS) this.flush();
  }
  flush(): void {
    if (this.#parts.length === 0) return;
    const text = this.#parts.join('');
    this.#parts = []; this.#length = 0;
    this.emit(encoder.encode(text));
  }
}

function isOmittedProperty(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

function writeCanonicalValue(value: unknown, out: ChunkWriter, key: string | null): void {
  // JSON.stringify order of operations: toJSON first, then the replacer
  // transform (here: TypedArray → Array.from), then the structural walk.
  if (value !== null && typeof value === 'object'
    && typeof (value as { readonly toJSON?: unknown }).toJSON === 'function')
    value = (value as { toJSON(key: string | null): unknown }).toJSON(key);
  if (value === null) { out.push('null'); return; }
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    out.push(JSON.stringify(value));
    return;
  }
  if (kind === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
  if (isOmittedProperty(value)) {
    // JSON.stringify(undefined) at the root yields no text at all; canonical()
    // therefore cannot represent it and neither can this writer.
    throw new TypeError('canonical-unsupported-root-value');
  }
  if (ArrayBuffer.isView(value)) value = Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) {
    out.push('[');
    for (let index = 0; index < value.length; index++) {
      if (index > 0) out.push(',');
      const item = value[index];
      // In arrays JSON.stringify emits null for unrepresentable values.
      if (isOmittedProperty(item)) out.push('null');
      else writeCanonicalValue(item, out, String(index));
    }
    out.push(']');
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, 'en'));
  out.push('{');
  let first = true;
  for (const [entryKey, entryValue] of entries) {
    if (isOmittedProperty(entryValue)) continue;
    if (!first) out.push(',');
    first = false;
    out.push(JSON.stringify(entryKey));
    out.push(':');
    writeCanonicalValue(entryValue, out, entryKey);
  }
  out.push('}');
}

/** Stream the exact canonical() bytes of `value` to `emit`, chunk by chunk. */
export function streamCanonicalBytes(value: unknown, emit: (chunk: Uint8Array) => void): void {
  const writer = new ChunkWriter(emit);
  writeCanonicalValue(value, writer, null);
  writer.flush();
}

/** Hash and size of the canonical byte stream without materializing it. */
export function canonicalStreamMetrics(value: unknown): { bytes: number; sha256: string } {
  const digest = createHash('sha256');
  let bytes = 0;
  streamCanonicalBytes(value, chunk => { digest.update(chunk); bytes += chunk.length; });
  return { bytes, sha256: digest.digest('hex') };
}

/** Streaming drop-in for sha(): identical digest, no single large string. */
export function canonicalStreamSha256(value: unknown): string {
  return canonicalStreamMetrics(value).sha256;
}

/** Internal sentinel for the byte-limit abort; never escapes the module. */
class CanonicalStreamLimitExceeded extends Error {}

/**
 * Synchronously stream canonical bytes to `path` (tmp + atomic rename), with
 * the trailing newline framing of saveJson.  The hash covers the canonical
 * text only (no newline), exactly like sha().  With `limitBytes`, an oversized
 * value aborts the write, removes the tmp file, and returns completed: false —
 * no partial final file is ever produced.
 */
export function writeCanonicalFileSync(path: string, value: unknown,
  options: { readonly limitBytes?: number } = {}): { bytes: number; sha256: string | null; completed: boolean } {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const digest = createHash('sha256');
  let bytes = 0;
  const limit = options.limitBytes ?? Number.POSITIVE_INFINITY;
  const fd = openSync(temporary, 'w');
  try {
    streamCanonicalBytes(value, chunk => {
      if (bytes + chunk.length > limit) throw new CanonicalStreamLimitExceeded();
      writeSync(fd, chunk);
      digest.update(chunk);
      bytes += chunk.length;
    });
    const newline = encoder.encode('\n');
    writeSync(fd, newline);
    bytes += newline.length;
  } catch (error) {
    closeSync(fd);
    rmSync(temporary, { force: true });
    if (error instanceof CanonicalStreamLimitExceeded)
      return { bytes, sha256: null, completed: false };
    throw error;
  }
  closeSync(fd);
  renameSync(temporary, path);
  return { bytes, sha256: digest.digest('hex'), completed: true };
}

export const SEGMENTED_SNAPSHOT_FORMAT_V1 = 'KairosV5SegmentedSnapshotV1' as const;

/** PLAN-008b: recursive paging.  A leaf is one bounded JSON file holding a
 * complete value (an array slice or object slice or single element); array and
 * object nodes reassemble their children in order.  No file ever exceeds the
 * page limit, so restore never parses an oversized string. */
export interface CanonicalPagedLeafV1 {
  readonly kind: 'leaf';
  readonly filename: string;
  readonly sha256: string;
  /** Leaf file size in bytes, including the trailing newline. */
  readonly bytes: number;
}
export interface CanonicalPagedArrayChildV1 {
  /** Number of parent elements this child contributes (1 for a nested node). */
  readonly count: number;
  readonly child: CanonicalPagedNodeV1;
}
export interface CanonicalPagedArrayV1 {
  readonly kind: 'array';
  readonly children: readonly CanonicalPagedArrayChildV1[];
}
export interface CanonicalPagedObjectChildV1 {
  /** Sorted keys this child covers (exactly one for a nested node). */
  readonly keys: readonly string[];
  readonly child: CanonicalPagedNodeV1;
}
export interface CanonicalPagedObjectV1 {
  readonly kind: 'object';
  readonly children: readonly CanonicalPagedObjectChildV1[];
}
export type CanonicalPagedNodeV1 =
  CanonicalPagedLeafV1 | CanonicalPagedArrayV1 | CanonicalPagedObjectV1;

export interface CanonicalSegmentV1 {
  readonly name: string;
  readonly filename: string;
  readonly sha256: string;
  /** Segment file size in bytes, including the trailing newline. */
  readonly bytes: number;
  /** PLAN-008b: present iff the section exceeded the restore limit and was paged. */
  readonly paged?: CanonicalPagedNodeV1;
}

/** Small manifest that names and binds every segment of a segmented snapshot. */
export interface SegmentedCanonicalManifestV1 {
  readonly format: typeof SEGMENTED_SNAPSHOT_FORMAT_V1;
  readonly snapshotVersion: string;
  readonly eventCount: number;
  readonly writes: number;
  /** Bytes and hash of the would-be single canonical file (without newline). */
  readonly canonicalBytes: number;
  readonly sha256: string;
  readonly segments: readonly CanonicalSegmentV1[];
}

function writeRawPageSync(path: string, body: string): { bytes: number; sha256: string } {
  const temporary = `${path}.${process.pid}.tmp`;
  const digest = createHash('sha256');
  const bodyChunk = encoder.encode(body);
  const fd = openSync(temporary, 'w');
  try {
    writeSync(fd, bodyChunk);
    digest.update(bodyChunk);
    writeSync(fd, encoder.encode('\n'));
    closeSync(fd);
    renameSync(temporary, path);
    return { bytes: bodyChunk.length + 1, sha256: digest.digest('hex') };
  } catch (error) {
    try { closeSync(fd); } catch { /* already closed */ }
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Byte length of the canonical form without materializing it. */
function canonicalByteLength(value: unknown, key: string | null = null): number {
  let bytes = 0;
  const writer = new ChunkWriter(chunk => { bytes += chunk.length; });
  writeCanonicalValue(value, writer, key);
  writer.flush();
  return bytes;
}

/**
 * PLAN-008b: a single oversized section becomes a small tree of bounded leaf
 * files.  Array nodes split by contiguous element slices (recursing into any
 * single oversized element); object nodes split by sorted key slices (recursing
 * into any single oversized value).  An oversized primitive fails closed.
 * Identity is computed separately over the exact canonical byte stream, so
 * paging never changes the section's or the snapshot's hash.
 */
function writePagedCanonicalSegmentSync(segmentsDirectory: string, name: string,
  value: unknown, pageLimitBytes: number,
  feedFullBytes: (chunk: Uint8Array) => void): { readonly root: CanonicalPagedNodeV1;
    readonly sha256: string; readonly bytes: number } {
  assert(Array.isArray(value) || (typeof value === 'object' && value !== null),
    'snapshot-segment-not-pageable');
  // Identity pass: the section hash and the full-snapshot stream both consume
  // the exact single-file canonical bytes, independent of the page layout.
  const sectionDigest = createHash('sha256');
  let sectionBytes = 0;
  streamCanonicalBytes(value, chunk => {
    sectionDigest.update(chunk);
    sectionBytes += chunk.length;
    feedFullBytes(chunk);
  });
  let pageOrdinal = 0;
  const writeLeaf = (leaf: unknown): CanonicalPagedLeafV1 => {
    const text = canonical(leaf);
    assert(encoder.encode(text).length <= pageLimitBytes,
      'snapshot-page-element-exceeds-restore-limit');
    pageOrdinal += 1;
    const filename = `${name}.p-${String(pageOrdinal).padStart(6, '0')}.json`;
    const written = writeRawPageSync(resolve(segmentsDirectory, filename), text);
    return { kind: 'leaf', filename, sha256: written.sha256, bytes: written.bytes };
  };
  const writeNode = (node: unknown): CanonicalPagedNodeV1 => {
    if (canonicalByteLength(node) <= pageLimitBytes) return writeLeaf(node);
    if (Array.isArray(node)) {
      const children: CanonicalPagedArrayChildV1[] = [];
      let slice: unknown[] = [];
      let sliceBytes = 2; // opening and closing brackets
      const flushSlice = (): void => {
        if (slice.length === 0) return;
        children.push({ count: slice.length, child: writeLeaf(slice) });
        slice = [];
        sliceBytes = 2;
      };
      for (const element of node) {
        const elementBytes = canonicalByteLength(element);
        if (elementBytes > pageLimitBytes
          && (Array.isArray(element) || (typeof element === 'object' && element !== null))) {
          flushSlice();
          children.push({ count: 1, child: writeNode(element) });
          continue;
        }
        // Preserve the original packing inequality, without reserializing the
        // whole growing prefix for every new element.
        if (slice.length > 0 && sliceBytes + elementBytes + 2 > pageLimitBytes) flushSlice();
        sliceBytes += (slice.length > 0 ? 1 : 0) + canonicalByteLength(element, String(slice.length));
        slice.push(element);
      }
      flushSlice();
      return { kind: 'array', children };
    }
    if (typeof node === 'object' && node !== null) {
      const children: CanonicalPagedObjectChildV1[] = [];
      let sliceKeys: string[] = [];
      let sliceObject: Record<string, unknown> = {};
      let sliceBytes = 2; // opening and closing braces
      const flushSlice = (): void => {
        if (sliceKeys.length === 0) return;
        children.push({ keys: sliceKeys, child: writeLeaf(sliceObject) });
        sliceKeys = [];
        sliceObject = {};
        sliceBytes = 2;
      };
      for (const [key, entryValue] of Object.entries(node as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))) {
        if (isOmittedProperty(entryValue)) continue;
        const entryBytes = canonicalByteLength(entryValue);
        if (entryBytes > pageLimitBytes) {
          flushSlice();
          children.push({ keys: [key], child: writeNode(entryValue) });
          continue;
        }
        // Keep the existing boundary test; the prefix length itself is exact
        // UTF-8, including key escaping, commas and colons.
        if (sliceKeys.length > 0 && sliceBytes + entryBytes
          + JSON.stringify(key).length + 2 > pageLimitBytes) flushSlice();
        sliceBytes += (sliceKeys.length > 0 ? 1 : 0)
          + encoder.encode(JSON.stringify(key)).length + 1 + canonicalByteLength(entryValue, key);
        sliceKeys.push(key);
        sliceObject[key] = entryValue;
      }
      flushSlice();
      return { kind: 'object', children };
    }
    // Oversized primitive (e.g. one giant string): cannot be paged.
    throw new Error('snapshot-page-element-exceeds-restore-limit');
  };
  const root = writeNode(value);
  return { root, sha256: sectionDigest.digest('hex'), bytes: sectionBytes };
}

/**
 * PLAN-008 1.2: write a large snapshot as one manifest plus one canonical
 * segment file per top-level key (canonical sorted order).  The manifest is
 * committed last, so a crash mid-write leaves either tmp debris or complete
 * segments without a manifest — never a half-written "successful" snapshot.
 * The full-snapshot hash is computed in the same pass over the exact canonical
 * byte stream (glue + segment bodies), so manifest.sha256 is precisely the
 * sha256 the single-file format would have committed.
 */
export function writeSegmentedCanonicalFileSync(directory: string, filename: string,
  value: Record<string, unknown>,
  options: { readonly segmentLimitBytes?: number; readonly pageLimitBytes?: number } = {}): { manifest: SegmentedCanonicalManifestV1;
    manifestSha256: string } {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { readonly version?: unknown }).version === 'string',
  'segmented-canonical-root-must-be-a-versioned-object');
  const segmentLimit = options.segmentLimitBytes ?? 512 * 1024 * 1024;
  const pageLimit = options.pageLimitBytes ?? Math.floor(segmentLimit / 2);
  const stem = filename.replace(/\.json$/, '');
  assert(stem !== filename, 'segmented-canonical-filename-must-end-json');
  const segmentsDirectory = resolve(directory, `${stem}.segments`);
  mkdirSync(segmentsDirectory, { recursive: true });
  const fullDigest = createHash('sha256');
  let fullBytes = 0;
  const feed = (text: string): void => {
    const chunk = encoder.encode(text);
    fullDigest.update(chunk);
    fullBytes += chunk.length;
  };
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en'));
  const segments: CanonicalSegmentV1[] = [];
  feed('{');
  let first = true;
  for (const [name, entryValue] of entries) {
    assert(/^[A-Za-z0-9]+$/.test(name), 'segment-name-not-filename-safe');
    if (isOmittedProperty(entryValue)) continue; // JSON.stringify drops such properties
    feed(`${first ? '' : ','}${JSON.stringify(name)}:`);
    first = false;
    const segmentDigest = createHash('sha256');
    let segmentBytes = 0;
    const segmentPath = resolve(segmentsDirectory, `${name}.json`);
    const temporary = `${segmentPath}.${process.pid}.tmp`;
    const fd = openSync(temporary, 'w');
    try {
      streamCanonicalBytes(entryValue, chunk => {
        writeSync(fd, chunk);
        segmentDigest.update(chunk);
        segmentBytes += chunk.length;
      });
    } catch (error) {
      closeSync(fd);
      rmSync(temporary, { force: true });
      throw error;
    }
    const newline = encoder.encode('\n');
    writeSync(fd, newline);
    closeSync(fd);
    if (segmentBytes <= segmentLimit) {
      // Feed the full-stream digest from the just-written bytes (read back in
      // bounded chunks; the trailing newline is framing, not content).  The
      // section bytes enter the full digest in the same canonical order as a
      // single-pass write.
      const readFd = openSync(temporary, 'r');
      try {
        const buffer = Buffer.allocUnsafe(Math.min(4 * 1024 * 1024, Math.max(1, segmentBytes)));
        let offset = 0;
        let remaining = segmentBytes;
        while (remaining > 0) {
          const length = Math.min(buffer.length, remaining);
          const read = readSync(readFd, buffer, 0, length, offset);
          if (read <= 0) throw new Error('segment-read-back-short');
          fullDigest.update(buffer.subarray(0, read));
          fullBytes += read;
          offset += read;
          remaining -= read;
        }
      } finally { closeSync(readFd); }
      renameSync(temporary, segmentPath);
      segments.push({ name, filename: `${name}.json`, sha256: segmentDigest.digest('hex'),
        bytes: segmentBytes + 1 });
    } else {
      // PLAN-008b: one oversized section must not sink the snapshot.  Split it
      // into a small tree of bounded leaf files; the section and full-stream
      // hashes are still computed over the exact single-file canonical bytes.
      rmSync(temporary, { force: true });
      const feedBytes = (chunk: Uint8Array): void => {
        fullDigest.update(chunk);
        fullBytes += chunk.length;
      };
      const paged = writePagedCanonicalSegmentSync(segmentsDirectory, name, entryValue,
        pageLimit, feedBytes);
      segments.push({ name, filename: `${name}.json`, sha256: paged.sha256,
        bytes: paged.bytes + 1, paged: paged.root });
    }
  }
  feed('}');
  const manifest: SegmentedCanonicalManifestV1 = {
    format: SEGMENTED_SNAPSHOT_FORMAT_V1,
    snapshotVersion: (value as { readonly version: string }).version,
    eventCount: (() => { const ids = (value as { readonly seenEventIds?: unknown }).seenEventIds;
      assert(Array.isArray(ids), 'segmented-snapshot-missing-event-ids'); return ids.length; })(),
    writes: (() => { const writes = (value as { readonly writes?: unknown }).writes;
      assert(Number.isSafeInteger(writes), 'segmented-snapshot-missing-writes');
      return writes as number; })(),
    canonicalBytes: fullBytes,
    sha256: fullDigest.digest('hex'),
    segments,
  };
  // The manifest commits last: it is the sole marker of a complete bundle.
  const manifestResult = writeCanonicalFileSync(resolve(directory, filename), manifest);
  assert(manifestResult.sha256 !== null, 'segmented-manifest-write-incomplete');
  return { manifest, manifestSha256: manifestResult.sha256 };
}
