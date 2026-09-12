import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import nbt from 'prismarine-nbt';

// Read-only post-run audit. Saved world state, engine names and death messages
// are evaluator evidence, never policy inputs or additional training samples.
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: STOPPED_NATIVE_OUTPUT NEW_AUDIT_JSON');
const root = resolve(source), load = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const lines = async path => (await readFile(resolve(root, path), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const sha = value => createHash('sha256').update(value).digest('hex');
const report = await load('results.json'); assert(report.stoppedAt && report.final, 'a stopped native run is required');
const actions = await lines('physical-actions.jsonl'), decisions = await lines('decisions.jsonl');
const initial = await load('initial-observation.json');
const mismatches = [], windows = [], gaps = [], healthDrops = [], oxygenDrops = [];
let previous = initial, actionIndex = 0;
for (const row of actions.filter(row => row.executed)) {
  const file = `events/${String(row.eventFile).padStart(7, '0')}.json.gz`;
  const bytes = await readFile(resolve(root, file)), event = JSON.parse(gunzipSync(bytes));
  const first = event.frames[0], last = event.frames.at(-1);
  if (event.id !== row.eventId || JSON.stringify(first.self) !== JSON.stringify(row.before)
    || JSON.stringify(last.self) !== JSON.stringify(row.after) || event.frames.length !== row.frames)
    mismatches.push(file);
  if (first.sequence < previous.sequence) mismatches.push(file + ':overlap');
  if (first.sequence > previous.sequence) gaps.push({ before: previous.sequence, after: first.sequence,
    unrecordedIntervals: first.sequence - previous.sequence,
    endpointHealthChange: Number(first.self.properties.health) - Number(previous.self.properties.health),
    // Endpoints bound a change; no missing intermediate frames are invented.
    boundary: 'Only net change between recorded endpoints is known.' });
  for (let i = 1; i < event.frames.length; i++) {
    const a = event.frames[i - 1], b = event.frames[i];
    if (b.sequence !== a.sequence + 1 || b.activeSeconds <= a.activeSeconds) mismatches.push(file + ':frame-order');
    for (const [name, target] of [['health', healthDrops], ['oxygen', oxygenDrops]]) {
      const before = a.self.properties[name], after = b.self.properties[name];
      if (typeof before === 'number' && typeof after === 'number' && after < before)
        target.push({ sequence: b.sequence, before, after, event: event.id, action: event.cue.kind });
    }
  }
  windows.push({ file, sha256: sha(bytes), id: event.id, first: first.sequence, last: last.sequence,
    action: event.cue.kind, decision: ++actionIndex }); previous = last;
}
const passiveFiles = await readdir(resolve(root, 'passive-events')).catch(error => {
  if (error.code === 'ENOENT') return []; throw error;
});
const passiveWindows = [], passiveHealthDrops = [], passiveIntervals = new Set();
for (const file of passiveFiles.filter(file => file.endsWith('.json.gz')).sort()) {
  const bytes = await readFile(resolve(root, 'passive-events', file)), event = JSON.parse(gunzipSync(bytes));
  assert(event.provenance === 'observed-passive' && event.cue.kind === 'passive' && event.bodyResult === null);
  assert.equal(event.cue.parameters.ticks, event.frames.length - 1);
  for (let i = 1; i < event.frames.length; i++) {
    const a = event.frames[i - 1], b = event.frames[i];
    assert.equal(b.sequence, a.sequence + 1); assert(b.activeSeconds > a.activeSeconds);
    assert(!passiveIntervals.has(b.sequence) && !windows.some(window => b.sequence > window.first && b.sequence <= window.last),
      'passive and active windows duplicate a physical interval');
    passiveIntervals.add(b.sequence);
    if (b.self.properties.health < a.self.properties.health) passiveHealthDrops.push({ sequence: b.sequence,
      before: a.self.properties.health, after: b.self.properties.health, event: event.id });
  }
  passiveWindows.push({ file, id: event.id, sha256: sha(bytes), first: event.frames[0].sequence,
    last: event.frames.at(-1).sequence });
}
assert.equal(passiveWindows.length, (report.final.passiveWindows ?? 0) - (report.initialStats.passiveWindows ?? 0));
const coveredGapIntervals = [...passiveIntervals].filter(sequence => gaps.some(gap => sequence > gap.before && sequence <= gap.after)).length;
const archiveProofs = [], archivedWorlds = [];
for (const file of await readdir(root)) if (file.endsWith('.tar.gz.provenance.json')) {
  const proof = await load(file), path = resolve(root, file.slice(0, -'.provenance.json'.length)), archive = await readFile(path);
  assert.equal(sha(archive), proof.sha256); assert.equal(archive.length, proof.bytes); archiveProofs.push(proof);
  if (proof.stoppedAt === report.stoppedAt) archivedWorlds.push(path);
}
assert.equal(archivedWorlds.length, 1, 'one verified archive of this exact stop is required');
// A later continuation can modify runtimeRoot. Read the verified historical
// archive itself so an audit remains reproducible after that world advances.
const archivePath = archivedWorlds[0], players = [];
const members = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).trim().split('\n');
for (const file of members.filter(file => /\/playerdata\/[^/]+\.dat$/.test(file))) {
  const bytes = execFileSync('tar', ['-xOf', archivePath, file]);
  const player = nbt.simplify((await nbt.parse(bytes, 'big')).parsed);
  players.push({ file, sha256: sha(bytes), position: player.Pos, health: player.Health, inventory: player.Inventory });
}
assert(players.length, 'the historical archive contains no saved player');
const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
const deaths = log.split(/\r?\n/).filter(line => /KairosContinuing (was slain|was shot|was blown|drowned|fell|burned|suffocated|was impaled|tried to swim|died)/.test(line));
const serverPositions = [...log.matchAll(/KairosContinuing has the following entity data: \[([-0-9.eE]+)d, ([-0-9.eE]+)d, ([-0-9.eE]+)d\]/g)]
  .map(match => match.slice(1).map(Number));
const verifiedDecisionPositions = decisions.filter(row => row.status === 'goal-verified').map(row => ({
  index: row.index, goalId: row.goalId, position: row.self.position,
  independentlyReportedByServer: serverPositions.some(position => position.every((value, axis) => Math.abs(value - row.self.position[axis]) < 1e-8)) }));
const count = values => Object.fromEntries([...new Set(values)].map(value => [value, values.filter(item => item === value).length]));
const result = { version: 'StoppedNativeContinuingAudit1', source: root, reportSha256: sha(await readFile(resolve(root, 'results.json'))),
  status: report.status, stoppedAt: report.stoppedAt, seconds: report.seconds,
  initialPosition: initial.self.position, finalPosition: report.finalObservation.self.position,
  decisions: decisions.length, actualWindows: windows.length, windows,
  countersMatch: report.final.executed - report.initialStats.executed === windows.length
    && report.final.decisions - report.initialStats.decisions === decisions.length,
  journalMismatches: mismatches, initialWrites: report.initialWrites, finalWrites: report.final.writes,
  frozen: report.protocol.frozen, learningDigestUnchanged: report.initialLearningDigest === report.finalLearningDigest,
  sources: count(decisions.map(row => row.source)), statuses: count(decisions.map(row => row.status)),
  supportedTaskPlans: decisions.filter(row => row.source === 'task' && row.planLength > 0).map(row => ({ index: row.index, length: row.planLength })),
  hypotheses: decisions.filter(row => row.exploration?.source === 'hypothesis').map(row => ({ index: row.index, length: row.exploration.planLength })),
  taskConfirmations: report.tasks.map(task => ({ id: task.goal.id, expression: task.goal.expression, status: task.status,
    firstSatisfied: task.firstSatisfied, confirmations: task.confirmations })),
  players, finalSavedPlayerMatches: players.some(player => JSON.stringify(player.position) === JSON.stringify(report.finalObservation.self.position)),
  archiveProofs, deaths: { reported: report.lifecycle.deaths, serverMessages: deaths },
  verifiedDecisionPositions, serverPositions,
  withinAction: { healthDrops, oxygenDrops, intervals: windows.reduce((sum, row) => sum + row.last - row.first, 0) },
  passive: { windows: passiveWindows, intervals: passiveIntervals.size, healthDrops: passiveHealthDrops },
  betweenActions: { intervals: gaps.reduce((sum, row) => sum + row.unrecordedIntervals, 0),
    coveredByPassive: coveredGapIntervals,
    unrecordedIntervals: gaps.reduce((sum, row) => sum + row.unrecordedIntervals, 0) - coveredGapIntervals,
    netHealthLoss: gaps.reduce((sum, row) => sum + Math.max(0, -row.endpointHealthChange), 0), gaps },
  limitation: 'Finite evidence audit. A goal confirmation does not establish causal prerequisites, transfer benefit or lifelong competence.' };
assert(result.countersMatch && !mismatches.length, 'physical journals do not match the original windows');
if (result.frozen) assert(result.learningDigestUnchanged, 'frozen dynamics changed');
await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), decisions: result.decisions, windows: result.actualWindows,
  finalSavedPlayerMatches: result.finalSavedPlayerMatches, deaths: result.deaths.reported,
  supportedTaskPlans: result.supportedTaskPlans.length,
  supportedTaskMultistep: result.supportedTaskPlans.filter(plan => plan.length > 1).length,
  recordedIntervals: result.withinAction.intervals, gapIntervals: result.betweenActions.intervals,
  healthDropsInActions: healthDrops.length, netGapHealthLoss: result.betweenActions.netHealthLoss }));
