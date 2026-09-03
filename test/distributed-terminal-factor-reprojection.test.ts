import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation } from '../src/contracts.js';
import { distributedPublicSignalIdsV1 } from '../src/core/learning/distributed-r2.js';
import { eventLocalDecodedPublicFeaturesV1, relativePublicFeatures,
  type EventLocalPublicRoleBindingV1 } from '../src/events.js';

function observation(f: boolean, r: boolean): Observation {
  return { sequence: 1, activeSeconds: 1, contextId: 'sparse-terminal-context',
    targetId: 'target', self: { position: [0, 0, 0], yaw: 0, pitch: 0,
      properties: { stable: true } }, objects: [
      { id: 'distractor', type: 'opaque', relativePosition: [0, 0, -1],
        properties: { F: false, R: false } },
      { id: 'target', type: 'opaque', relativePosition: [0, 0, -2],
        properties: { F: f, R: r } },
    ] };
}

const binding: EventLocalPublicRoleBindingV1 = {
  version: 'EventLocalPublicRoleBindingV1', role: 'opaque#0', type: 'opaque',
  directActionTarget: true, stableProperties: {},
};

test('terminal R2A projection maps only clone-decoded values into exact current public channels', () => {
  const current = observation(false, false);
  const terminal = observation(true, false);
  const sparse = eventLocalDecodedPublicFeaturesV1(current, [binding], [
    { subjectRole: 'opaque#0', property: 'F', value: true },
  ]);

  // opaque#0 is an event-local role, not a public-object ordinal.  Because a
  // nearer same-type object exists, the bound target occupies public ordinal
  // 1 in the R2A vocabulary.
  assert.deepEqual(sparse.features, { 'visible/opaque/1/F=true': 1 });
  assert.equal(Object.keys(sparse.features).some(key => key.includes('/R')), false,
    'an undecoded current property leaked into the hypothetical terminal');
  const sparseSignals = distributedPublicSignalIdsV1(sparse.features);
  const actualTerminalSignals = new Set(distributedPublicSignalIdsV1(relativePublicFeatures(terminal)));
  assert(sparseSignals.length > 0);
  assert(sparseSignals.every(signal => actualTerminalSignals.has(signal)),
    'sparse terminal encoding does not use the real relativePublicFeatures signal vocabulary');
});

test('an explicitly decoded unchanged terminal value is retained but its neighbours remain unknown', () => {
  const current = observation(false, false);
  const sparse = eventLocalDecodedPublicFeaturesV1(current, [binding], [
    { subjectRole: 'opaque#0', property: 'F', value: false },
  ]);
  assert.deepEqual(sparse.features, { 'visible/opaque/1/F=false': 1 });
  assert.equal(sparse.mappedValueCount, 1);
  assert.equal(Object.keys(sparse.features).some(key => key.includes('/R')), false);
  const currentSignals = new Set(distributedPublicSignalIdsV1(relativePublicFeatures(current)));
  assert(distributedPublicSignalIdsV1(sparse.features).every(signal => currentSignals.has(signal)));
});
