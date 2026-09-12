import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { ControlHabitWeightsV1 } from '../src/control/habit.js';
import { dashboardPayload } from '../src/dashboard.js';
import type { V5Runtime } from '../src/runtime.js';

test('dashboard payload is a defensive projection and cannot mutate runtime-owned values', () => {
  const snapshot = new DistributedHierarchicalPhysicalMemoryV1().snapshot();
  const siteCount = snapshot.r1Medium.sites.length;
  const runtimeState = { nested: { value: 3 } };
  const controlField = { sites: [{ activation: .7 }], dependencies: [] };
  const habits = new ControlHabitWeightsV1().exportCheckpoint();
  const runtime = {
    snapshotForDisplay: snapshot,
    controlFieldForDisplay: controlField,
    habitCheckpointForDisplay: habits,
    display: () => runtimeState,
  } as unknown as V5Runtime;

  const payload = dashboardPayload(runtime) as {
    runtime: { nested: { value: number } };
    controlFields: { sites: { activation: number }[] };
    media: { r1: { sites: unknown[] } };
  };
  payload.runtime.nested.value = 99;
  payload.controlFields.sites[0]!.activation = 0;
  payload.media.r1.sites.push({});

  assert.equal(runtimeState.nested.value, 3);
  assert.equal(controlField.sites[0]!.activation, .7);
  assert.equal(snapshot.r1Medium.sites.length, siteCount);
});

test('runtime display getters clone owned snapshots at the boundary', async () => {
  const source = await readFile(resolve('src/runtime.ts'), 'utf8');
  assert.match(source, /get snapshotForDisplay\(\)[\s\S]*?structuredClone\(this\.#lastSnapshot\)/);
  assert.match(source, /get controlFieldForDisplay\(\)[\s\S]*?structuredClone\(snapshot\)/);
  assert.match(source, /display\(\): unknown \{[\s\S]*?return structuredClone\(\{/);
});

test('production entry has no built-in goal and runs only an explicit grounded goal', async () => {
  const source = await readFile(resolve('src/main.ts'), 'utf8');
  assert.equal(source.includes('iron_door'), false);
  assert.equal(source.includes('changeVisibleCondition'), false);
  assert.equal(source.includes('continuedExploration'), false);
  assert.equal(source.includes('runtime.runGoal('), true);
  assert.doesNotMatch(source, /if \(physical\.ready && !options\.bootstrapOnly/);
  assert.match(source, /services\.start\(options\.fixture\)/);
  assert.match(source, /structured-goal-required/);
  assert.match(source, /acceptedVersion: 'GroundedGoalV1'/);
});
