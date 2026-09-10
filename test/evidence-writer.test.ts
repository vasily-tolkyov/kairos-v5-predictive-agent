import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { EvidenceWriterV1, type EvidenceLaneStreamV1 } from '../src/evidence-writer.js';

class FakeLane extends EventEmitter {
  readonly written: string[] = [];
  /** When > 0, write() returns false that many times (drain emitted on next tick). */
  backpressure = 0;
  failOnWrite: Error | null = null;
  neverDrain = false;
  ended = false;
  write(chunk: string): boolean {
    if (this.failOnWrite) { queueMicrotask(() => this.emit('error', this.failOnWrite)); return true; }
    this.written.push(chunk);
    if (this.backpressure > 0) {
      this.backpressure--;
      if (!this.neverDrain) queueMicrotask(() => this.emit('drain'));
      return false;
    }
    return true;
  }
  end(callback: () => void): void { this.ended = true; queueMicrotask(callback); }
}

const lanes = (events: EvidenceLaneStreamV1, frames: EvidenceLaneStreamV1) => ({ events, frames });

test('writer flushes every accepted line in order and ends both streams', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-evidence-writer-'));
  try {
    const events = createWriteStream(resolve(directory, 'events.jsonl'), { flags: 'wx' });
    const frames = createWriteStream(resolve(directory, 'frames.jsonl'), { flags: 'wx' });
    const writer = new EvidenceWriterV1(lanes(events, frames));
    for (let index = 0; index < 500; index++) {
      writer.write('events', `e${index}\n`);
      writer.write('frames', `f${index}\n`);
    }
    await writer.flush();
    await writer.end();
    const eventsText = await readFile(resolve(directory, 'events.jsonl'), 'utf8');
    const framesText = await readFile(resolve(directory, 'frames.jsonl'), 'utf8');
    assert.equal(eventsText, Array.from({ length: 500 }, (_, index) => `e${index}`).join('\n') + '\n');
    assert.equal(framesText, Array.from({ length: 500 }, (_, index) => `f${index}`).join('\n') + '\n');
    assert.equal(writer.failure, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('backpressure: write() false is honoured by awaiting drain, nothing is dropped', async () => {
  const events = new FakeLane(), frames = new FakeLane();
  events.backpressure = 3;
  const writer = new EvidenceWriterV1(lanes(events, frames), { maxQueuedLines: 64 });
  for (let index = 0; index < 10; index++) writer.write('events', `line-${index}\n`);
  await writer.flush();
  assert.equal(writer.failure, null);
  assert.deepEqual(events.written, Array.from({ length: 10 }, (_, index) => `line-${index}\n`));
  await writer.end();
  assert.equal(events.ended, true);
});

test('a stream write error fails the run explicitly and sticks; later writes are refused', async () => {
  const events = new FakeLane(), frames = new FakeLane();
  events.failOnWrite = new Error('synthetic-disk-failure');
  const writer = new EvidenceWriterV1(lanes(events, frames));
  writer.write('events', 'a\n');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const failure = writer.failure;
  assert(failure !== null, 'write error must surface as an explicit failure');
  assert.match(failure.message, /evidence-stream-error:events:synthetic-disk-failure/);
  writer.write('events', 'b\n');
  await writer.flush().then(() => { throw new Error('flush must reject after a write error'); },
    error => assert.equal(error, failure));
  assert.equal(writer.failure, failure, 'first failure wins');
  await writer.end();
  assert.equal(events.ended, true, 'streams are still ended so handles never leak');
});

test('an undrained stream makes the bounded queue overflow into an explicit failure', async () => {
  const events = new FakeLane(), frames = new FakeLane();
  events.backpressure = Number.MAX_SAFE_INTEGER;
  events.neverDrain = true;
  const writer = new EvidenceWriterV1(lanes(events, frames), { maxQueuedLines: 8 });
  for (let index = 0; index < 40; index++) writer.write('events', `line-${index}\n`);
  const failure = writer.failure;
  assert(failure !== null, 'unbounded queue growth must fail explicitly');
  assert.match(failure.message, /evidence-queue-overflow:events/);
  assert(writer.queuedLines <= 10, `queue stayed bounded, got ${writer.queuedLines}`);
  writer.write('events', 'after-failure\n');
  assert.equal(writer.queuedLines <= 10, true, 'no further growth after failure');
  await writer.end();
});
