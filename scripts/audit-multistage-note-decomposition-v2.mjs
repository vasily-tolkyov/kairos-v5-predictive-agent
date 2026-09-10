/** Post-hoc graph audit: public-state and opaque-factor dependencies are both
 * legitimate controller representations. No planning or Minecraft calls. */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { canonical, sha, fileSha, saveJson } from '../dist/src/util.js';
import { validateEvent } from '../dist/src/events.js';
import { selectExecutablePhysicalMemberV1, factorTransitionCandidateForControlV2 }
  from '../dist/src/control/controller.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('run-directory-and-new-audit-file-required');
const directory = resolve(input), rows = [], frames = new Map();
let previous, continuityErrors = 0;
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'frames.jsonl')) })) {
  if (!line) continue;
  const { kind, value } = JSON.parse(line);
  if (kind !== 'frame') throw new Error('unexpected-frame-record');
  if (frames.has(value.sequence) || previous !== undefined && value.sequence !== previous + 1) continuityErrors++;
  previous = value.sequence; frames.set(value.sequence, { frame: value, hash: sha(value) });
}
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) }))
  if (line) rows.push(JSON.parse(line));
const run = JSON.parse(await readFile(resolve(directory, 'RUN_RESULT.json'), 'utf8'));
const injected = rows.find(row => row.kind === 'final-goal-injected')?.value;
const goal = injected?.goal, predicate = goal?.expression.predicate, targetId = predicate?.subject.id;
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
  const workspace = lastDecision?.workspace, decision = lastDecision?.lastDecision;
  const node = workspace?.nodes.find(value => value.node.nodeId === decision?.nodeId);
  const site = lastDecision?.field.sites.find(value => value.siteId === decision?.siteId);
  const parentEdges = (workspace?.dependencies ?? []).filter(edge => edge.kind === 'opaque-factor'
    && edge.requiredNodeId === node?.node.nodeId);
  const desiredFactors = [...new Set(parentEdges.flatMap(edge => edge.factorIds))].sort();
  const candidates = node?.node.kind === 'experienced' ? node.node.candidateMembers ?? [node.node.candidate]
    : node?.node.kind === 'factor-transition' ? (node.node.transitionMembers ?? [node.node.transition])
      .map(value => factorTransitionCandidateForControlV2(value, desiredFactors)) : [];
  const fresh = !!(node?.condition?.fresh && node?.prediction?.fresh
    && node.condition.observationSequence === node.prediction.observationSequence
    && node.condition.epoch === node.prediction.epoch);
  const member = fresh ? selectExecutablePhysicalMemberV1(candidates,
    node.condition.value, node.prediction.value, desiredFactors, true) : null;
  const action = row.value.offer.action, event = events.find(e => e.id === row.value.result.eventId);
  const evidence = member?.prediction.currentEvidence ?? member?.candidate.evidence ?? null;
  const frozenEvidenceOnly = !!(evidence && frozen?.eventIds.includes(evidence.eventId)
    && evidence.r2a.relationIds.length > 0 && evidence.r2a.relationIds.every(id => frozen.relationIds.includes(id))
    && ['r1', 'r2', 'r2a'].every(layer => evidence[layer].footprintTraceIds.length > 0
      && evidence[layer].footprintTraceIds.every(id => frozen.physicalTraceIds[layer].includes(id))));
  const exactCue = member && member.candidate.actionCue.kind === action.kind
    && canonical(member.candidate.actionCue.parameters) === canonical(action.parameters);
  const objectiveNode = workspace?.nodes.find(n => n.node.nodeId === node?.node.objectiveNodeId)?.node;
  const before = event?.frames[0]?.objects.find(o => o.id === targetId)?.properties.note;
  const after = event?.frames.at(-1)?.objects.find(o => o.id === targetId)?.properties.note;
  actions.push({ rowIndex, action, eventId: event?.id, executed: row.value.result.executed,
    before, after, startSequence: event?.bodyResult?.startSequence, endSequence: event?.bodyResult?.endSequence,
    nodeId: node?.node.nodeId, nodeKind: node?.node.kind,
    rootRetained: workspace?.nodes.some(n => n.node.kind === 'root' && canonical(n.node.goal) === canonical(goal)) === true,
    objective: objectiveNode?.goal ?? null, decision, drives: site?.drives,
    parentEdges, desiredFactors, dependencies: workspace?.dependencies,
    physical: !!(exactCue && frozenEvidenceOnly && fresh && decision?.converged && site?.hardEligible
      && site.productiveGrounding?.kind === 'physical-branch'), frozenEvidenceOnly,
    validSamples: member?.prediction.validSampleCount ?? 0, progress: member?.progress ?? 0,
    progressBasis: member?.prediction.progressBasis ?? null, nextStates: member?.prediction.nextStates ?? [],
    condition: member?.condition ?? null, conditionSequence: node?.condition?.observationSequence,
    predictionSequence: node?.prediction?.observationSequence, evidence });
}
const first = actions.find(a => a.executed && a.before === '0' && a.after === '1');
const second = actions.find(a => a.executed && a.before === '1' && a.after === '2'
  && a.rowIndex > (first?.rowIndex ?? Infinity));
