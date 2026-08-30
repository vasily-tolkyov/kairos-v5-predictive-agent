import test from 'node:test';
import assert from 'node:assert/strict';
import { guidedFixtureGeometryV1, guidedMinecraftHeldOutLayoutsV1,
  guidedMinecraftTrainingLayoutV1, guidedMinecraftTrainingPlanV1 } from '../src/evaluation/minecraft-guided-affordance.js';

test('guided Minecraft curriculum contains 128 balanced real-body instructions across eight layouts', () => {
  const plan = guidedMinecraftTrainingPlanV1();
  assert.equal(plan.length, 128);
  assert.deepEqual([...new Set(plan.map(item => item.layoutIndex))], [0, 1, 2, 3, 4, 5, 6, 7]);
  const counts = Object.fromEntries([...new Set(plan.map(item => item.mode))]
    .map(mode => [mode, plan.filter(item => item.mode === mode).length]));
  assert.deepEqual(counts, { 'look-plus-acquire': 16, 'look-plus-away': 16,
    'look-minus-acquire': 16, 'look-minus-away': 16, 'interact-on': 16,
    'interact-off': 16, observe: 32 });
});

test('fixture geometry keeps the interaction control reachable and test placements held out in world coordinates', () => {
  for (let index = 0; index < 8; index++) {
    const geometry = guidedFixtureGeometryV1(guidedMinecraftTrainingLayoutV1(index));
    const distance = Math.hypot(geometry.control[0] + .5 - geometry.bot[0],
      geometry.control[1] + .5 - (geometry.bot[1] + 1.62), geometry.control[2] + .5 - geometry.bot[2]);
    assert.ok(distance < 4.5 && distance > 2);
  }
  const trainingOrigins = new Set(Array.from({ length: 8 }, (_, index) => {
    const layout = guidedMinecraftTrainingLayoutV1(index); return `${layout.originX},${layout.originZ}`;
  }));
  assert.ok(guidedMinecraftHeldOutLayoutsV1.every(layout => !trainingOrigins.has(`${layout.originX},${layout.originZ}`)));
  assert.equal(new Set(guidedMinecraftHeldOutLayoutsV1.map(layout => layout.id)).size, 2);
});
