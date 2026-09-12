import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// An isolated sensor apparatus, never an autonomous curriculum or a policy.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25602' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = values.build ? resolve(values.build) : new URL('../dist/', import.meta.url).pathname;
const { Services } = await import(resolve(build, 'src/services.js'));
const { MinecraftBody } = await import(resolve(build, 'src/body.js'));
const { MinecraftExperienceEnvironment } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));
const root = resolve(values.output); await mkdir(root);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosAir',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const runtimeRoot = resolve(root, 'runtime'), services = new Services(config, runtimeRoot, resolve(root, 'server-evidence'));
const frames = [], samples = [], metadata = [], commands = [], readings = [];
let body;
const report = { status: 'running', runtimeRoot, scope: 'native proprioceptive ownership apparatus; no learning/planning claim',
  build, compiledHashes: Object.fromEntries(await Promise.all(['src/body.js', 'src/adapters/minecraft/experience.js'].map(async name =>
    [name, createHash('sha256').update(await readFile(resolve(build, name))).digest('hex')]))),
  startedAt: new Date().toISOString(), readings };
const command = text => { commands.push(text); services.command(text); };
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const ownedAir = async label => {
  const first = body.latest(); services.command('data get entity KairosAir Air'); await delay(250);
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const match = [...log.matchAll(/KairosAir has the following entity data: (-?\d+)s/g)].at(-1);
  assert(match, 'missing-independent-owned-air-query');
  const serverAir = Number(match[1]), last = body.latest();
  const reading = { label, firstSequence: first.sequence, sequence: last.sequence, serverAir,
    sensed: last.self.properties.oxygen, sdkAggregate: body.bot.oxygenLevel, provenance: last.bodySensation };
  readings.push(reading); await save(label + '.json', last); return reading;
};
try {
  await services.start('empty'); command('difficulty normal');
  command('fill -6 63 -6 6 63 6 bedrock'); command('fill 0 64 -2 4 67 2 water');
  body = new MinecraftBody({ ...config.minecraft, worldId: 'owned-air-apparatus' }, (kind, value) => {
    if (kind === 'frame') frames.push(value);
    if (kind === 'body-oxygen-sample') samples.push(value);
  });
  body.bot._client.on('entity_metadata', packet => {
    const slot = body.bot.registry.entitiesByName.player.metadataKeys.indexOf('air_supply');
    const air = packet.metadata.find(value => value.key === slot)?.value;
    if (typeof air === 'number') metadata.push({ entityId: packet.entityId, ownEntityId: body.bot.entity?.id,
      rawAir: air, observationSequence: frames.at(-1)?.sequence, sdkAggregate: body.bot.oxygenLevel });
  });
  await body.ready(); const environment = new MinecraftExperienceEnvironment(body);
  command('tp KairosAir .5 64 .5 180 0'); await delay(1800);
  const immersed = await ownedAir('owned-immersed');
  assert(immersed.serverAir < 300 && immersed.serverAir > 0);
  assert(Math.abs(immersed.sensed - immersed.serverAir / 15) <= 1, 'owned-immersion-sensation-disagrees-with-server');
  command('tp KairosAir -3.5 64 .5 180 0'); await delay(2500);
  const surfaced = await ownedAir('owned-surfaced'); assert.equal(surfaced.serverAir, 300); assert.equal(surfaced.sensed, 20);
  command('summon zombie 2.5 64 .5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["air-ownership-control"],Air:0s}');
  await delay(1500);
  const foreign = await ownedAir('foreign-air-changing');
  assert.equal(foreign.serverAir, 300); assert.equal(foreign.sensed, 20);
  assert(metadata.some(row => row.entityId !== row.ownEntityId && row.rawAir <= 0), 'apparatus-did-not-send-foreign-air');
  assert(metadata.some(row => row.entityId !== row.ownEntityId && row.sdkAggregate !== 20), 'installed-SDK-cross-talk-not-reproduced');
  const terminalSequence = body.latest().sequence;
  command('kill KairosAir'); await delay(200);
  const terminal = await environment.observe(); assert.equal(terminal.self.properties.health, 0);
  const offer = environment.listActionOffers(terminal).find(offer => offer.action.kind === 'respawn'); assert(offer);
  const restarted = await environment.executeOffer(offer); assert(restarted.executed && restarted.event);
  await writeFile(resolve(root, 'restart-event.json.gz'), gzipSync(JSON.stringify(restarted.event)));
  report.restart = { terminalSequence, result: restarted.event.bodyResult,
    sensedOxygen: restarted.observation.self.properties.oxygen, provenance: restarted.observation.bodySensation };
  assert(restarted.observation.self.properties.oxygen === undefined
    || restarted.observation.bodySensation?.oxygen?.value === restarted.observation.self.properties.oxygen);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  report.final = body ? body.latest().self : null;
  await body?.close(); await services.stop(); report.stoppedAt = new Date().toISOString();
  await save('setup.json', { commands, scope: report.scope }); await save('raw-air-packets.json', metadata);
  await save('owned-air-samples.json', samples); await writeFile(resolve(root, 'frames.json.gz'), gzipSync(JSON.stringify(frames)));
  await save('results.json', report); console.log(JSON.stringify(report));
}
