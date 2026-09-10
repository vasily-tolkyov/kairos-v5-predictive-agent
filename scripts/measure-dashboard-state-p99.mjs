#!/usr/bin/env node
/**
 * PLAN-005 acceptance measurement: on the restored real 96-event (484MB)
 * exploration snapshot, prove
 *   - GET /state p99 < 100ms (bounded summary; full media only via explicit pages)
 *   - snapshot save main-thread occupancy ≈ 0 (canonical/sha256 run in the worker)
 *
 * The measurement itself lives in the environment-gated test
 * test/dashboard-restored-snapshot-p99.test.ts; this script just builds and
 * runs it.  Override the snapshot pointer with KAIROS_MEASURE_POINTER.
 */
import { spawnSync } from 'node:child_process';

const build = spawnSync('npm', ['run', 'build', '--silent'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
console.log('measuring /state p99 on the restored 96-event snapshot '
  + `(pointer: ${process.env.KAIROS_MEASURE_POINTER ?? 'D:/Kairos_V5_Predictive_Agent/evidence/real-minecraft-exploration-v3/EXPERIENCE_LATEST.json'})`);
const result = spawnSync(process.execPath,
  ['--test', '--test-reporter=spec', 'dist/test/dashboard-restored-snapshot-p99.test.js'],
  { stdio: 'inherit', env: { ...process.env } });
process.exit(result.status ?? 1);
