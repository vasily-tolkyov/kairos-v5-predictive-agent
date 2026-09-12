import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ExperienceSession } from '../dist/src/prototype.js';
test('custom-goal continuation rejects implicit extra tasks before booting the game', async () => {
  await mkdir(resolve('evidence'), { recursive: true });
  const base = await mkdtemp(resolve('evidence/custom-goal-guard-'));
  await mkdir(resolve(base, 'runtime/minecraft'), { recursive: true });
  await writeFile(resolve(base, 'runtime/minecraft/server.properties'),
    'level-name=world\nlevel-seed=42\ndifficulty=peaceful\n');
  const session = new ExperienceSession();
  const goal = { version: 'GroundedGoalV1', id: 'preserved-custom-goal', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'terminal', subject: { kind: 'self' },
      observable: 'position.2', comparator: 'less-than', target: -14.5 } } };
  session.submit(goal);
  await writeFile(resolve(base, 'session.json.gz'), JSON.stringify(session.snapshot()));
  await writeFile(resolve(base, 'results.json'), JSON.stringify({ status: 'budget-paused',
    stoppedAt: '2026-09-12T00:00:00Z', runtimeRoot: resolve(base, 'runtime'),
    protocol: { environment: 'natural' }, final: session.stats }));
  await writeFile(resolve(base, 'goal.json'), JSON.stringify(goal));
  // No executable or server exists: this boundary fixture cannot run a game.
  const common = ['scripts/evaluate-minecraft-continuing.mjs', '--java', resolve(base, 'NO_JAVA_EXECUTABLE'),
    '--server', resolve(base, 'NO_SERVER_JAR'), '--continue', base, '--steps', '0'];
  const rejected = spawnSync(process.execPath, [...common, '--output', resolve(base, 'rejected')],
    { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /continuing-custom-tasks-requires-explicit-goal-file/);
  assert(!existsSync(resolve(base, 'rejected/protocol.json')));
  const digest = createHash('sha256').update(await readFile(resolve(base, 'session.json.gz'))).digest('hex');
  const wrongModel = spawnSync(process.execPath, [...common, '--output', resolve(base, 'wrong-model'),
    '--goal', resolve(base, 'goal.json'), '--expected-session-sha256', '0'.repeat(64)],
    { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(wrongModel.status, 0);
  assert.match(wrongModel.stderr, /restored-session-sha256-mismatch/);
  assert(!existsSync(resolve(base, 'wrong-model/protocol.json')));
  const explicit = spawnSync(process.execPath, [...common, '--output', resolve(base, 'explicit'),
    '--goal', resolve(base, 'goal.json'), '--expected-session-sha256', digest], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(explicit.status, 0);
  assert.doesNotMatch(explicit.stderr, /continuing-custom-tasks-requires-explicit-goal-file/);
  const protocol = JSON.parse(await readFile(resolve(base, 'explicit/protocol.json'), 'utf8'));
  assert.deepEqual(protocol.protocol.requestedGoals, [goal]);
  assert.equal(protocol.initialStats.pendingGoals, 1);
  assert.equal(protocol.checkpointInput.sha256, digest);
  assert.equal(protocol.checkpointInput.expectedSha256, digest);
  await writeFile(resolve(base, 'check.json'), JSON.stringify({ version: 'CustomGoalLaunchGuardCheck1',
    missingSelectionRejectedBeforeProtocol: true, explicitExistingGoalAccepted: true,
    initialPendingGoals: 1, wrongModelRejectedBeforeProtocol: true, exactModelBytesAccepted: true,
    newPhysicalTrials: 0, javaDeliberatelyUnavailable: true,
    scope: 'Synthetic CLI boundary fixture, not native capability evidence' }, null, 2));
});
