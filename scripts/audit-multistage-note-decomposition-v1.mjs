/** Post-hoc only. No Minecraft, controller, memory, or scoring feedback calls. */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { canonical, sha, fileSha, saveJson } from '../dist/src/util.js';
import { validateEvent } from '../dist/src/events.js';
import { selectExecutablePhysicalMemberV1 } from '../dist/src/control/controller.js';
import { expectedNoteMilestonesV1 } from '../dist/src/evaluation/note-progression-test-contract.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('run-directory-and-new-audit-file-required');
const directory = resolve(input), rows = [], frames = new Map();
let previous, continuityErrors = 0;
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'frames.jsonl')) })) {
  if (!line) continue;
  const { kind, value } = JSON.parse(line);
  if (kind !== 'frame') throw new Error('unexpected-frame-record');
  if (frames.has(value.sequence) || previous !== undefined && value.sequence !== previous + 1) continuityErrors++;
  previous = value.sequence;
  frames.set(value.sequence, { frame: value, hash: sha(value) });
}
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) }))
  if (line) rows.push(JSON.parse(line));
const run = JSON.parse(await readFile(resolve(directory, 'RUN_RESULT.json'), 'utf8'));
const injected = rows.find(row => row.kind === 'final-goal-injected')?.value;
const goal = injected?.goal, predicate = goal?.expression.predicate;
const targetId = predicate?.subject.id;
const frozen = rows.find(row => row.kind === 'frozen-experience-restored')?.value;
const receipts = rows.filter(row => row.kind === 'body-result').map(row => row.value);
const events = rows.filter(row => row.kind === 'real-event').map(row => row.value);
const commits = rows.filter(row => row.kind === 'real-event-committed').map(row => row.value);
let embeddedFrameMismatches = 0, receiptMismatches = 0;
for (const event of events) {
  validateEvent(event);
  for (const frame of event.frames) if (frames.get(frame.sequence)?.hash !== sha(frame)) embeddedFrameMismatches++;
  if (event.bodyResult?.executed && receipts.filter(r => canonical(r) === canonical(event.bodyResult)).length !== 1)
    receiptMismatches++;
}
let lastDecision;
const actions = [], requirements = [];
for (const [rowIndex, row] of rows.entries()) {
  if (row.kind === 'control-historical-transition-requirement') requirements.push({ rowIndex, ...row.value });
  if (row.kind === 'joint-control-decision') lastDecision = row.value;
  if (row.kind !== 'control-action-result') continue;
  const decision = lastDecision?.lastDecision;
  const node = lastDecision?.workspace.nodes.find(value => value.node.nodeId === decision?.nodeId);
  const site = lastDecision?.field.sites.find(value => value.siteId === decision?.siteId);
  const candidates = node?.node.kind === 'experienced' ? node.node.candidateMembers ?? [node.node.candidate] : [];
  const member = node?.condition?.fresh && node?.prediction?.fresh
    ? selectExecutablePhysicalMemberV1(candidates, node.condition.value, node.prediction.value, [], true) : null;
  const action = row.value.offer.action, event = events.find(e => e.id === row.value.result.eventId);
  const evidence = member?.prediction.currentEvidence ?? member?.candidate.evidence ?? null;
  const frozenEvidenceOnly = !!(evidence && frozen?.eventIds.includes(evidence.eventId)
    && evidence.r2a.relationIds.length > 0 && evidence.r2a.relationIds.every(id => frozen.relationIds.includes(id))
    && ['r1', 'r2', 'r2a'].every(layer => evidence[layer].footprintTraceIds.length > 0
      && evidence[layer].footprintTraceIds.every(id => frozen.physicalTraceIds[layer].includes(id))));
  const exactCue = member && member.candidate.actionCue.kind === action.kind
    && canonical(member.candidate.actionCue.parameters) === canonical(action.parameters);
  const rootRetained = lastDecision?.workspace.nodes.some(n => n.node.kind === 'root'
    && canonical(n.node.goal) === canonical(goal)) === true;
  const objectiveNode = lastDecision?.workspace.nodes.find(n => n.node.nodeId === node?.node.objectiveNodeId)?.node;
  const before = event?.frames[0]?.objects.find(o => o.id === targetId)?.properties.note;
  const after = event?.frames.at(-1)?.objects.find(o => o.id === targetId)?.properties.note;
  actions.push({ rowIndex, action, eventId: event?.id, executed: row.value.result.executed,
    before, after, startSequence: event?.bodyResult?.startSequence, endSequence: event?.bodyResult?.endSequence,
    nodeKind: node?.node.kind, rootRetained, objective: objectiveNode?.goal ?? null,
    conditionObservationSequence: node?.condition?.observationSequence ?? null,
    predictionObservationSequence: node?.prediction?.observationSequence ?? null,
    decision, drives: site?.drives, dependencies: lastDecision?.workspace.dependencies,
    physical: !!(exactCue && frozenEvidenceOnly && decision?.converged && site?.hardEligible
      && site.productiveGrounding?.kind === 'physical-branch'), frozenEvidenceOnly,
    validSamples: member?.prediction.validSampleCount ?? 0, progress: member?.progress ?? 0, evidence });
}
const first = actions.find(a => a.executed && a.before === '0' && a.after === '1');
const second = actions.find(a => a.executed && a.before === '1' && a.after === '2'
  && a.rowIndex > (first?.rowIndex ?? Infinity));
