/** Read-only measurement of exact repeated simulator inputs in a sealed run. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { SelfOrganizingAfferentProjectionV1 } from '../dist/src/core/learning/self-organizing-afferent.js';
import { canonical, sha, fileSha } from '../dist/src/util.js';

const [runPath, pointerPath, output] = process.argv.slice(2);
if (!runPath || !pointerPath || !output) throw new Error('run-pointer-new-output-required');
const rows = (await readFile(resolve(runPath, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(dirname(pointerPath), pointer.filename));
const projection = SelfOrganizingAfferentProjectionV1.restore(snapshot.r1.projection);
const annotations = new Map(snapshot.annotations.map(value => [value.eventId, value]));
const observation = rows.find(row => row.kind === 'final-goal-injected').value.observation;
const recalls = rows.filter(row => row.kind === 'control-operation-result'
  && row.value.event.operation === 'recall-effect').flatMap(row => row.value.event.result.atomicCandidates);
const requests = recalls.map(candidate => {
  const annotation = annotations.get(candidate.evidence.eventId);
  const perception = projection.lookupCurrentObservation(observation, annotation.publicRoleBindings, candidate.actionCue);
  const action = projection.lookupActionCue(candidate.actionCue);
  // Readout assemblies are built from all stable populations for this exact
  // cue; candidate membership does not select a different future template.
  const physicalInput = { cue: candidate.actionCue,
    currentPerceptionSeedSiteIds: perception.siteIds, currentPerceptionSeedDrives: perception.drives,
    currentPerceptionMode: 'sequential-prefix', realPrefixSeedSiteIds: [perception.siteIds],
    realPrefixSeedDrives: perception.drives ? [perception.drives] : undefined,
    actionSeedSiteIds: action.siteIds, actionSeedDrives: action.drives,
    seeds: Array.from({ length: 24 }, (_, index) => index + 1), steps: 180 };
  return { candidateId: candidate.candidateId, eventId: annotation.eventId,
    queryInputSha256: sha(physicalInput), unresolvedRoles: perception.unresolvedRoles };
});
const report = { version: 'ExactRealRolloutInputDuplicationV1',
  sourceEventsSha256: await fileSha(resolve(runPath, 'events.jsonl')),
  sourceSnapshotSha256: pointer.sha256, requests,
  queries: requests.length, distinctPhysicalInputs: new Set(requests.map(value => value.queryInputSha256)).size,
  currentGameCalls: 0, simulations: 0, physicalWrites: 0,
  caveat: 'input equality only; any optimization must additionally key the exact readout masks and immutable substrate' };
await writeFile(output, canonical(report), { flag: 'wx' });
console.log(JSON.stringify({ queries: report.queries, distinctPhysicalInputs: report.distinctPhysicalInputs }));
