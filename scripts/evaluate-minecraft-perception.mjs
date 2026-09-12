import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { setTimeout as delay, setImmediate as yieldIO } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { ExperienceAgent, compareExperiencePrediction } from '../dist/src/experience-agent.js';
import { ExperienceMedium } from '../dist/src/experience-medium.js';
import { MinecraftBodyConnection } from './minecraft-body-connection.mjs';
import { MinecraftExperienceEnvironment } from '../dist/src/adapters/minecraft/experience.js';
import { Services } from '../dist/src/services.js';

const { values } = parseArgs({ options: {
  java: { type: 'string' }, server: { type: 'string' }, output: { type: 'string' },
  seed: { type: 'string', default: '41' }, training: { type: 'string', default: '320' },
  adaptation: { type: 'string', default: '96' }, port: { type: 'string', default: '25578' },
  restore: { type: 'string' }, 'training-only': { type: 'boolean' }, 'frozen-only': { type: 'boolean' },
  'evaluate-rooms': { type: 'string', default: 'A,B,C,D,E' },
  'rotate-holdout': { type: 'boolean' }, 'obstacle-challenge': { type: 'boolean' },
  'online-obstacle': { type: 'boolean' }, 'novel-layout': { type: 'boolean' },
} });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const number = key => {
  const value = Number(values[key]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) throw new Error('invalid-' + key);
  return value;
};
const root = resolve(values.output), compress = promisify(gzip), decompress = promisify(gunzip);
await mkdir(root); await mkdir(resolve(root, 'events'));
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const log = (name, value) => appendFile(resolve(root, name + '.jsonl'), JSON.stringify(value) + '\n');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: number('port'),
  username: 'KairosVision', java: resolve(values.java), serverJar: resolve(values.server) } };
const services = new Services(config, resolve(root, 'runtime'), resolve(root, 'server-evidence'));
const rooms = [
  { name: 'A', x: 0, wall: 'bricks', object: 'red_concrete', second: 'blue_concrete', offset: 0 },
  { name: 'B', x: 40, wall: 'polished_diorite', object: 'red_concrete', second: 'yellow_concrete', offset: .4 },
  { name: 'C', x: 80, wall: 'oak_planks', object: 'green_concrete', second: 'red_concrete', offset: -.4 },
  ...(values['obstacle-challenge'] ? [{ name: 'D', x: 120, wall: 'deepslate_tiles', object: 'yellow_concrete',
    second: 'blue_concrete', offset: 0, obstacle: true }] : []),
  ...(values['novel-layout'] ? [{ name: 'E', x: 160, wall: 'blackstone', object: 'white_terracotta',
    second: 'cyan_concrete', offset: 1.1, objectX: 1, objectZ: -1, objectHeight: 3 }] : []),
];
const report = { version: 'KairosAnonymousVisionEvaluationV2', started: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  seed: number('seed'), training: number('training'), adaptation: number('adaptation'),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, minecraft: config.minecraft.version },
  sensor: '25x19 anonymous texture-averaged RGB plus first ray-hit distance; no block classes or engine object IDs enter learning',
  taskBoundary: 'static native fixtures; setup commands only between episodes; no prescribed action sequences',
  limitations: ['RGBD is an engineered range/color sensor, not full Minecraft client pixels',
    'surface groups are provisional percepts, not guaranteed complete physical objects',
    'terminal goal conjunctions test composition, not arbitrary language or long causal tasks'],
  phases: [], goals: [], status: 'running' };
const sourcePaths = ['package.json', 'package-lock.json', 'src/contracts.ts', 'src/control/contracts.ts',
  'src/perception.ts', 'src/experience-medium.ts', 'src/experience-agent.ts', 'src/body.ts',
  'src/adapters/minecraft/retina.ts', 'src/adapters/minecraft/experience.ts', 'src/control/goal.ts',
  'scripts/evaluate-minecraft-perception.mjs', 'scripts/minecraft-body-connection.mjs'];
