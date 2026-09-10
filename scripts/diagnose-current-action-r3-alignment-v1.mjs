import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { GroundedGoalEvaluatorV1 } from '../dist/src/control/goal.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson, fileSha } from '../dist/src/util.js';

const [pointer, originalRun, output] = process.argv.slice(2);
if (!output) throw new Error('frozen-pointer-original-run-new-output-required');
await mkdir(output, { recursive: false });
let injected, firstEvent, candidate;
for await (const line of createInterface({ input: createReadStream(resolve(originalRun, 'events.jsonl')) })) {
  const { kind, value } = JSON.parse(line);
  if (kind === 'final-goal-injected') injected = value;
  if (kind === 'real-event' && !firstEvent) firstEvent = value;
  if (firstEvent && kind === 'control-operation-result' && value.event.operation === 'recall-effect') {
    candidate = value.event.result.atomicCandidates[0];
    if (candidate) break;
  }
}
if (!injected || !firstEvent || !candidate) throw new Error('sealed-first-action-and-root-candidate-missing');
const pointerData = JSON.parse(await readFile(pointer, 'utf8'));
const loaded = await loadSnapshotFromDisk(resolve(dirname(pointer), pointerData.filename));
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(loaded.snapshot);
if (canonicalStreamSha256(memory.snapshot()) !== pointerData.sha256) throw new Error('source-snapshot-hash-mismatch');
// Only a disposable in-memory reconstruction learns the already recorded real
// event. No simulation result, fabricated frame, or second action is deposited.
memory.advanceTo(injected.observation.activeSeconds);
const receipt = memory.observe(firstEvent);
const observation = firstEvent.frames.at(-1), goal = injected.goal;
const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, injected.observation);
const evaluation = evaluator.evaluate(observation);
const before = canonicalStreamSha256(memory.snapshot());
const started = performance.now();
const generic = candidate.evidence.r2a.relationIds.map(id => memory.compareCurrentFactors(id, observation));
console.log(JSON.stringify({ stage: 'generic', generic, elapsedMs: performance.now() - started }));
const current = memory.compareConditions(candidate, observation);
console.log(JSON.stringify({ stage: 'actual-action-condition', current, elapsedMs: performance.now() - started }));
const prediction = memory.predictCandidate(candidate, observation, goal, evaluation);
const after = canonicalStreamSha256(memory.snapshot());
const result = { version: 'CurrentActionR3AlignmentReplayV1', firstRealEventId: firstEvent.id,
  sourceEventsSha256: await fileSha(resolve(originalRun, 'events.jsonl')), receipt,
  observationSequence: observation.sequence, activeSeconds: observation.activeSeconds,
  candidateId: candidate.candidateId, before, after, readOnlyQueries: before === after,
  generic, current, prediction: { valid: prediction.validSampleCount, progress: prediction.progressFraction,
    applicability: prediction.currentEvidence.r2a.applicability, evidence: prediction.currentEvidence,
    unknown: prediction.unknown }, durationMs: performance.now() - started,
  newMinecraftCalls: 0, sourceSnapshotWrites: 0, reconstructedRealEvents: 1 };
await saveJson(resolve(output, 'RESULT.json'), result);
await saveJson(resolve(output, 'PREDICTION.json'), prediction);
console.log(JSON.stringify({ ...result, prediction: { ...result.prediction, evidence: undefined } }));
if (before !== after || !current.productionEligible || prediction.validSampleCount < 8
  || prediction.progressFraction < .75 || current.applicability !== prediction.currentEvidence.r2a.applicability)
  process.exitCode = 1;
