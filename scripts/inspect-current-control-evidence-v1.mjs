/** Compact, read-only inspection of an in-progress or sealed development run. */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
const [directory] = process.argv.slice(2);
if (!directory) throw new Error('evidence-directory-required');
let latest, actions = [], decisions = [], results = [];
const prediction = value => value && ({ valid: value.validSampleCount, progress: value.progressSampleCount,
  unknown: value.unknown, samples: value.prediction?.samples?.length,
  diagnostics: value.readoutDiagnostics });
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (row.kind === 'joint-control-decision') {
    latest = row.value;
    decisions.push(latest.lastDecision); if (decisions.length > 8) decisions.shift();
  }
  if (row.kind === 'control-action-result') actions.push(row.value.offer?.action);
  if (row.kind === 'control-operation-result') {
    results.push({ operation: row.value.operation, keys: Object.keys(row.value) });
    if (results.length > 2) results.shift();
  }
}
console.log(JSON.stringify({ actions, decisions, results, epoch: latest?.workspace.epoch,
  observationSequence: latest?.workspace.observationSequence,
  nodes: latest?.workspace.nodes.filter(n => n.node.kind !== 'exploration').map(n => ({
    id: n.node.nodeId, kind: n.node.kind, action: n.node.candidate?.actionCue,
    members: n.node.candidateMembers?.length,
    condition: n.condition && { fresh: n.condition.fresh, applicability: n.condition.value.applicability,
      production: n.condition.value.productionEligible },
    prediction: prediction(n.prediction?.value),
    firstMember: prediction(n.prediction?.value.memberResults?.[0]?.value),
  })), dependencies: latest?.workspace.dependencies }, null, 2));
