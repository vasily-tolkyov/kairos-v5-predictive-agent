import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { offlineProfile } from '../src/services.js';
const require = createRequire(import.meta.url);
const protocol = require('minecraft-protocol/src/datatypes/uuid.js');
test('new-world whitelist uses the exact case-sensitive offline protocol profile, without account lookup', () => {
  const exact = offlineProfile('KairosV5Bot');
  assert.equal(exact.uuid, protocol.nameToMcOfflineUUID(exact.name));
  assert.notEqual(exact.uuid, offlineProfile('kairosv5bot').uuid);
});
