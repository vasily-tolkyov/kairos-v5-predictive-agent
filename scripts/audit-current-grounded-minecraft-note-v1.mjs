/** Read-only post-run audit. Never supplies a goal, action, or missing result. */
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { canonical, sha, fileSha } from '../dist/src/util.js';
import { validateEvent } from '../dist/src/events.js';
import { selectExecutablePhysicalMemberV1 } from '../dist/src/control/controller.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('run-directory-and-new-audit-file-required');
const directory = resolve(input), frames = new Map(), rows = [];
let previousSequence, continuityErrors = 0;
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'frames.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line), frame = row.value;
  if (row.kind !== 'frame') throw new Error('unexpected-frame-record');
  if (frames.has(frame.sequence) || previousSequence !== undefined && frame.sequence !== previousSequence + 1)
    continuityErrors++;
  previousSequence = frame.sequence;
  frames.set(frame.sequence, { sha256: sha(frame), frame });
}
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) }))
  if (line) rows.push(JSON.parse(line));
const run = JSON.parse(await readFile(resolve(directory, 'RUN_RESULT.json'), 'utf8'));
const injected = rows.find(row => row.kind === 'final-goal-injected');
const targetId = injected?.value.goal.expression.predicate.subject.id;
const frozen = rows.find(row => row.kind === 'frozen-experience-restored')?.value;
const receipts = rows.filter(row => row.kind === 'body-result').map(row => row.value);
const events = rows.filter(row => row.kind === 'real-event').map(row => row.value);
const commits = rows.filter(row => row.kind === 'real-event-committed').map(row => row.value);
let frameMismatches = 0, receiptMismatches = 0, lastDecision;
const selectedActions = [];
for (const event of events) {
  validateEvent(event);
  for (const frame of event.frames) if (frames.get(frame.sequence)?.sha256 !== sha(frame)) frameMismatches++;
  if (event.bodyResult?.executed && receipts.filter(receipt => canonical(receipt) === canonical(event.bodyResult)).length !== 1)
    receiptMismatches++;
}
for (const row of rows) {
  if (row.kind === 'joint-control-decision') lastDecision = row.value;
  if (row.kind !== 'control-action-result') continue;
  const decision = lastDecision?.lastDecision;
  const node = lastDecision?.workspace.nodes.find(value => value.node.nodeId === decision?.nodeId);
  const site = lastDecision?.field.sites.find(value => value.siteId === decision?.siteId);
  const candidates = node?.node.kind === 'experienced'
    ? node.node.candidateMembers ?? [node.node.candidate] : [];
  // This runner's direct public result goal has no implicit factor target.
  // Other node kinds remain explicitly unverified here, never silently passed.
  const member = node?.condition?.fresh && node?.prediction?.fresh
    ? selectExecutablePhysicalMemberV1(candidates, node.condition.value, node.prediction.value, [], true) : null;
  const action = row.value.offer.action;
  const exactCue = member !== null && member.candidate.actionCue.kind === action.kind
    && canonical(member.candidate.actionCue.parameters) === canonical(action.parameters);
  const physicalEvidence = member?.prediction.currentEvidence ?? member?.candidate.evidence ?? null;
  const frozenEvidenceOnly = !!(physicalEvidence && frozen?.eventIds?.includes(physicalEvidence.eventId)
    && physicalEvidence.r2a.relationIds.length > 0
    && physicalEvidence.r2a.relationIds.every(id => frozen.relationIds.includes(id))
    && ['r1', 'r2', 'r2a'].every(layer => physicalEvidence[layer].footprintTraceIds.length > 0
      && physicalEvidence[layer].footprintTraceIds.every(id => frozen.physicalTraceIds[layer].includes(id))));
  const actualEvent = events.find(event => event.id === row.value.result.eventId);
  const targetBefore = actualEvent?.frames[0].objects.find(object => object.id === targetId);
  const targetAfter = actualEvent?.frames.at(-1).objects.find(object => object.id === targetId);
  const observedGoalTransition = targetBefore?.properties.note === '0' && targetAfter?.properties.note === '1';
  selectedActions.push({ action, executed: row.value.result.executed,
    eventId: row.value.result.eventId, nodeKind: node?.node.kind ?? null,
    decision: decision ?? null, fieldDrives: site?.drives ?? null,
    physicallyQualifiedDirectGoalAction: !!(exactCue && frozenEvidenceOnly && decision?.converged && site?.hardEligible
      && site.productiveGrounding?.kind === 'physical-branch'),
    frozenEvidenceOnly, observedGoalTransition,
    candidateId: member?.candidate.candidateId ?? null,
    physicalEvidence,
    validSamples: member?.prediction.validSampleCount ?? 0,
    progressFraction: member?.progress ?? 0,
    condition: member?.condition ?? null,
  });
}
const satisfyingSequences = [...frames.values()].map(value => value.frame)
  .filter(frame => frame.sequence >= (injected?.value.observation.sequence ?? Infinity)
    && frame.objects.some(object => object.id === targetId && object.properties.note === '1'))
  .map(frame => frame.sequence);
const publicDoubleVerification = satisfyingSequences.length > 0
  && satisfyingSequences.at(-1) - satisfyingSequences[0] >= 5;
const experiencedExecutions = selectedActions.filter(value => value.executed && value.physicallyQualifiedDirectGoalAction);
const predictedRealGoalTransitions = experiencedExecutions.filter(value => value.observedGoalTransition);
const evidenceIntegrity = continuityErrors === 0 && frameMismatches === 0 && receiptMismatches === 0
  && new Set(events.map(event => event.id)).size === events.length
  && new Set(commits.map(commit => commit.eventId)).size === commits.length
  && events.length === commits.length
  && run.newActions <= run.plan.maximumNewActions
  && selectedActions.filter(value => value.executed).length === receipts.filter(value => value.executed).length;
const audit = { version: 'GroundedMinecraftDevelopmentAuditV1',
  passed: evidenceIntegrity && run.failure === null && run.result?.status === 'goal-verified'
    && publicDoubleVerification && predictedRealGoalTransitions.length > 0,
  claimBoundary: 'direct-public-goal-on-heldout-layout-not-general-multistep-reasoning',
  evidenceIntegrity, publicDoubleVerification, satisfyingSequences,
  frameCount: frames.size, continuityErrors, frameMismatches, receiptMismatches,
  actualEvents: events.length, actualReceipts: receipts.length, commits: commits.length,
  selectedActions, experiencedExecutions: experiencedExecutions.length,
  predictedRealGoalTransitions: predictedRealGoalTransitions.length,
  explorationExecutions: selectedActions.filter(value => value.executed && value.nodeKind === 'exploration').length,
  predictionCalls: rows.filter(row => row.kind === 'control-operation-result'
    && row.value.event.operation === 'predict-branch').length,
  eventsSha256: await fileSha(resolve(directory, 'events.jsonl')),
  framesSha256: await fileSha(resolve(directory, 'frames.jsonl')),
  gameCallsFromAudit: 0, physicalWritesFromAudit: 0,
};
await writeFile(resolve(output), canonical(audit), { flag: 'wx' });
console.log(JSON.stringify({ passed: audit.passed, evidenceIntegrity, publicDoubleVerification,
  experiencedExecutions: experiencedExecutions.length, explorationExecutions: audit.explorationExecutions,
  frameCount: frames.size }));
if (!audit.passed) process.exitCode = 1;
