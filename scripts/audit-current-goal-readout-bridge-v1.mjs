/** Replay only the readout-to-control handoff; no new physical simulation. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eventRows } from '../dist/src/events.js';
import { distributedGoalReadoutDiagnosticsV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { historicalTransitionPreconditionV1 } from '../dist/src/control/controller.js';
import { fileSha, saveJson } from '../dist/src/util.js';
const [diagnostic, capture, output] = process.argv.slice(2);
const queryPath = resolve(diagnostic, 'QUERY_0_2.json');
const predictionPath = resolve(diagnostic, 'PREDICTION_0_2.json');
const query = JSON.parse(await readFile(queryPath, 'utf8'));
const result = JSON.parse(await readFile(predictionPath, 'utf8'));
const rows = (await readFile(resolve(capture, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const source = rows.find(row => row.kind === 'real-event' && row.value.id === result.candidate.evidence.eventId)?.value;
assert(source, 'missing-real-role-provenance');
const readouts = result.prediction.nextStates.map(state => ({ valid: true,
  decodedValues: state.knownChanges.map(change => ({ subjectRole: change.subject,
    property: change.property, value: change.after })) }));
const diagnostics = distributedGoalReadoutDiagnosticsV1(readouts, query.goal, query.observation, eventRows(source).roleBindings);
assert(result.prediction.validSampleCount >= 8);
assert.equal(result.prediction.progressFraction, 0);
assert.equal(diagnostics.roleBindingStatus, 'matched');
assert.equal(diagnostics.goalRelevantKernelVisited, true);
const requirement = historicalTransitionPreconditionV1(query.candidates, query.goal, query.observation);
assert.equal(requirement?.expression.predicate.target, '1');
await saveJson(output, { passed: true, diagnostics, requirement,
  rawQuerySha256: await fileSha(queryPath), rawPredictionSha256: await fileSha(predictionPath),
  noNewSimulation: true, noGameCalls: true, noPhysicalWrites: true,
  originalSourceNotReboundToNewFullRun: true,
  sources: await Promise.all(['src/distributed-hierarchical-memory.ts', 'src/control/controller.ts', 'src/events.ts']
    .map(async path => ({ path, sha256: await fileSha(path) }))) });
console.log(JSON.stringify({ passed: true, decodedButNotFinal: true, subgoal: requirement.expression.predicate.target }));
