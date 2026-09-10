import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Compute } from '../src/compute.js';
import { restoreExperience, V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import { startDashboard } from '../src/dashboard.js';
import { sha } from '../src/util.js';
import { canonicalStreamSha256, type SegmentedCanonicalManifestV1 } from '../src/util-stream.js';
import type { Configuration } from '../src/services.js';
import type { MinecraftBody } from '../src/body.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import { SyntheticBody } from './synthetic-body.js';

/**
 * PLAN-005 acceptance measurement on the real 96-event (484MB) snapshot from
 * the dead v3 exploration run.  Environment-gated: skipped when the evidence
 * tree is not mounted.  Run directly with:
 *   node --test dist/test/dashboard-restored-snapshot-p99.test.js
 */
const POINTER = process.env.KAIROS_MEASURE_POINTER
  ?? 'D:/Kairos_V5_Predictive_Agent/evidence/real-minecraft-exploration-v3/EXPERIENCE_LATEST.json';
const AVAILABLE = existsSync(POINTER);

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

test('restored 96-event snapshot: /state p99 < 100ms and snapshot save main-thread occupancy ≈ 0',
  { skip: AVAILABLE ? false : `measurement snapshot not present at ${POINTER}` }, async t => {
    const directory = await mkdtemp(resolve(process.cwd(), '.tmp-measure-p99-'));
    const compute = new Compute();
    let server: Awaited<ReturnType<typeof startDashboard>> | null = null;
    let maxLagMs = 0, lastProbe = Date.now();
    const probe = setInterval(() => {
      const now = Date.now();
      maxLagMs = Math.max(maxLagMs, now - lastProbe - 10);
      lastProbe = now;
    }, 10);
    try {
      const restoreStarted = performance.now();
      const restored = await restoreExperience(compute, POINTER);
      assert(restored !== null);
      const restoreMs = performance.now() - restoreStarted;
      const sourceBytes = (await readFile(resolve(dirname(POINTER), restored.pointer.filename))).length;
      t.diagnostic(`restore (startup-only, unchanged path): ${(restoreMs / 1000).toFixed(1)}s, snapshot ${(sourceBytes / 1e6).toFixed(0)}MB`);

      const records: { kind: string; value: any }[] = [];
      const body = new SyntheticBody(() => {});
      const config = { version: 'KairosV5PhysicalControlConfigV2',
        minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
          java: 'unused', serverJar: 'unused' },
        actionBudget: 8, initializationEvents: 128, control,
        viewer: { enabled: true, host: '127.0.0.1', port: 0, dashboardPort: 0 },
        stateRoot: 'state', evidenceRoot: 'evidence', runtimeRoot: 'runtime',
        evidence: { snapshotEveryEvents: 32, attentionRecordEveryWindows: 20, attentionScoreEpsilon: .1 },
      } as Configuration;
      const runtime = new V5Runtime(body as unknown as MinecraftBody, config, directory,
        (kind, value) => records.push({ kind, value }),
        { compute, restoredExperience: restored, mediaStatistics: true });
      assert.equal(runtime.eventCount, 96);

      // --- save(): canonical+sha of the full 484MB snapshot must happen off-thread ---
      maxLagMs = 0; lastProbe = Date.now();
      const saveStarted = performance.now();
      await runtime.save();
      const saveWallMs = performance.now() - saveStarted;
      const saveMainThreadMaxLagMs = maxLagMs;
      const serializeRecord = records.find(value => value.kind === 'experience-snapshot-serialized')!;
      t.diagnostic(`save: worker serializeMs=${serializeRecord.value.serializeMs.toFixed(0)}ms `
        + `canonical=${(serializeRecord.value.canonicalBytes / 1e6).toFixed(0)}MB, wall=${saveWallMs.toFixed(0)}ms, `
        + `main-thread max lag=${saveMainThreadMaxLagMs}ms`);
      assert(serializeRecord.value.serializeMs > 1000,
        'the 484MB serialization genuinely happened (worker-side, measured)');
      // ≈0 main-thread occupancy: standalone this measures ~0.1s against the
      // 19.6s worker serialization.  The bound is the watchdog's own 5s stall
      // significance level — any residual main-thread block beyond it would
      // become first-class `stall` evidence — and stays 6x under the 30s
      // keepalive.  (Under full-suite CPU contention the probe reads ~1.3s.)
      assert(saveMainThreadMaxLagMs < 5000,
        `main-thread occupancy during save ≈ 0 (max lag ${saveMainThreadMaxLagMs}ms vs worker serializeMs ${serializeRecord.value.serializeMs.toFixed(0)}ms)`);

      // --- PLAN-008, threshold upper side: the 507MB snapshot exceeds the
      // 256MiB default threshold, so the save landed as a segmented bundle. ---
      const pointerText = await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8');
      const pointer = JSON.parse(pointerText) as ExperiencePointer;
      assert.equal(pointer.eventCount, 96);
      assert.equal(serializeRecord.value.format, 'segmented');
      assert.equal(typeof pointer.manifestSha256, 'string');
      const manifestText = await readFile(resolve(directory, pointer.filename), 'utf8');
      const manifest = JSON.parse(manifestText) as SegmentedCanonicalManifestV1;
      assert.equal(manifest.format, 'KairosV5SegmentedSnapshotV1');
      assert.equal(manifest.sha256, pointer.sha256);
      assert.equal(manifest.canonicalBytes, serializeRecord.value.canonicalBytes);
      assert(manifest.segments.length >= 10, 'one segment per top-level shard');
      const stem = pointer.filename.replace(/\.json$/, '');
      for (const segment of manifest.segments) {
        const segmentRaw = await readFile(resolve(directory, `${stem}.segments`, segment.filename));
        assert.equal(segmentRaw.length, segment.bytes);
      }
      // The segmented bundle restores through the production gate.
      const compute2 = new Compute();
      try {
        const restored2 = await restoreExperience(compute2, resolve(directory, 'EXPERIENCE_LATEST.json'));
        assert(restored2 !== null);
        assert.equal(restored2.snapshot.seenEventIds.length, 96);
        // Streaming-writer byte identity at real scale: same digest as canonical().
        assert.equal(canonicalStreamSha256(restored2.snapshot), sha(restored2.snapshot));
      } finally { await compute2.close(); }

      // --- /state polling on the restored 96-event memory ---
      server = await startDashboard(runtime, 0);
      const port = (server.address() as AddressInfo).port;
      const latencies: number[] = [];
      let maxBytes = 0;
      for (let poll = 0; poll < 120; poll++) {
        const started = performance.now();
        const response = await fetch(`http://127.0.0.1:${port}/state`);
        assert.equal(response.status, 200);
        maxBytes = Math.max(maxBytes, (await response.text()).length);
        latencies.push(performance.now() - started);
      }
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * .5)]!;
      const p99 = latencies[Math.floor(latencies.length * .99)]!;
      const max = latencies.at(-1)!;
      t.diagnostic(`/state on restored 96-event memory: p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${max.toFixed(1)}ms, maxBytes=${maxBytes}`);
      assert(p99 < 100, `/state p99 ${p99.toFixed(1)}ms must be < 100ms at 96 events`);
      assert(maxBytes < 256 * 1024, 'payload stays bounded on the real 484MB memory');

      const stats = runtime.mediaStatisticsForDisplay!;
      const pageStarted = performance.now();
      const page = await fetch(`http://127.0.0.1:${port}/state?media=r1&limit=2400&offset=0&revision=${encodeURIComponent(stats.revision)}`);
      assert.equal(page.status, 200);
      const pageBody = await page.json() as { revision: string; totalSites: number; sites: unknown[] };
      t.diagnostic(`media page r1: ${pageBody.sites.length}/${pageBody.totalSites} sites in ${(performance.now() - pageStarted).toFixed(0)}ms (worker-sliced, revision ${pageBody.revision})`);
      assert(pageBody.sites.length <= 2400);

      // --- PLAN-008, threshold lower side: identical state, one canonical file ---
      const directorySingle = await mkdtemp(resolve(process.cwd(), '.tmp-measure-p99-single-'));
      const singleRecords: { kind: string; value: any }[] = [];
      const singleRuntime = new V5Runtime(body as unknown as MinecraftBody,
        { ...config, evidence: { ...config.evidence, segmentThresholdBytes: 2 ** 31 } },
        directorySingle, (kind, value) => singleRecords.push({ kind, value }),
        { compute, restoredExperience: restored, mediaStatistics: false });
      const singleStarted = performance.now();
      await singleRuntime.save();
      const singleRecord = singleRecords.find(value => value.kind === 'experience-snapshot-serialized')!;
      t.diagnostic(`single-file save of the same 507MB state (threshold 2GiB): `
        + `${((performance.now() - singleStarted) / 1000).toFixed(1)}s, format=${singleRecord.value.format}`);
      assert.equal(singleRecord.value.format, 'single-file');
      const singlePointerText = await readFile(resolve(directorySingle, 'EXPERIENCE_LATEST.json'), 'utf8');
      const singlePointer = JSON.parse(singlePointerText) as ExperiencePointer;
      assert.equal(singlePointer.manifestSha256, undefined);
      const written = await readFile(resolve(directorySingle, singlePointer.filename), 'utf8');
      assert.equal(Buffer.byteLength(written, 'utf8'), singleRecord.value.canonicalBytes + 1);
      assert.equal(createHash('sha256').update(written.slice(0, -1), 'utf8').digest('hex'),
        singlePointer.sha256, 'pointer sha256 binds the streamed canonical bytes');
      assert.equal(sha(JSON.parse(written)), singlePointer.sha256, 'canonical round-trip is byte-identical');
      assert.equal(singlePointer.sha256, pointer.sha256,
        'same state, same identity, on both sides of the format threshold');
      await rm(directorySingle, { recursive: true, force: true });
      await compute.close();
    } finally {

      clearInterval(probe);
      if (server) await new Promise<void>(done => server!.close(() => done()));
      await rm(directory, { recursive: true, force: true });
      await compute.close();
    }
  });
