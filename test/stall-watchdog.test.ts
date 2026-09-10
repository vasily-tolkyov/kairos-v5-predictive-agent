import test from 'node:test';
import assert from 'node:assert/strict';
import { StallWatchdogV1 } from '../src/stall-watchdog.js';

const busyBlock = (milliseconds: number): void => {
  const until = Date.now() + milliseconds;
  while (Date.now() < until);
};

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('watchdog-test-wait-timeout');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('a stall beyond the record threshold becomes a truthful stall evidence record', async () => {
  const records: { kind: string; value: unknown }[] = [];
  let checkpoints = 0, stops = 0;
  const watchdog = new StallWatchdogV1({ intervalMs: 20, recordThresholdMs: 50, stopThresholdMs: 60_000,
    record: (kind, value) => records.push({ kind, value }),
    checkpoint: async () => { checkpoints++; }, stop: () => { stops++; },
    evidenceFailure: () => null, onEvidenceFailure: () => {} });
  watchdog.start();
  try {
    busyBlock(200);
    await waitFor(() => records.some(record => record.kind === 'stall'));
    const stall = records.find(record => record.kind === 'stall')!
      .value as { stallMs: number; sustainedStallMs: number; measuredAt: string };
    assert(stall.stallMs >= 50, `measured stall ${stall.stallMs}ms should cover the real block`);
    assert(stall.stallMs < 5000, 'measured stall is the real duration, not an exaggeration');
    assert(stall.sustainedStallMs >= stall.stallMs);
    assert.equal(typeof stall.measuredAt, 'string');
    assert.equal(checkpoints, 0);
    assert.equal(stops, 0);
  } finally { watchdog.dispose(); }
});

test('a sustained stall beyond the stop threshold checkpoints once and stops cleanly', async () => {
  const records: { kind: string; value: unknown }[] = [];
  const order: string[] = [];
  const watchdog = new StallWatchdogV1({ intervalMs: 20, recordThresholdMs: 50, stopThresholdMs: 250,
    record: (kind, value) => records.push({ kind, value }),
    checkpoint: async () => { order.push('checkpoint'); },
    stop: () => { order.push('stop'); },
    evidenceFailure: () => null, onEvidenceFailure: () => {} });
  watchdog.start();
  try {
    busyBlock(600);
    await waitFor(() => order.includes('stop'));
    assert(watchdog.protectiveStopTriggered);
    assert.deepEqual(order, ['checkpoint', 'stop'], 'checkpoint precedes the clean stop');
    const protective = records.find(record => record.kind === 'stall-protective-stop')!
      .value as { sustainedStallMs: number };
    assert(protective.sustainedStallMs > 250);
    assert(records.some(record => record.kind === 'stall'), 'stall evidence precedes the stop');
    busyBlock(300);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(order, ['checkpoint', 'stop'], 'protective stop fires exactly once');
  } finally { watchdog.dispose(); }
});

test('a quiet loop produces no stall records', async () => {
  const records: unknown[] = [];
  const watchdog = new StallWatchdogV1({ intervalMs: 20, recordThresholdMs: 150, stopThresholdMs: 1000,
    record: (kind, value) => records.push({ kind, value }),
    checkpoint: async () => {}, stop: () => {},
    evidenceFailure: () => null, onEvidenceFailure: () => {} });
  watchdog.start();
  await new Promise(resolve => setTimeout(resolve, 300));
  watchdog.dispose();
  assert.equal(records.length, 0);
  assert.equal(watchdog.protectiveStopTriggered, false);
});

test('an evidence-writer failure is surfaced to the run exactly once', async () => {
  const failures: string[] = [];
  const failure = new Error('evidence-stream-error:events:boom');
  let broken = false;
  const watchdog = new StallWatchdogV1({ intervalMs: 20, recordThresholdMs: 60_000, stopThresholdMs: 120_000,
    record: () => {}, checkpoint: async () => {}, stop: () => {},
    evidenceFailure: () => broken ? failure : null,
    onEvidenceFailure: error => { failures.push(error.message); } });
  watchdog.start();
  try {
    broken = true;
    await waitFor(() => failures.length === 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(failures, ['evidence-stream-error:events:boom']);
  } finally { watchdog.dispose(); }
});
