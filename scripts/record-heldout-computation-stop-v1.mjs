/** Preserve an explicitly aborted development run before stopping its owned processes. */
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [directory] = process.argv.slice(2);
if (!directory) throw new Error('run-directory-required');
const state = await (await fetch('http://127.0.0.1:3002/state')).json();
const decisions = [], operations = [], actions = [];
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (row.kind === 'joint-control-decision') decisions.push(row.value.lastDecision);
  if (row.kind === 'control-operation-result') operations.push({ accepted: row.value.accepted,
    operation: row.value.event.operation, requestId: row.value.event.requestId });
  if (row.kind === 'control-action-result') actions.push(row.value);
}
const source = await readFile('src/core/learning/distributed-r2a-physical.ts');
const result = { version: 'DevelopmentComputationStopV1', at: new Date().toISOString(),
  status: 'aborted-before-action-for-exact-computation-reuse', decisions, operations, actions,
  runtime: { sequence: state.runtime.publicObservation?.sequence,
    computeQueue: state.runtime.computeQueue, sessionPhysicalEvents: state.runtime.sessionPhysicalEvents },
  inspectedSourceSha256: createHash('sha256').update(source).digest('hex'),
  mechanism: 'The candidate group repeats predictCandidate. Each current-action query creates a new Clone and seeds.map(run), bypassing the existing exact runMany cache.',
  capabilityResult: 'not-completed', sourceAndExperienceUnchangedDuringRun: true,
  rerunCondition: 'Only after exact query reuse tests; retain the same goal, layout, experience, seeds, steps and thresholds.' };
await writeFile(resolve(directory, 'COMPUTATION_STOP.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
