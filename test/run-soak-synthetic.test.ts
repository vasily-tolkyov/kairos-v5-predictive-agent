import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Compute } from '../src/compute.js';
import { startDashboard } from '../src/dashboard.js';
import { EvidenceWriterV1 } from '../src/evidence-writer.js';
import { StallWatchdogV1 } from '../src/stall-watchdog.js';
import { V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import { canonical, sha } from '../src/util.js';
import type { Configuration } from '../src/services.js';
import type { MinecraftBody } from '../src/body.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import type { RealEvent } from '../src/contracts.js';
import { SyntheticBody } from './synthetic-body.js';

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

const SOAK_EVENTS = 48; // > one checkpoint cadence (8) several times over

test('synthetic long-run soak: dashboard polling at 400x cadence never blocks the event loop', async t => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-soak-'));
  const compute = new Compute();
  const writer = new EvidenceWriterV1({
    events: createWriteStream(resolve(directory, 'events.jsonl'), { flags: 'wx' }),
    frames: createWriteStream(resolve(directory, 'frames.jsonl'), { flags: 'wx' }) });
  const record = (kind: string, value: unknown) =>
    writer.write(kind === 'frame' ? 'frames' : 'events', canonical({ kind, time: new Date().toISOString(), value }) + '\n');
  const config = { version: 'KairosV5PhysicalControlConfigV2',
    minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
      java: 'unused', serverJar: 'unused' },
    actionBudget: 512, initializationEvents: 128, control,
    viewer: { enabled: true, host: '127.0.0.1', port: 0, dashboardPort: 0 },
    stateRoot: 'state', evidenceRoot: 'evidence', runtimeRoot: 'runtime',
    evidence: { snapshotEveryEvents: 8, attentionRecordEveryWindows: 5, attentionScoreEpsilon: .1 },
  } as Configuration;
  let server: Awaited<ReturnType<typeof startDashboard>> | null = null;
  let protectiveStop = false, evidenceFailureStop: string | null = null;
  // Event-loop lag probe: 10ms expectation, far tighter than the 30s keepalive.
  let maxLagMs = 0, lastProbe = Date.now();
  const probe = setInterval(() => {
    const now = Date.now();
    maxLagMs = Math.max(maxLagMs, now - lastProbe - 10);
    lastProbe = now;
  }, 10);
  try {
    const body = new SyntheticBody(record, { stateAt: [150], yawAt: [300] });
    await body.ready();
    const runtime = new V5Runtime(body as unknown as MinecraftBody, config, directory, record,
      { compute, mediaStatistics: true });
    // Production-threshold watchdog wired exactly as main.ts wires it.
    const watchdog = new StallWatchdogV1({ record,
      checkpoint: async () => { await runtime.save(); },
      stop: () => { protectiveStop = true; },
      evidenceFailure: () => writer.failure,
      onEvidenceFailure: error => { evidenceFailureStop = error.message; } });
    watchdog.start();
    server = await startDashboard(runtime, 0);
    const port = (server.address() as AddressInfo).port;

    const stateLatencies: number[] = [];
    let statePolls = 0, stateFailures = 0, maxStateBytes = 0;
    let pagePolls = 0, pageFailures = 0;
    let polling = true;
    const poller = (async () => {
      while (polling) {
        const started = performance.now();
        try {
          const response = await fetch(`http://127.0.0.1:${port}/state`);
          const text = await response.text();
          if (response.status !== 200) stateFailures++;
          maxStateBytes = Math.max(maxStateBytes, text.length);
          stateLatencies.push(performance.now() - started);
          statePolls++;
          if (statePolls % 20 === 0) {
            // Follow the client protocol: pin the current statistics revision.
            const summary = JSON.parse(text) as { media: { revision: string } | null };
            if (summary.media !== null) {
              const pageUrl = `http://127.0.0.1:${port}/state?media=r1&limit=64&offset=0`
                + `&revision=${encodeURIComponent(summary.media.revision)}`;
              let page = await fetch(pageUrl);
              if (page.status === 409) {
                const refreshed = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as { media: { revision: string } | null };
                if (refreshed.media !== null) page = await fetch(`http://127.0.0.1:${port}/state?media=r1&limit=64&offset=0&revision=${encodeURIComponent(refreshed.media.revision)}`);
              }
              if (page.status !== 200) pageFailures++;
              else {
                const parsed = await page.json() as { revision: string; sites: unknown[] };
                assert(parsed.sites.length <= 64, 'media page respects its bound');
              }
              pagePolls++;
            }
          }
        } catch { stateFailures++; }
        await delay(5); // 400x the production 2s cadence
      }
    })();

    let lastSavedAt = 0;
    while (runtime.eventCount < SOAK_EVENTS) {
      const offer = runtime.listActionOffers(body.latest())[0]!;
      await runtime.executeOffer(offer, { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [] });
      // Executed events defer their periodic checkpoint to the controller's
      // habit update; this soak bypasses the controller, so drive the same
      // cadence explicitly to keep checkpoints part of the measured load.
      if (runtime.eventCount - lastSavedAt >= 8 && runtime.eventCount % 8 === 0) {
        lastSavedAt = runtime.eventCount;
        await runtime.save();
      }
    }
    await runtime.close();
    polling = false;
    await poller;
    watchdog.dispose();

    t.diagnostic(`soak: events=${runtime.eventCount} statePolls=${statePolls} pagePolls=${pagePolls}`);
    t.diagnostic(`soak: max event-loop lag ${maxLagMs}ms, /state p99 ${
      stateLatencies.sort((a, b) => a - b)[Math.floor(stateLatencies.length * .99)]!.toFixed(1)}ms, max /state bytes ${maxStateBytes}`);
    assert.equal(stateFailures, 0, 'every /state poll answered 200 while saves ran');
    assert.equal(pageFailures, 0, 'every pinned media page answered 200');
    assert(statePolls >= 20, 'dashboard polled continuously during the soak');
    assert.equal(writer.failure, null);
    assert.equal(evidenceFailureStop, null);
    assert.equal(protectiveStop, false, 'no protective stop: polling never starved the loop');
    assert(maxLagMs < 5000, `event-loop lag ${maxLagMs}ms must stay far under the 30s keepalive`);
    assert(maxStateBytes < 256 * 1024, 'bounded /state at every memory size reached here');
    const p99 = stateLatencies[Math.floor(stateLatencies.length * .99)]!;
    assert(p99 < 100, `/state p99 ${p99.toFixed(1)}ms under 100ms while checkpoints serialized in the worker`);

    // Checkpoints happened repeatedly while the loop stayed responsive.
    const pointer = JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8')) as ExperiencePointer;
    assert(pointer.eventCount >= SOAK_EVENTS);

    // ---- Evidence audits (PLAN-005 1.2/1.3) ----
    const events = (await readFile(resolve(directory, 'events.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; value: any });
    const frames = (await readFile(resolve(directory, 'frames.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; value: any });
    assert.equal(events.filter(value => value.kind === 'stall').length, 0,
      'no stall records: the watchdog confirms the loop never exceeded 5s');
    const serialized = events.filter(value => value.kind === 'experience-snapshot-serialized');
    assert(serialized.length >= 6, 'periodic + final checkpoints all serialized worker-side');
    assert(serialized.every(value => typeof value.value.serializeMs === 'number'
      && /^[a-f0-9]{64}$/.test(value.value.sha256)));

    const queued = events.filter(value => value.kind === 'passive-event-queued');
    assert(queued.length > 0, 'passive events were captured during the soak');
    for (const reference of queued.slice(0, 5)) {
      const value = reference.value;
      assert(!('frames' in value), 'passive-event-queued stores no embedded frame array');
      assert.equal(typeof value.eventSha256, 'string');
      assert.equal(typeof value.frameSequenceStart, 'number');
      assert.equal(typeof value.frameSequenceEnd, 'number');
      // Reader resolution: rebuild the event from frames.jsonl and verify the hash.
      const rangeFrames = frames.filter(frame => frame.kind === 'frame'
        && frame.value.sequence >= value.frameSequenceStart
        && frame.value.sequence <= value.frameSequenceEnd).map(frame => frame.value);
      assert.equal(rangeFrames.length, value.frameCount, 'frames.jsonl resolves the referenced range');
      const { sessionId: _s, frameCount: _c, frameSequenceStart: _a, frameSequenceEnd: _b,
        frameActiveSecondsStart: _d, frameActiveSecondsEnd: _e, eventSha256, ...metadata } = value;
      const reconstructed = { ...metadata, frames: rangeFrames } as RealEvent;
      assert.equal(sha(reconstructed), eventSha256,
        'the reference hash covers exactly the referenced frame range (lossless)');
    }

    const attention = events.filter(value => value.kind === 'attention');
    const wakes = events.filter(value => value.kind === 'attention-wake');
    const windowCount = Math.floor(frames.length / 20);
    assert(attention.length > 0 && attention.length < windowCount,
      `attention evidence is selective: ${attention.length} records over ~${windowCount} windows`);
    assert(attention.every(value => Array.isArray(value.value.reasons) && value.value.reasons.length > 0));
    assert(wakes.length > 0, 'attention-wake notices are never dropped');
    assert(attention.some(value => value.value.reasons.includes('periodic')));
    const noticeWindows = attention.filter(value => value.value.reasons.includes('notice')).length;
    assert(wakes.length >= noticeWindows, 'every notice is recorded as attention-wake');
  } finally {
    clearInterval(probe);
    if (server) await new Promise<void>(done => server!.close(() => done()));
    await rm(directory, { recursive: true, force: true });
    await compute.close();
  }
});
