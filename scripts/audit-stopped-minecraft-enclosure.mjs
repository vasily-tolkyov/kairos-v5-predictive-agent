import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import nbt from 'prismarine-nbt';

// Post-run evidence inspection only. Saved block names and player NBT never
// enter the learner, its motor selection, or its training windows.
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: SOURCE_STOPPED_ENCLOSURE NEW_AUDIT_JSON');
const root = resolve(source), read = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const report = await read('results.json');
if (!report.stoppedAt || !report.final || report.protocol.environment !== 'enclosure')
  throw new Error('a-stopped-enclosure-checkpoint-is-required');
// A continuation mutates runtimeRoot. Historical outcomes must come from the
// verified archive of this exact stop, never that later mutable directory.
const proofs = [];
for (const file of await readdir(root)) if (file.endsWith('.tar.gz.provenance.json')) {
  const proof = await read(file);
  if (proof.stoppedAt !== report.stoppedAt) continue;
  const archive = resolve(root, file.slice(0, -'.provenance.json'.length)), bytes = await readFile(archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), proof.sha256);
  assert.equal(bytes.length, proof.bytes); proofs.push({ archive, proof });
}
assert.equal(proofs.length, 1, 'one verified world archive of this exact stop is required');
const { archive, proof } = proofs[0];
const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
const worldFilesRead = {};
const historicalFile = path => {
  assert.equal(members.filter(member => member === path).length, 1, 'archive member missing or ambiguous: ' + path);
  const bytes = execFileSync('tar', ['-xOf', archive, path], { maxBuffer: 64 * 1024 * 1024 });
  worldFilesRead[path] = createHash('sha256').update(bytes).digest('hex'); return bytes;
};
const properties = historicalFile('server.properties').toString('utf8');
const name = properties.split(/\r?\n/).find(line => line.startsWith('level-name='))?.slice(11);
if (!name || name.includes('/') || name.includes('\\') || name === '..') throw new Error('unsupported-level-name');
const chunks = new Map();
async function chunk(x, z) {
  const key = `${x},${z}`;
  if (chunks.has(key)) return chunks.get(key);
  const bytes = historicalFile(`${name}/region/r.${Math.floor(x / 32)}.${Math.floor(z / 32)}.mca`);
  const offset = bytes.readUIntBE(4 * ((x & 31) + 32 * (z & 31)), 3) * 4096;
  if (!offset) throw new Error('required-chunk-is-absent');
  const length = bytes.readUInt32BE(offset), compression = bytes[offset + 4];
  const payload = bytes.subarray(offset + 5, offset + 4 + length);
  const decoded = compression === 1 ? gunzipSync(payload) : compression === 2 ? inflateSync(payload)
    : compression === 3 ? payload : null;
  if (!decoded) throw new Error('unsupported-anvil-compression');
  const value = nbt.simplify(nbt.parseUncompressed(decoded));
  if (value.xPos !== x || value.zPos !== z) throw new Error('chunk-coordinate-mismatch');
  chunks.set(key, value); return value;
}
async function block(x, y, z) {
  const data = await chunk(Math.floor(x / 16), Math.floor(z / 16));
  const section = data.sections.find(section => section.Y === Math.floor(y / 16));
  if (!section?.block_states) throw new Error('required-section-is-absent');
  const { palette, data: packed } = section.block_states;
  if (palette.length === 1) return palette[0].Name;
  const bits = Math.max(4, Math.ceil(Math.log2(palette.length))), perLong = Math.floor(64 / bits);
  const index = (y & 15) * 256 + (z & 15) * 16 + (x & 15), pair = packed[Math.floor(index / perLong)];
  const value = (BigInt(pair[0] >>> 0) << 32n) | BigInt(pair[1] >>> 0);
  const selected = Number((value >> BigInt((index % perLong) * bits)) & ((1n << BigInt(bits)) - 1n));
  if (!palette[selected]) throw new Error('invalid-block-state-index');
  return palette[selected].Name;
}
const players = [];
for (const path of members.filter(path => path.startsWith(name + '/playerdata/') && path.endsWith('.dat'))) {
  const file = path.slice((name + '/playerdata/').length);
  const player = nbt.simplify((await nbt.parse(historicalFile(path), 'big')).parsed);
  players.push({ file, position: player.Pos, inventory: player.Inventory });
}
const geometry = report.protocol.geometry, changes = [];
for (let x = 1 - geometry.halfWidth; x < geometry.halfWidth; x++)
  for (let y = 64; y <= 65; y++) for (let z = -geometry.wallDepth - 1; z <= -2; z++) {
    const actual = await block(x, y, z);
    if (actual !== 'minecraft:' + geometry.material) changes.push({ position: [x, y, z], actual });
  }
