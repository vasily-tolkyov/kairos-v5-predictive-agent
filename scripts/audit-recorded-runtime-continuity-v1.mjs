/** Post-run integrity only; no body, model, worker, or learning calls. */
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { canonical, sha, fileSha } from '../dist/src/util.js';
import { validateEvent } from '../dist/src/events.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('record-directory-and-new-output-required');
const directory = resolve(input), frames = new Map(), rows = [];
let previous, continuityErrors = 0;
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'frames.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line), frame = row.value;
  if (row.kind !== 'frame') throw new Error('unexpected-frame-record');
  if (frames.has(frame.sequence) || previous !== undefined && frame.sequence !== previous + 1) continuityErrors++;
  frames.set(frame.sequence, frame); previous = frame.sequence;
}
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) }))
  if (line) rows.push(JSON.parse(line));
const run = JSON.parse(await readFile(resolve(directory, 'RUN_RESULT.json'), 'utf8'));
const events = rows.filter(row => row.kind === 'real-event').map(row => row.value);
const commits = rows.filter(row => row.kind === 'real-event-committed').map(row => row.value);
const receipts = rows.filter(row => row.kind === 'body-result').map(row => row.value);
let sampledFrames = 0, frameMismatches = 0, receiptMismatches = 0, commitMismatches = 0, lastDecision;
for (const event of events) {
  validateEvent(event);
  for (const frame of event.frames) {
    sampledFrames++;
    if (!frames.has(frame.sequence) || sha(frame) !== sha(frames.get(frame.sequence))) frameMismatches++;
  }
  if (event.bodyResult?.executed && receipts.filter(receipt => canonical(receipt) === canonical(event.bodyResult)).length !== 1)
    receiptMismatches++;
  if (commits.filter(commit => commit.eventId === event.id).length !== 1) commitMismatches++;
}
const actions = [];
for (const row of rows) {
  if (row.kind === 'joint-control-decision') lastDecision = row.value;
  if (row.kind !== 'control-action-result' || !row.value.result.executed) continue;
  const decision = lastDecision?.lastDecision;
  const site = lastDecision?.field.sites.find(site => site.siteId === decision?.siteId);
  const node = lastDecision?.workspace.nodes.find(value => value.node.nodeId === decision?.nodeId)?.node;
  const event = events.find(event => event.id === row.value.result.eventId);
  actions.push({ eventId: row.value.result.eventId, action: row.value.offer.action,
    startSequence: event?.bodyResult?.startSequence, endSequence: event?.bodyResult?.endSequence,
    operation: decision?.operation,
    chosenByConvergedField: !!(decision?.converged && site?.hardEligible
      && (decision.operation === 'execute' || decision.operation === 'observe-public'
        && ['observe', 'wait'].includes(row.value.offer.action.kind))),
    nodeKind: node?.kind ?? null,
    exactExplorationOffer: node?.kind === 'exploration'
      ? canonical(node.offer.action) === canonical(row.value.offer.action) : null });
}
const goalObservations = rows.filter(row => row.kind === 'goal-difference' && row.value.status === 'satisfied')
  .map(row => row.value.observationSequence);
const injected = rows.find(row => row.kind === 'final-goal-injected')?.value;
const predicate = injected?.goal.expression.predicate;
const verifiedGoalSequences = predicate?.observable === 'properties.note'
  ? goalObservations.filter(sequence => frames.get(sequence)?.objects.some(object =>
    object.id === predicate.subject.id && object.properties.note === predicate.target)) : [];
const hashes = { events: await fileSha(resolve(directory, 'events.jsonl')),
  frames: await fileSha(resolve(directory, 'frames.jsonl')) };
const storedHashesMatch = (run.rawEventsSha256 === undefined || run.rawEventsSha256 === hashes.events)
  && (run.rawFramesSha256 === undefined || run.rawFramesSha256 === hashes.frames);
const integrityPassed = continuityErrors === 0 && frameMismatches === 0 && receiptMismatches === 0
  && commitMismatches === 0 && new Set(events.map(event => event.id)).size === events.length
  && events.length === commits.length && actions.length === receipts.filter(receipt => receipt.executed).length
  && actions.every(action => action.chosenByConvergedField && action.exactExplorationOffer !== false)
  && storedHashesMatch;
const result = { version: 'RecordedRuntimeContinuityAuditV1', integrityPassed,
  claimBoundary: 'record-integrity-only-not-general-reasoning-or-causal-qualification',
  frames: frames.size, sampledFrames, continuityErrors, frameMismatches, receiptMismatches, commitMismatches,
  actualEvents: events.length, commits: commits.length, actions,
  controllerDoubleVerification: verifiedGoalSequences.some(sequence => verifiedGoalSequences.some(other => other - sequence >= 5)),
  verifiedGoalSequences, hashes, storedHashesMatch, gameCalls: 0, physicalWrites: 0 };
await writeFile(resolve(output), canonical(result), { flag: 'wx' });
console.log(JSON.stringify({ integrityPassed, frames: frames.size, sampledFrames,
  actions: actions.map(action => action.action.kind), controllerDoubleVerification: result.controllerDoubleVerification }));
if (!integrityPassed) process.exitCode = 1;
