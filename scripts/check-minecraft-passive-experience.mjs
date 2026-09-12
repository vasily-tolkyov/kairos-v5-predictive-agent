import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25631' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = resolve(values.build ?? 'dist'), root = resolve(values.output); await mkdir(root);
const { Services } = await import(resolve(build, 'src/services.js'));
const { MinecraftBody } = await import(resolve(build, 'src/body.js'));
const { MinecraftExperienceEnvironment } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));
const { ExperienceMedium } = await import(resolve(build, 'src/experience-medium.js'));
const { validateEvent } = await import(resolve(build, 'src/events.js'));
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosPassive',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const runtimeRoot = resolve(root, 'runtime'), services = new Services(config, runtimeRoot, resolve(root, 'server-evidence'));
const frames = [], windows = [], commands = []; let body;
const save = (name, data) => writeFile(resolve(root, name), JSON.stringify(data, null, 2));
const command = text => { commands.push(text); services.command(text); };
const report = { status: 'running', runtimeRoot, build, startedAt: new Date().toISOString(),
  scope: 'Scripted native passive-damage and motor-boundary apparatus; not autonomous coping or planning evidence',
  executedHashes: Object.fromEntries(await Promise.all(['body','passive-experience','adapters/minecraft/experience','experience-medium'].map(async name =>
    [name, createHash('sha256').update(await readFile(resolve(build, 'src', name + '.js'))).digest('hex')]))) };
try {
  await services.start('empty'); command('fill -5 63 -5 5 63 5 bedrock');
  body = new MinecraftBody({ ...config.minecraft, worldId: 'passive-opt-in-apparatus' }, (kind, value) => { if (kind === 'frame') frames.push(value); });
  await body.ready(); command('tp KairosPassive .5 64 .5 180 0'); await delay(700);
  const environment = new MinecraftExperienceEnvironment(body), initial = await environment.observe();
  assert.deepEqual(await environment.drainPassiveEvents(), [], 'setup must not become autonomous evidence');
  command('damage KairosPassive 2 minecraft:generic'); command('data get entity KairosPassive Health'); await delay(700);
  windows.push(...await environment.drainPassiveEvents());
  const changed = windows.some(event => event.frames.slice(1).some((frame, i) => frame.self.properties.health < event.frames[i].self.properties.health));
  assert(changed, 'idle health loss was not captured');
  const waiting = await environment.observe(), passiveOffer = environment.listActionOffers(waiting).find(offer =>
    offer.action.kind === 'passive' && offer.action.parameters.ticks === 10); assert(passiveOffer);
  const calls = body.physicalCalls, passiveChoice = await environment.executeOffer(passiveOffer);
  assert(passiveChoice.executed && passiveChoice.event);
  const passiveMotorCalls = body.physicalCalls - calls;
  assert.equal(passiveMotorCalls, 0, 'the passive choice issued a motor command');
  assert.equal(passiveChoice.event.frames.length, 11); assert.equal(passiveChoice.event.cue.kind, 'passive');
  windows.push(...passiveChoice.precedingPassiveEvents ?? [], passiveChoice.event);
  const observation = await environment.observe(), offer = environment.listActionOffers(observation).find(offer =>
    offer.action.kind === 'move' && offer.action.parameters.direction === 'forward' && offer.action.parameters.ticks === 4); assert(offer);
  await delay(650); const receipt = await environment.executeOffer(offer); assert(receipt.executed && receipt.event);
  windows.push(...receipt.precedingPassiveEvents ?? []);
  const active = receipt.event; windows.push(active);
  await delay(350); windows.push(...await environment.drainPassiveEvents());
  const passive = windows.filter(event => event.provenance === 'observed-passive');
  assert(passive.length > 2 && receipt.precedingPassiveEvents?.length, 'deliberation intervals were lost');
  const occupied = new Set();
  for (const event of windows) {
    validateEvent(event);
    for (const frame of event.frames.slice(1)) { assert(!occupied.has(frame.sequence), 'a physical interval was learned twice'); occupied.add(frame.sequence); }
    if (event.provenance === 'observed-passive') {
      assert.equal(event.bodyResult, null); assert.equal(event.cue.kind, 'passive');
      assert.equal(event.cue.parameters.ticks, event.frames.length - 1);
    }
    assert(!JSON.stringify(event).includes('block:') && !JSON.stringify(event).includes('bedrock'));
  }
  const chronological = [...windows].sort((a, b) => a.frames[0].sequence - b.frames[0].sequence);
  assert.deepEqual(windows.map(event => event.id), chronological.map(event => event.id));
  const medium = new ExperienceMedium(); for (const event of windows) assert(medium.observe(event).learned);
  report.evidence = { initialSequence: initial.sequence, passiveWindows: passive.length, actionWindows: 2,
    selectedPassiveIntervals: passiveChoice.event.frames.length - 1, selectedPassiveMotorCalls: passiveMotorCalls,
    passiveIntervals: passive.reduce((sum, event) => sum + event.frames.length - 1, 0),
    activeFirst: active.frames[0].sequence, activeLast: active.frames.at(-1).sequence,
    capturedIdleHealthLoss: true, duplicateIntervals: 0, distinctLearnedWindows: medium.writes };
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const health = [...log.matchAll(/KairosPassive has the following entity data: ([0-9.]+)f/g)].at(-1)?.[1];
  assert.equal(Number(health), 18, 'independent server health does not confirm the induced damage');
  report.serverHealth = Number(health); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  report.final = body ? body.latest().self : null;
  await body?.close(); await services.stop(); report.stoppedAt = new Date().toISOString();
  await save('setup.json', { commands, scope: report.scope });
  await writeFile(resolve(root, 'frames.json.gz'), gzipSync(JSON.stringify(frames)));
  await writeFile(resolve(root, 'windows.json.gz'), gzipSync(JSON.stringify(windows)));
  await save('results.json', report); console.log(JSON.stringify(report));
}