const readJournal = async kind => Promise.all((await readdir(resolve(root, 'journal', kind))).sort()
  .map(file => read(`journal/${kind}/${file}`)));
const decisions = await readJournal('decisions'), actions = await readJournal('physical-actions');
const byOffer = new Map(decisions.filter(d => d.offer).map(d => [d.offer.offerId, d]));
const mismatches = [], breaks = [], finalFrames = [];
for (const action of actions) {
  if (!action.executed) continue;
  const file = `events/${String(action.eventFile).padStart(7, '0')}.json.gz`;
  const event = JSON.parse(gunzipSync(await readFile(resolve(root, file))));
  const before = event.frames[0], after = event.frames.at(-1), decision = byOffer.get(action.offer.offerId);
  if (event.id !== action.eventId || event.frames.length !== action.frames
    || JSON.stringify(action.before) !== JSON.stringify(before.self)
    || JSON.stringify(action.after) !== JSON.stringify(after.self)
    || action.availableOffers.some(offer => offer.observationSequence !== before.sequence)) mismatches.push(file);
  if (event.cue.kind === 'break') {
    const visual = before.sensation, center = 4 * (Math.floor(visual.height / 2) * visual.width + Math.floor(visual.width / 2));
    const gaze = before.objects.find(object => object.id === before.targetId);
    breaks.push({ decision: decision?.index, source: decision?.exploration?.source ?? 'plan',
      planLength: decision?.planLength ?? 0, position: before.self.position,
      center: visual.samples.slice(center, center + 4),
      groupColor: gaze && ['red', 'green', 'blue'].map(key => gaze.properties[key]),
      termination: event.bodyResult.terminationReason });
  }
  finalFrames.push({ sequence: after.sequence, position: after.self.position });
}
const target = -geometry.wallDepth - 2.2, final = report.finalObservation.self.position;
const actual = players.find(player => JSON.stringify(player.position) === JSON.stringify(final));
const summary = { version: 'StoppedEnclosureAudit1', source: root, commit: report.commit,
  worldArchive: archive, worldArchiveSha256: proof.sha256, worldFilesRead,
  resultSha256: createHash('sha256').update(await readFile(resolve(root, 'results.json'))).digest('hex'),
  status: report.status, seconds: report.seconds, initialGoalEvaluation: report.taskInitialEvaluation,
  actualWindows: actions.filter(a => a.executed).length, journalMismatches: mismatches,
  initialWrites: report.initialWrites, finalWrites: report.final.writes,
  learningDigestUnchanged: report.initialLearningDigest === report.finalLearningDigest,
  target, finalPosition: final, savedPlayerMatches: Boolean(actual), savedPlayers: players,
  savedPositionSatisfies: Boolean(actual && actual.position[2] < target), changedBarrierCells: changes,
  breakDecisions: breaks,
  supportedPlans: decisions.filter(d => d.planLength > 0).map(d => ({ index: d.index, length: d.planLength, reason: d.planReason })),
  hypotheses: decisions.filter(d => d.exploration?.source === 'hypothesis').map(d => ({ index: d.index, length: d.exploration.planLength })),
  finalPhysicalFrames: finalFrames.slice(-6), finalDecisions: decisions.slice(-6).map(d => ({
    index: d.index, sequence: d.observationSequence, status: d.status, position: d.self.position })),
  confirmation: report.tasks.map(task => ({ id: task.goal.id, status: task.status, firstSatisfied: task.firstSatisfied,
    confirmations: task.confirmations, lastConfirmedSequence: task.lastConfirmedSequence })),
  boundary: 'Independent saved-world outcome audit; not a claim that exploration was multistage planning.' };
await writeFile(resolve(output), JSON.stringify(summary, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), windows: summary.actualWindows, mismatches: mismatches.length,
  savedPositionSatisfies: summary.savedPositionSatisfies, removed: changes.filter(c => c.actual === 'minecraft:air').length,
  supportedPlans: summary.supportedPlans.length, hypotheses: summary.hypotheses.length,
  longestHypothesis: Math.max(0, ...summary.hypotheses.map(h => h.length)), frozen: summary.learningDigestUnchanged }));
