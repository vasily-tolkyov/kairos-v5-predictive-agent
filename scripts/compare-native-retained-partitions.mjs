import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [oldBuild, newBuild, checkpoint, output] = process.argv.slice(2);
assert(output, 'usage: OLD_DIST NEW_DIST ORIGINAL_STOPPED_CHECKPOINT NEW_RESULT');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(checkpoint), actual = JSON.parse(gunzipSync(bytes)).medium.contexts;
const ranked = actual.circuits.filter(([id, c]) => id.startsWith('continuous-v1/') && c.samples.length >= 16)
  .map(([id,circuit]) => ({id,circuit,score:circuit.samples.length * new Set(circuit.samples.flatMap(row => Object.keys(row.targets))).size
    * Math.max(...circuit.samples.map(row => Object.keys(row.input).length))})).sort((a,b) => b.score - a.score);
assert(ranked.length); const chosen = ranked[0];
// Rebuild independent private readouts from retained measured inputs/targets,
// exactly once per retained original cohort. Older evicted history is absent:
// these are diagnostic models, never reconstructions of the actual final model.
// Original source-window IDs stay unchanged and duplicate guards stay active.
const cohorts=new Map();
for(const row of [...chosen.circuit.samples].sort((a,b)=>a.serial-b.serial)){
  assert(typeof row.windowId==='string');const group=cohorts.get(row.windowId)??[];group.push(row);cohorts.set(row.windowId,group);
}
const input=[...cohorts].map(([windowId,rows])=>({windowId,rows:rows.map(row=>({input:row.input,
  targets:Object.entries(row.targets).map(([key,[a,b]])=>[key,a,b]),externalErrors:row.externalErrors}))}));
const runs = [], models = [];
for (const build of [oldBuild,newBuild]) {
  const module = resolve(build,'src/contextual-readout.js'), {ContextualReadout} = await import(pathToFileURL(module).href);
  const model = new ContextualReadout(actual.capacity), started = performance.now();
  for(const group of input)model.observeWindow(chosen.id,group.windowId,structuredClone(group.rows));
  const elapsedMs = performance.now() - started; models.push(model);
  runs.push({build:resolve(build),moduleSha256:hash(await readFile(module)),elapsedMs,snapshotSha256:hash(JSON.stringify(model.snapshot()))});
}
assert.deepEqual(models[1].snapshot(),models[0].snapshot(),'retained-data partition induction differs');
const rows=chosen.circuit.samples, queries=[rows[0].input,rows[Math.floor(rows.length/2)].input,rows.at(-1).input,{}];
let reads=0;
for(const query of queries)for(const key of models[0].keys(chosen.id)){
  assert.deepEqual(models[1].read(chosen.id,key,query),models[0].read(chosen.id,key,query));reads++;
}
const result={version:'NativeRetainedPartitionDifferential1',status:'passed',checkpoint:resolve(checkpoint),checkpointSha256:hash(bytes),
  chosenCircuit:chosen.id,retainedRows:rows.length,originalWindowIds:[...new Set(rows.map(row=>row.windowId))],
  privateOriginalCohorts:input.length,eachCohortReplayedOnce:true,
  selectedBy:'largest retained row-count times target-count times maximum input-count, among continuous circuits',
  sourceRowsSha256:hash(JSON.stringify(chosen.circuit)),inputSha256:hash(JSON.stringify(input)),runs,checkedReads:reads,
  realActions:0,newIndependentWindows:0,
  scope:'Private partition diagnostic using retained measured input/target cohorts exactly once, with original window IDs and duplicate guards intact. Evicted history is absent; these are discarded diagnostic models, not the native final model or a continuation. No new physical window, consolidation, execution-speed or capability credit.'};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,originalWindowIds:result.originalWindowIds.length}));
