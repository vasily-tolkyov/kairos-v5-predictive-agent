import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { exactPublicBlockHit, publicBlockInteractionPacket } from '../src/body.js';

test('block interaction preserves the real public ray face and cursor instead of inventing a center hit', () => {
  const block = { face: 2, intersect: new Vec3(4.25, 65.75, 8), position: new Vec3(4, 65, 8) };
  const hit = exactPublicBlockHit(block as never);
  assert.deepEqual(hit.direction, new Vec3(0, 0, -1));
  assert.deepEqual(hit.cursor, new Vec3(.25, .75, 0));
  assert.throws(() => exactPublicBlockHit({ face: undefined, position: new Vec3(0, 0, 0) } as never),
    /public-block-ray-hit-missing/);
});

test('public block interaction uses the real hit and a positive monotonic protocol sequence', () => {
  const block = { face: 3, position: new Vec3(4, 65, 7), intersect: new Vec3(4.25, 65.75, 8) } as never;
  const hit = exactPublicBlockHit(block);
  assert.deepEqual(publicBlockInteractionPacket(block, hit, 2), {
    hand: 0, location: new Vec3(4, 65, 7), direction: 3,
    cursorX: .25, cursorY: .75, cursorZ: 1, insideBlock: false, worldBorderHit: false, sequence: 2,
  });
  assert.equal(publicBlockInteractionPacket(block, hit, 0).sequence, 0);
  assert.throws(() => publicBlockInteractionPacket(block, hit, -1), /invalid-public-block-interaction-sequence/);
});
