import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Compute } from '../src/compute.js';
import { startDashboard, dashboardSummary } from '../src/dashboard.js';
import { V5Runtime } from '../src/runtime.js';
import type { Configuration } from '../src/services.js';
import type { MinecraftBody } from '../src/body.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import { SyntheticBody } from './synthetic-body.js';

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

function testConfig(): Configuration {
  return { version: 'KairosV5PhysicalControlConfigV2',
    minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
      java: 'unused', serverJar: 'unused' },
    actionBudget: 64, initializationEvents: 128, control,
    viewer: { enabled: true, host: '127.0.0.1', port: 0, dashboardPort: 0 },
    stateRoot: 'state', evidenceRoot: 'evidence', runtimeRoot: 'runtime',
    evidence: { snapshotEveryEvents: 4, attentionRecordEveryWindows: 5, attentionScoreEpsilon: .1 },
  } as Configuration;
}

async function commitEvents(runtime: V5Runtime, body: SyntheticBody, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    const offer = runtime.listActionOffers(body.latest())[0]!;
    const result = await runtime.executeOffer(offer,
      { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [] });
    assert.equal(result.executed, true);
  }
}

test('default /state is a bounded summary: statistics only, never full media serialization', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-dashboard-bounded-'));
  const compute = new Compute();
  const records: { kind: string; value: unknown }[] = [];
  let server: Awaited<ReturnType<typeof startDashboard>> | null = null;
  let runtime: V5Runtime | null = null;
  try {
    const body = new SyntheticBody((kind, value) => records.push({ kind, value }));
    await body.ready();
    runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(), directory,
      (kind, value) => records.push({ kind, value }), { compute, mediaStatistics: true });
    await commitEvents(runtime, body, 5);
    await runtime.save();
    assert(runtime.eventCount >= 5);

    // Spy on the heavy projections: the default route must never touch them.
    let snapshotForDisplayCalls = 0, displayCalls = 0;
    const snapshotDescriptor = Object.getOwnPropertyDescriptor(V5Runtime.prototype, 'snapshotForDisplay')!;
    Object.defineProperty(runtime, 'snapshotForDisplay', { get: () => {
      snapshotForDisplayCalls++; return snapshotDescriptor.get!.call(runtime);
    } });
    const originalDisplay = runtime.display.bind(runtime);
    runtime.display = () => { displayCalls++; return originalDisplay(); };

    server = await startDashboard(runtime, 0);
    const port = (server.address() as AddressInfo).port;
    const latencies: number[] = [];
    let summary: Record<string, any> | null = null;
    for (let poll = 0; poll < 60; poll++) {
      const started = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/state`);
      assert.equal(response.status, 200);
      summary = await response.json() as Record<string, any>;
      latencies.push(performance.now() - started);
    }
    assert(summary !== null);
    assert.equal(snapshotForDisplayCalls, 0, 'default /state must not clone the full snapshot');
    assert.equal(displayCalls, 0, 'default /state must not serialize the unbounded display()');
    // Media appear as bounded statistics, never as site arrays.
    const media = summary.media as { revision: string; media: Record<string, Record<string, unknown>> };
    assert(media && typeof media.revision === 'string' && media.revision.includes(':'));
    for (const layer of ['r1', 'r2', 'r2a']) {
      const stats = media.media[layer]!;
      assert.equal(typeof stats.siteCount, 'number');
      assert.equal(typeof stats.activeSiteCount, 'number');
      assert.equal(typeof stats.learnedBondCount, 'number');
      assert.match(stats.sha256 as string, /^[a-f0-9]{64}$/);
      assert.equal('sites' in stats, false, 'statistics carry counts and hashes, never site arrays');
    }
    assert.equal(typeof summary.runtime.physicalEvents, 'number');
    assert('controlFields' in summary && 'controlHabits' in summary);
    const bytes = JSON.stringify(summary).length;
    assert(bytes < 256 * 1024, `bounded summary stays small, got ${bytes}`);
    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * .99)]!;
    assert(p99 < 100, `/state p99 ${p99.toFixed(1)}ms must stay under 100ms`);

    // The dashboard page only fetches bounded endpoints.
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /fetch\('\/state'\)/);
    assert.match(html, /\/state\?media=/, 'media loads through the explicit paginated route');
    assert.match(html, /limit=/, 'media requests carry an explicit bound');
  } finally {
    if (server) await new Promise<void>(done => server!.close(() => done()));
    if (runtime) await runtime.close();
    await rm(directory, { recursive: true, force: true });
    await compute.close();
  }
});

test('paginated media route: bounded slices, revision pinning, and a pre-serialized revision cache', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-dashboard-pages-'));
  const compute = new Compute();
  let server: Awaited<ReturnType<typeof startDashboard>> | null = null;
  let runtime: V5Runtime | null = null;
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(), directory,
      () => {}, { compute, mediaStatistics: true });
    await commitEvents(runtime, body, 5);
    await runtime.save();
    const statistics = runtime.mediaStatisticsForDisplay;
    assert(statistics !== null);
    const revision = statistics.revision;

    let mediaPageCalls = 0;
    const original = runtime.mediaPageForDisplay.bind(runtime);
    runtime.mediaPageForDisplay = async request => { mediaPageCalls++; return original(request); };

    server = await startDashboard(runtime, 0);
    const port = (server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/state?media=r1&revision=${encodeURIComponent(revision)}&limit=8&offset=0`;
    const first = await fetch(url);
    assert.equal(first.status, 200);
    const page = await first.json() as { revision: string; totalSites: number; sites: unknown[] };
    assert.equal(page.revision, revision);
    assert(page.sites.length <= 8);
    assert.equal(mediaPageCalls, 1);
    const second = await fetch(url);
    assert.equal(second.status, 200);
    assert.equal(mediaPageCalls, 1, 'identical revision is served from the pre-serialized cache');
    assert.equal(await second.text(), JSON.stringify(page));

    const stale = await fetch(
      `http://127.0.0.1:${port}/state?media=r1&revision=${encodeURIComponent('0:0')}&limit=8&offset=0`);
    assert.equal(stale.status, 409, 'a pinned stale revision is rejected explicitly');

    const badMedium = await fetch(`http://127.0.0.1:${port}/state?media=rfour&limit=8`);
    assert.equal(badMedium.status, 400);
    const clamped = await fetch(
      `http://127.0.0.1:${port}/state?media=r2a&revision=${encodeURIComponent(revision)}&limit=999999`);
    assert.equal(clamped.status, 200);
    const clampedPage = await clamped.json() as { limit: number; sites: unknown[] };
    assert(clampedPage.limit <= 4096, 'page limit is bounded');
  } finally {
    if (server) await new Promise<void>(done => server!.close(() => done()));
    if (runtime) await runtime.close();
    await rm(directory, { recursive: true, force: true });
    await compute.close();
  }
});

test('dashboardSummary is a defensive bounded projection (no shared media references)', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-dashboard-summary-'));
  const compute = new Compute();
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    const runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(), directory,
      () => {}, { compute, mediaStatistics: true });
    await commitEvents(runtime, body, 2);
    await runtime.save();
    const first = dashboardSummary(runtime) as { media: { revision: string } | null };
    assert(first.media !== null);
    (first.media as { revision: string }).revision = 'mutated';
    const second = dashboardSummary(runtime) as { media: { revision: string } };
    assert.notEqual(second.media.revision, 'mutated', 'summary hands out copies, not the cached object');
    await runtime.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
    await compute.close();
  }
});