report.sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(resolve(root, 'evaluator-source.mjs'), await readFile(new URL(import.meta.url)));
let body, phase = 'setup', eventCount = 0;
async function reset(room, encounter = 0) {
  phase = 'setup'; const x = room.x;
  const objectX = x + (room.objectX ?? 0), objectZ = room.objectZ ?? 0;
  const commands = [];
  const rotated = room.name === 'C' && values['rotate-holdout'];
  {
    commands.push(`forceload add ${x - 8} -8 ${x + 8} 8`,
      `fill ${x - 6} 63 -6 ${x + 6} 69 7 minecraft:bedrock hollow`,
      `fill ${x - 5} 64 -5 ${x + 5} 68 6 minecraft:air`,
      rotated ? `fill ${x + 5} 64 -5 ${x + 5} 68 5 minecraft:${room.wall}`
        : `fill ${x - 5} 64 -5 ${x + 5} 68 -5 minecraft:${room.wall}`,
      `fill ${x - 5} 63 -5 ${x + 5} 63 6 minecraft:smooth_stone`,
      `fill ${objectX} 64 ${objectZ} ${objectX} ${63 + (room.objectHeight ?? 2)} ${objectZ} minecraft:${room.object}`,
      rotated ? `fill ${x + 1} 64 -3 ${x + 1} 65 -3 minecraft:${room.second}`
        : `fill ${x - 3} 64 -1 ${x - 3} 65 -1 minecraft:${room.second}`,
      rotated ? `setblock ${x - 1} 64 3 minecraft:oak_planks` : `setblock ${x + 3} 64 1 minecraft:oak_planks`);
    if (room.obstacle) commands.push(`fill ${x + 1} 64 2 ${x + 1} 65 5 minecraft:stone`);
  }
  const dx = encounter ? [-1.2, .8, -.4, 1.4][encounter % 4] : room.offset;
  const yaw = encounter ? [165, 180, 195, 180][encounter % 4] : 180;
  const px = rotated ? x - 2.5 - (encounter % 3) * .3 : x + .5 + dx;
  const pz = rotated ? .5 + dx : 3.5 + (encounter % 3) * .3;
  commands.push(`tp ${config.minecraft.username} ${px} 64 ${pz} ${yaw + (rotated ? 90 : 0)} 0`,
    `clear ${config.minecraft.username}`);
  for (const command of commands) services.command(command);
  await log('setups', { room: room.name, encounter, commands, outsideLearning: true });
  await delay(1800);
  const observation = await base.observe();
  await log('initial-observations', { room: room.name, encounter, observation });
  if (!observation.sensation || observation.perception.receptors === 0) throw new Error('empty-live-visual-sensor');
  return observation;
}
let base;
function environment(memory, metrics) {
  return { observe: () => base.observe(), listActionOffers: o => base.listActionOffers(o),
    waitForObservationAfter: seq => base.waitForObservationAfter(seq),
    executeOffer: async offer => {
      const before = await base.observe(), prediction = memory.predict(offer.cue, before), started = performance.now();
      const receipt = await base.executeOffer(offer), comparison = compareExperiencePrediction(prediction, receipt.observation);
      metrics.actions++; metrics.executed += Number(receipt.executed);
      metrics.accepted += Number(prediction.accepted); metrics.compared += comparison.compared;
      metrics.matched += comparison.matched; metrics.unknown += comparison.unknown;
      metrics.kinds[offer.action.kind] = (metrics.kinds[offer.action.kind] ?? 0) + 1;
      const file = receipt.event ? `events/${String(++eventCount).padStart(5, '0')}.json.gz` : null;
      if (receipt.event) await writeFile(resolve(root, file), await compress(JSON.stringify({ phase, event: receipt.event })));
      await log('actions', { phase, action: offer.action, cue: offer.cue, attentionId: offer.attentionId, event: file,
        beforeSequence: before.sequence, afterSequence: receipt.observation.sequence,
        beforeSelf: before.self, afterSelf: receipt.observation.self,
        sensor: { groups: before.perception.groups, attendedId: before.perception.attendedId,
          visibleTracks: before.objects.length, endVisibleTracks: receipt.observation.objects.length },
        prediction: { accepted: prediction.accepted, reason: prediction.reason,
          supported: prediction.supportedFields, samples: prediction.observedSamples },
        comparison, executed: receipt.executed, durationMs: performance.now() - started });
      return receipt;
    } };
}
const metrics = () => ({ actions: 0, executed: 0, accepted: 0, compared: 0, matched: 0, unknown: 0, kinds: {} });
async function checkpoint(memory, name) {
  await yieldIO(); const snapshot = memory.snapshot();
  await writeFile(resolve(root, name + '-memory.json.gz'), await compress(JSON.stringify(snapshot)));
  return hash(snapshot);
}
async function acquire(memory, room, budget, label) {
  const agent = new ExperienceAgent(memory), measured = metrics(), env = environment(memory, measured);
  const startWrites = memory.writes, learning = { accepted: 0, maskedObjects: 0, measuredChannels: 0 };
  for (let index = 0; index < budget; index++) {
    if (index % 16 === 0) await reset(room, Math.floor(index / 16));
    phase = label;
    const observation = await env.observe(), offer = agent.explore(observation, env.listActionOffers(observation));
    if (!offer) throw new Error('no-available-motor');
    await log('choices', { phase, index, attendedId: observation.perception.attendedId,
      selectedAttentionId: offer.attentionId, selected: offer.action,
      candidates: env.listActionOffers(observation).flatMap(candidate => observation.objects.map(object => ({
        action: candidate.action, attentionId: object.id,
        drive: memory.explorationDrive(candidate.cue, observation, object.id) }))) });
    const receipt = await env.executeOffer(offer);
    if (receipt.event) {
      const result = memory.observe(receipt.event);
      learning.accepted += Number(result.learned); learning.maskedObjects += result.maskedObjects;
      learning.measuredChannels += result.measuredChannels;
      await log('learning', { phase, eventId: receipt.event.id, ...result });
    }
    if ((index + 1) % 16 === 0) {
      console.log(JSON.stringify({ phase, actions: index + 1, writes: memory.writes,
        accepted: measured.accepted, fields: `${measured.matched}/${measured.compared}`,
        rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
      await checkpoint(memory, label);
    }
  }
  report.phases.push({ label, room: room.name, startWrites, endWrites: memory.writes, ...measured, learning,
    checkpointHash: await checkpoint(memory, label) }); await save('results.json', report);
}
function goals(observation) {
  const p = (id, observable, comparator, extra, subject = { kind: 'self' }) => ({ kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id, subject, observable, comparator, ...extra } });
  const slot = p('slot', 'properties.selectedSlot', 'equals', { target: (Number(observation.self.properties.selectedSlot) + 3) % 9 });
  const pitch = p('pitch', 'pitch', 'increase', { minimumDelta: .55 });
  const move = p('move', 'position.0', 'increase', { minimumDelta: .5 });
  const target = observation.objects.find(o => o.id === observation.targetId);
  const approach = target ? p('approach', 'relativeDistance', 'decrease', { minimumDelta: .7 },
    { kind: 'public-object', id: target.id, expectedType: 'percept' }) : null;
  return [ ['slot', slot], ['look-three', pitch], ['move', move],
    ['composed', { kind: 'all', children: [slot, pitch, move] }],
    ...(approach ? [['percept-approach', approach], ['percept-composed', { kind: 'all', children: [approach, slot,
      p('pitch-down', 'pitch', 'decrease', { minimumDelta: .26 })] }]] : [])
  ].map(([name, expression]) => ({ name, goal: { version: 'GroundedGoalV1', id: name, expression } }));
}
async function evaluate(memory, room, label, learn = false) {
  if (!values['evaluate-rooms'].split(',').includes(room.name)) return;
  const frozen = hash(memory.snapshot()), entries = [];
  for (const name of ['slot', 'look-three', 'move', 'composed', 'percept-approach', 'percept-composed']) {
    const startWrites = memory.writes;
    const observation = await reset(room), target = goals(observation).find(g => g.name === name);
    if (!target) { entries.push({ label, room: room.name, name, status: 'target-not-perceived' }); continue; }
    phase = label + '-' + name;
    const measured = metrics(), env = environment(memory, measured), agent = new ExperienceAgent(memory);
    const coldPlan = new ExperienceAgent(new ExperienceMedium(number('seed'))).plan(target.goal, observation,
      env.listActionOffers(observation), { depth: 8, expansions: 256 });
    const initialPlan = agent.plan(target.goal, observation, env.listActionOffers(observation), { depth: 8, expansions: 256 });
    const actionBudget = learn ? 32 : 12;
    const result = await agent.runGoal(env, target.goal, { actionBudget, depth: 8, learn,
      allowExploration: learn, verificationTicks: 5 });
    let independentSpatialCheck = null;
    if (name.startsWith('percept-')) {
      const point = observation.objects.find(object => object.id === observation.targetId);
      const anchor = point.relativePosition.map((value, i) => value + observation.self.position[i]);
      const before = Math.hypot(...point.relativePosition), after = Math.hypot(...anchor.map((value, i) => value - result.observation.self.position[i]));
      independentSpatialCheck = { before, after, reduction: before - after,
        passed: before - after >= .7, basis: 'body position relative to the initially measured surface point in this static fixture' };
    }
    const serverCheck = await verifyServerState(result.observation);
    const status = result.status === 'goal-verified' && (!serverCheck.passed || independentSpatialCheck && !independentSpatialCheck.passed)
      ? 'independent-verification-failed' : result.status;
    const entry = { label, room: room.name, name, goal: target.goal, status,
      learningEnabled: learn, explorationAllowed: learn, actionBudget, startWrites, endWrites: memory.writes,
      initialObservation: observation,
      coldPlan: { reason: coldPlan.reason, actions: coldPlan.steps.length }, independentSpatialCheck,
      serverCheck,
      initialPlan: { reason: initialPlan.reason, expanded: initialPlan.expanded,
        actions: initialPlan.steps.map(step => step.offer.action) },
      actions: result.actions, measured, finalObservation: result.observation };
    entries.push(entry); await log('goal-results', entry);
    console.log(JSON.stringify({ phase, status, initialPlan: initialPlan.steps.length,
      actions: result.actions.length, planned: result.actions.filter(a => a.mode === 'planned').length }));
  }
  const unchanged = hash(memory.snapshot()) === frozen;
  if (!learn && !unchanged) throw new Error('frozen-evaluation-wrote-memory');
  report.goals.push(...entries.map(entry => ({ ...entry, checkpointUnchanged: unchanged })));
  if (learn) await checkpoint(memory, label);
  await save('results.json', report);
}
async function verifyServerState(observation) {
  // Read-only evaluator queries after the action/verification window. None of
  // these authoritative fields are fed to the learner or used to choose actions.
  const path = resolve(root, 'server-evidence/minecraft-server.log'), offset = (await readFile(path, 'utf8')).length;
  for (const property of ['Pos', 'Rotation', 'SelectedItemSlot'])
    services.command(`data get entity ${config.minecraft.username} ${property}`);
  let replies = [];
  for (let attempt = 0; attempt < 20 && replies.length < 3; attempt++) {
    await delay(100);
    replies = [...(await readFile(path, 'utf8')).slice(offset).matchAll(/has the following entity data: ([^\r\n]+)/g)].map(match => match[1]);
  }
  if (replies.length !== 3) return { passed: false, reason: 'authoritative-server-read-unavailable', replies };
  const numbers = text => [...text.matchAll(/[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?/g)].map(match => Number(match[0]));
  const position = numbers(replies[0]), rotation = numbers(replies[1]), slot = numbers(replies[2])[0];
  if (position.length !== 3 || rotation.length !== 2) return { passed: false, reason: 'invalid-server-read', replies };
  const positionError = Math.hypot(...position.map((v, i) => v - observation.self.position[i]));
  const yawError = Math.atan2(Math.sin((rotation[0] - 180) * Math.PI / 180 + observation.self.yaw),
    Math.cos((rotation[0] - 180) * Math.PI / 180 + observation.self.yaw));
  const pitchError = rotation[1] * Math.PI / 180 + observation.self.pitch;
  return { position, rotation, slot, positionError, yawError, pitchError,
    passed: positionError < .05 && Math.abs(yawError) < .01 && Math.abs(pitchError) < .01
      && slot === observation.self.properties.selectedSlot, usedForLearning: false };
}
async function calibrateEntityBinding() {
  await reset(rooms[0]); phase = 'external-binding-control';
  const commands = ['summon minecraft:item 0.5 65.5 2.5 {NoGravity:1b,PickupDelay:32767s,Tags:["kairos-binding-control"],Item:{id:"minecraft:cobblestone",count:1}}'];
  for (const command of commands) services.command(command);
  await log('setups', { phase, commands, outsideLearning: true }); await delay(600);
  const raw = body.latest(), sensed = await base.observe();
  const observedEntity = raw.objects.find(object => object.id === raw.targetId);
  const offer = { version: 'ActionOfferV1', offerId: 'external-negative-control', observationSequence: sensed.sequence,
    action: { kind: 'attack', parameters: {}, targetId: sensed.targetId },
    cue: { kind: 'attack', parameters: {}, targetRole: 'percept' } };
  const receipt = await base.executeOffer(offer);
  const later = await base.waitForObservationAfter(sensed.sequence);
  report.bindingControl = { rawTargetKind: observedEntity?.type, rawTargetId: raw.targetId,
    anonymousTarget: sensed.targetId, attackOffered: base.listActionOffers(sensed).some(o => o.action.kind === 'attack'),
    refused: !receipt.executed, connectionRetained: later.sequence > sensed.sequence,
    usedForLearning: false, agentSelectedActions: 0 };
  services.command('kill @e[tag=kairos-binding-control]'); await delay(200);
  if (observedEntity?.type !== 'item' || receipt.executed || !report.bindingControl.connectionRetained)
    throw new Error('entity-binding-control-failed-or-inconclusive');
  console.log(JSON.stringify({ phase, ...report.bindingControl }));
}
try {
  await save('protocol.json', { ...report, rooms }); await services.start('empty');
  body = new MinecraftBodyConnection({ ...config.minecraft, worldId: randomUUID() }, (kind, value) => {
    if (kind !== 'frame') void log('body-receipts', { phase, kind, value });
  });
  await body.ready(); base = new MinecraftExperienceEnvironment(body);
  console.log(JSON.stringify({ phase: 'server-ready', sequence: body.latest().sequence }));
  await calibrateEntityBinding();
  const memory = values.restore ? ExperienceMedium.restore(JSON.parse(await decompress(await readFile(resolve(values.restore)))))
    : new ExperienceMedium(number('seed'));
  if (values.restore) report.restoredLearning = { path: resolve(values.restore), writes: memory.writes,
    checkpointHash: hash(memory.snapshot()) };
  if (number('training')) await acquire(memory, rooms[0], number('training'), 'learn-A');
  if (!values['training-only']) {
    await evaluate(memory, rooms[0], 'frozen-A'); await evaluate(memory, rooms[1], 'unseen-B');
    if (!values['frozen-only'] && number('adaptation')) {
      await acquire(memory, rooms[1], number('adaptation'), 'learn-B');
      await evaluate(memory, rooms[1], 'adapted-B'); await evaluate(memory, rooms[0], 'retention-A');
    }
    await evaluate(memory, rooms[2], 'unseen-C');
    const obstacle = rooms.find(room => room.name === 'D'), novel = rooms.find(room => room.name === 'E');
    if (obstacle) {
      await evaluate(memory, obstacle, 'obstacle-D');
      if (values['online-obstacle']) {
        await evaluate(memory, obstacle, 'online-D', true);
        await evaluate(memory, rooms[0], 'retention-after-D');
      }
    }
    if (novel) await evaluate(memory, novel, 'novel-E');
  }
  report.status = 'completed'; report.finished = new Date().toISOString();
  report.summary = { goals: report.goals.length, verified: report.goals.filter(g => g.status === 'goal-verified').length,
    plannedVerified: report.goals.filter(g => g.status === 'goal-verified' && g.actions.length
      && g.actions.every(a => a.mode === 'planned')).length };
} catch (error) { report.status = 'error'; report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  try { await body?.close(); } catch (error) { report.cleanupError = String(error); }
  try { await services.stop(); } finally { await save('results.json', report); }
}
console.log(JSON.stringify(report.summary ?? { status: report.status, error: report.error }));
