import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonical, sha } from '../src/util.js';
import { canonicalStreamMetrics, streamCanonicalBytes, writeCanonicalFileSync }
  from '../src/util-stream.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import type { Observation, RealEvent } from '../src/contracts.js';

function collected(value: unknown): Buffer {
  const chunks: Uint8Array[] = [];
  streamCanonicalBytes(value, chunk => chunks.push(chunk));
  return Buffer.concat(chunks);
}

function measurementEvent(id: string): RealEvent {
  const frames: Observation[] = [0, 1].map(index => ({ sequence: index,
    activeSeconds: (index + 1) * .05,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [], targetId: null, contextId: 'stream-fixture' }));
  return { version: 'RealEventV5', id,
    cue: { kind: 'wait', parameters: { ticks: 1 }, targetRole: null }, frames,
    trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'wait', parameters: { ticks: 1 } }, executed: true,
      status: 'completed', startSequence: 0, endSequence: 1 } };
}

test('streaming canonical is byte-identical to canonical() across a hostile corpus', () => {
  const corpus: unknown[] = [
    { b: 1, a: [3, 2], c: { z: null, y: 'x' } },
    { '键': 'välüe\n\t"quoted"\\', '': [1] },
    [0, -0, .1 + .2, 1e21, 1e-7, Number.MAX_SAFE_INTEGER, -1.5e308, NaN, Infinity, -Infinity],
    { f: new Float64Array([1.5, -2.25, 1e300]), u: new Uint8Array([0, 255]) },
    { a: undefined, b: () => 1, c: 3 },
    [undefined, () => 1, 'x'],
    {}, [], [[], [{}], { '': {} }],
    'plain-string', 42, true, null,
    { deep: { nested: [{ value: new Int32Array([-1, 1]) }] } },
    { snapshot: { like: { writes: 12, seenEventIds: ['a', 'b'] } } },
  ];
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  memory.observe(measurementEvent('stream-event-1'));
  memory.observe(measurementEvent('stream-event-2'));
  corpus.push(memory.snapshot());
  for (const value of corpus) {
    const expected = canonical(value);
    const actual = collected(value);
    assert.equal(actual.toString('utf8'), expected, 'streamed bytes differ from canonical()');
    assert.equal(canonicalStreamMetrics(value).sha256, sha(value));
    assert.equal(canonicalStreamMetrics(value).bytes, Buffer.byteLength(expected, 'utf8'));
  }
});

test('unrepresentable roots: bigint throws identically; undefined is rejected explicitly', () => {
  assert.throws(() => canonical(1n));
  assert.throws(() => collected(1n));
  // canonical() has no textual form for a bare undefined (JSON.stringify
  // yields undefined); the streaming writer refuses it loudly instead.
  assert.equal(canonical(undefined), undefined as unknown as string);
  assert.throws(() => collected(undefined), /canonical-unsupported-root-value/);
});

test('writeCanonicalFileSync writes canonical bytes plus newline and honors the byte limit', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-canonical-stream-'));
  try {
    const value = { beta: [1, 2, 3], alpha: { nested: new Uint16Array([7, 8]) } };
    const target = resolve(directory, 'value.json');
    const result = writeCanonicalFileSync(target, value);
    assert.equal(result.completed, true);
    assert.equal(result.sha256, sha(value));
    const onDisk = await readFile(target, 'utf8');
    assert.equal(onDisk, canonical(value) + '\n');
    assert.equal(result.bytes, Buffer.byteLength(onDisk, 'utf8'));

    // A byte limit aborts mid-stream: no final file, no tmp debris.
    const big = { payload: 'x'.repeat(10000) };
    const limited = resolve(directory, 'limited.json');
    const aborted = writeCanonicalFileSync(limited, big, { limitBytes: 1024 });
    assert.equal(aborted.completed, false);
    assert.equal(aborted.sha256, null);
    assert.equal(existsSync(limited), false, 'no partial final file');
    assert.equal(existsSync(`${limited}.${process.pid}.tmp`), false, 'no tmp debris');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
