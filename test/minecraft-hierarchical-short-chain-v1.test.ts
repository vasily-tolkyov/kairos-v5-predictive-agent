import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  MINECRAFT_HIERARCHICAL_SHORT_CHAIN_AUDITED_INPUT_V1,
  preflightMinecraftHierarchicalShortChainV1,
} from '../src/evaluation/minecraft-hierarchical-short-chain-v1.js';

test('hierarchical Minecraft short-chain preflight fails closed before live execution', async () => {
  const result = preflightMinecraftHierarchicalShortChainV1();
  assert.equal(result.mixedInitialization.r1AtomCount, 128);
  assert.equal(result.mixedInitialization.exactlyFillsInitialization, true);
  assert.equal(result.mixedInitialization.vocabularyCovered, true);
  assert.equal(result.mixedInitialization.legacyResetR2EventUpperBound, 0);
  assert.equal(result.prospectiveIntervention.availableNonReusedPairs, 4);
  assert.equal(result.prospectiveIntervention.factorCapacity, 1);
  assert.equal(result.prospectiveIntervention.requiredFactors, 2);
  assert.equal(result.prospectiveIntervention.requiredNonReusedPairs, 8);
  assert.equal(result.prospectiveIntervention.requiredEvents, 16);
  assert.equal(result.prospectiveIntervention.missingEvents, 8);
  assert.equal(result.prospectiveIntervention.enoughForAllFactors, false);
  assert.equal(result.prospectiveIntervention.isolatesExactlyOnePublicToken, false);
  assert.equal(result.go, false);
  assert.equal(result.classification, 'blocked-by-r2a-factor-identification');
  assert.equal(result.minecraftExecutionPermitted, false);

  // Bind the arithmetic audit to current owning-module invariants.
  const [learner, hierarchy] = await Promise.all([
    readFile(resolve('src/core/learning/r2a-stable-pattern.ts'), 'utf8'),
    readFile(resolve('src/core/learning/r2-continuous-event.ts'), 'utf8'),
  ]);
  assert.match(learner, /item\.pairIds\.length < 4/);
  assert.match(learner, /targetConsistency < \.8 \|\| otherConsistency < \.8/);
  assert.match(learner, /contrastPatternIds\.length !== 1/);
  assert.match(learner, /factorSetInterventions/);
  assert.match(learner, /minimumDrop >= \.25/);
  assert.match(learner, /intervention-event-reused-across-pairs/);
  assert.match(hierarchy, /minimumR1Atoms: 2/);
  assert.deepEqual(MINECRAFT_HIERARCHICAL_SHORT_CHAIN_AUDITED_INPUT_V1
    .foundationCategoricalValues, ['0', '1', '2']);
});
