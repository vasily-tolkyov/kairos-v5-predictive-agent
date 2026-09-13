import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [oldBuild, newBuild, output] = process.argv.slice(2);
assert(output, 'usage: OLD_DIST NEW_DIST NEW_RESULT_JSON');
const load = build => import(pathToFileURL(resolve(build, 'src/experience-world.js')).href);
const [oldModule, newModule] = await Promise.all([load(oldBuild), load(newBuild)]);
let checks = 0;
for (const capacity of [8, 32, 512]) {
  const oldWorld = new oldModule.ExperienceWorld(32, capacity), newWorld = new newModule.ExperienceWorld(32, capacity);
  for (let sequence = 0; sequence < 240; sequence++) {
    // Deterministic component counterexamples: ties, strict radius boundaries,
    // evictions, missing/color channels and changing insertion/track identities.
    const objects = Array.from({ length: 14 }, (_, index) => ({ id: 'cue-' + (sequence % 5 === 0 ? 13 - index : index),
      type: 'percept', relativePosition: [(index % 4) * .35 + (sequence % 3) * Number.EPSILON,
        Math.floor(index / 4) * .8, -1 - (sequence % 7) * .01],
      properties: index % 3 === 0 ? { red: (sequence % 9) / 10 } : { red: .2, green: .1, blue: index % 2 ? .3 : .30000000000000004 } }));
    const observation = { sequence, activeSeconds: sequence * .05, contextId: 'test-only', targetId: null,
      self: { position: [Math.floor(sequence / 20) * .1, 0, 0], yaw: sequence * .01, pitch: 0, properties: {} }, objects };
    oldWorld.observe(structuredClone(observation)); newWorld.observe(structuredClone(observation));
    assert.deepEqual(newWorld.snapshot(), oldWorld.snapshot(), `world mismatch at capacity ${capacity}, frame ${sequence}`);
    assert.equal(newWorld.novelty(observation), oldWorld.novelty(observation));
    checks++;
  }
}
const result = { version: 'WorldConsumptionDifferential1', status: 'passed', oldBuild: resolve(oldBuild), newBuild: resolve(newBuild),
  checkedCompleteSnapshots: checks, checkedNoveltyQueries: checks, realActions: 0, newIndependentWindows: 0,
  scope: 'Synthetic equality checks of existing remembered-surface association, not physical task or learning evidence.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(result));