const intermediate = requirements.find(r => r.goal?.expression?.predicate?.target === '1'
  && r.goal.expression.predicate.subject.id === targetId && r.rowIndex < (first?.rowIndex ?? -1));
const firstObjectiveMatchesIntermediate = !!(first && intermediate
  && canonical(first.objective) === canonical(intermediate.goal));
const secondObjectiveIsRoot = !!(second && canonical(second.objective) === canonical(goal));
const initialNote = Number(injected?.observation.objects.find(o => o.id === targetId)?.properties.note);
const targetNote = Number(predicate?.target);
const expected = expectedNoteMilestonesV1(initialNote, targetNote);
let previousMilestone = null;
const milestones = expected.map((transition, index) => {
  const action = actions.find(value => value.executed && value.before === transition.before
    && value.after === transition.after && value.rowIndex > (previousMilestone?.rowIndex ?? -1));
  const requirement = index === expected.length - 1 ? null : requirements.find(value =>
    value.goal?.expression?.predicate?.target === transition.after
    && value.goal.expression.predicate.subject.id === targetId
    && value.rowIndex < (action?.rowIndex ?? -1));
  const expectedObjective = index === expected.length - 1 ? goal : requirement?.goal;
  const objectiveMatches = !!action && !!expectedObjective
    && canonical(action.objective) === canonical(expectedObjective);
  const freshFeedback = !!action && (index === 0 || !!previousMilestone
    && action.conditionObservationSequence >= previousMilestone.endSequence
    && action.predictionObservationSequence >= previousMilestone.endSequence);
  const passed = !!(action?.physical && action.frozenEvidenceOnly && action.rootRetained
    && objectiveMatches && freshFeedback);
  if (action) previousMilestone = action;
  return { ...transition, eventId: action?.eventId ?? null, actionRow: action?.rowIndex ?? null,
    requirement: requirement ?? null, objectiveMatches, freshFeedback, passed };
});
const changedActions = actions.filter(action => action.executed && action.before !== action.after);
const exactTransitionCount = changedActions.length === expected.length;
const verifiedFrames = [...frames.values()].map(f => f.frame).filter(f =>
  f.sequence >= (injected?.observation.sequence ?? Infinity)
  && f.sequence <= (run.result?.goalEvaluation?.observationSequence ?? -1)
  && f.objects.some(o => o.id === targetId && o.properties.note === String(targetNote))).map(f => f.sequence);
const doubleVerification = verifiedFrames.length > 0 && verifiedFrames.at(-1) - verifiedFrames[0] >= 5;
const integrity = continuityErrors === 0 && embeddedFrameMismatches === 0 && receiptMismatches === 0
  && new Set(events.map(e => e.id)).size === events.length
  && new Set(commits.map(c => c.eventId)).size === commits.length && events.length === commits.length
  && actions.filter(a => a.executed).length === receipts.filter(r => r.executed).length;
const initialIsZero = injected?.observation.objects.some(o => o.id === targetId && o.properties.note === '0');
const passed = integrity && run.failure === null && run.result?.status === 'goal-verified'
  && initialNote === run.plan.initialNote && targetNote === run.plan.targetNote
  && expected.length > 0 && milestones.every(value => value.passed) && exactTransitionCount
  && doubleVerification && run.sourcePointerUnchanged;
await saveJson(resolve(output), { version: 'MultistageNoteDecompositionAuditV2', passed: !!passed,
  claim: 'separately learned public transitions composed by production joint control in real Minecraft',
  initialNote, targetNote, milestones, exactTransitionCount,
  initialIsZero, intermediate, firstObjectiveMatchesIntermediate, secondObjectiveIsRoot, doubleVerification,
  integrity, continuityErrors, embeddedFrameMismatches, receiptMismatches, rawFrameCount: frames.size,
  actions, requirements, run, verifiedFrames,
  eventsSha256: await fileSha(resolve(directory, 'events.jsonl')),
  framesSha256: await fileSha(resolve(directory, 'frames.jsonl')) });
console.log(JSON.stringify({ passed: !!passed, integrity, newActions: run.newActions,
  initialNote, targetNote, requiredTransitions: expected.length,
  physicallySupportedMilestones: milestones.filter(value => value.passed).length,
  exactTransitionCount, doubleVerification }));
if (!passed) process.exitCode = 1;