const intermediate = requirements.find(r => r.goal?.expression?.predicate?.target === '1'
  && r.goal.expression.predicate.subject.id === targetId && r.rowIndex < (first?.rowIndex ?? -1));
const explicitIntermediateAction = !!(first && intermediate && canonical(first.objective) === canonical(intermediate.goal));
function factorChainVerified(first, second, intermediate) {
  if (!first || !second || !intermediate || first.nodeKind !== 'factor-transition'
    || first.progressBasis !== 'parent-R2A-relation-complete' || first.progress < .75
    || first.validSamples < 8 || first.desiredFactors.length === 0) return false;
  const edge = first.parentEdges.find(edge => edge.dependentNodeId === second.nodeId
    && edge.dependentNodeId === intermediate.dependentNodeId);
  if (!edge || edge.factorIds.length === 0 || edge.createdObservationSequence > first.startSequence) return false;
  const establishesFactors = first.nextStates.filter(state => edge.factorIds.every(id => state.knownActiveFactorIds.includes(id))).length
    / Math.max(1, first.nextStates.length) >= .75;
  return establishesFactors && second.conditionSequence >= first.endSequence
    && second.predictionSequence === second.conditionSequence
    && second.condition?.productionEligible && second.condition.applicability > 0
    && second.condition.unknownFactorIds.length === 0 && second.condition.contradictedFactorIds.length === 0
    && edge.factorIds.every(id => second.condition.matchedFactorIds.includes(id));
}
const opaqueIntermediateAction = !!factorChainVerified(first, second, intermediate);
const secondObjectiveIsRoot = !!(second && canonical(second.objective) === canonical(goal));
const verifiedFrames = [...frames.values()].map(f => f.frame).filter(f =>
  f.sequence >= (injected?.observation.sequence ?? Infinity)
  && f.objects.some(o => o.id === targetId && o.properties.note === '2')).map(f => f.sequence);
const doubleVerification = verifiedFrames.length > 0 && verifiedFrames.at(-1) - verifiedFrames[0] >= 5;
const integrity = continuityErrors === 0 && embeddedFrameMismatches === 0 && receiptMismatches === 0
  && new Set(events.map(e => e.id)).size === events.length && new Set(commits.map(c => c.eventId)).size === commits.length
  && events.length === commits.length && actions.filter(a => a.executed).length === receipts.filter(r => r.executed).length;
const initialIsZero = injected?.observation.objects.some(o => o.id === targetId && o.properties.note === '0');
const passed = integrity && run.failure === null && run.result?.status === 'goal-verified' && initialIsZero
  && predicate?.target === '2' && first?.physical && second?.physical && first.rootRetained && second.rootRetained
  && (explicitIntermediateAction || opaqueIntermediateAction) && secondObjectiveIsRoot
  && doubleVerification && run.sourcePointerUnchanged;
const counterchecks = opaqueIntermediateAction ? {
  missingDependencyRejected: !factorChainVerified({ ...first, parentEdges: [] }, second, intermediate),
  staleConditionRejected: !factorChainVerified(first, { ...second, conditionSequence: first.startSequence - 1 }, intermediate),
  unsupportedProjectionRejected: !factorChainVerified({ ...first, nextStates: [] }, second, intermediate),
} : null;
await saveJson(resolve(output), { version: 'MultistageNoteDecompositionAuditV2', passed: !!passed,
  claim: 'two independently learned public transitions composed by production joint control in real Minecraft',
  criteria: 'DECOMPOSITION_AUDIT_CRITERIA.md, recorded before the first action',
  initialIsZero, intermediate, explicitIntermediateAction, opaqueIntermediateAction, secondObjectiveIsRoot,
  doubleVerification, integrity, continuityErrors, embeddedFrameMismatches, receiptMismatches, counterchecks,
  rawFrameCount: frames.size, actions, requirements, run, verifiedFrames,
  eventsSha256: await fileSha(resolve(directory, 'events.jsonl')),
  framesSha256: await fileSha(resolve(directory, 'frames.jsonl')) });
console.log(JSON.stringify({ passed: !!passed, integrity, newActions: run.newActions,
  firstPhysical: first?.physical ?? false, secondPhysical: second?.physical ?? false,
  explicitIntermediateAction, opaqueIntermediateAction, secondObjectiveIsRoot, doubleVerification, counterchecks }));
if (!passed || counterchecks && Object.values(counterchecks).some(value => !value)) process.exitCode = 1;
