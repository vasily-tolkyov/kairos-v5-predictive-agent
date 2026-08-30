import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) throw new Error('usage:summarize-heldout-control-log.mjs:<events.jsonl>');
const counts = new Map();
const decisions = new Map();
const operations = new Map();
const actions = [];
const actionResults = [];
const tail = [];
let lines = 0, maximumNodes = 0, maximumSequence = 0, unconverged = 0;
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!line) continue;
  lines++;
  const record = JSON.parse(line);
  counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  const value = record.value ?? {};
  if (record.kind === 'joint-control-decision') {
    const decision = value.lastDecision ?? value.field?.lastDecision ?? {};
    const key = `${decision.operation ?? 'missing'}:${decision.converged === true ? 'converged' : 'unconverged'}`;
    decisions.set(key, (decisions.get(key) ?? 0) + 1);
    if (decision.converged !== true) unconverged++;
    maximumNodes = Math.max(maximumNodes, value.workspace?.nodes?.length ?? 0);
    maximumSequence = Math.max(maximumSequence, value.workspace?.observationSequence ?? 0);
  }
  if (record.kind === 'control-operation-result') {
    const key = `${value.event?.operation ?? 'missing'}:${value.accepted?.reason ?? 'missing'}`;
    operations.set(key, (operations.get(key) ?? 0) + 1);
  }
  if (record.kind === 'body-result') actions.push({ sequence: value.endSequence,
    kind: value.action?.kind, parameters: value.action?.parameters, status: value.status, executed: value.executed });
  if (record.kind === 'control-action-result') actionResults.push({
    offer: value.offer,
    executed: value.result?.executed,
    refusal: value.result?.refusal ?? null,
    eventId: value.result?.eventId ?? null,
    observation: value.result?.observation ? {
      sequence: value.result.observation.sequence,
      targetId: value.result.observation.targetId,
      target: value.result.observation.objects?.find(object => object.id === value.result.observation.targetId) ?? null,
      yaw: value.result.observation.self?.yaw,
      pitch: value.result.observation.self?.pitch,
    } : null,
  });
  if (record.kind === 'goal-difference' || record.kind === 'control-action-result'
    || record.kind === 'control-action-reality-refusal') {
    tail.push({ kind: record.kind, value });
    if (tail.length > 12) tail.shift();
  }
}
const sorted = map => Object.fromEntries([...map].sort((left, right) => left[0].localeCompare(right[0], 'en')));
console.log(JSON.stringify({ lines, counts: sorted(counts), decisions: sorted(decisions), operations: sorted(operations),
  actionCount: actions.length, actions, actionResults, maximumNodes, maximumSequence, unconverged, tail }, null, 2));
