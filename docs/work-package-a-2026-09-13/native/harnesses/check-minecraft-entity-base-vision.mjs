import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Isolated native sensor/actuator calibration. Setup and the one test action
// are evaluator-owned; no learner receives a demonstration or these identities.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25632' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = values.build ? resolve(values.build) : fileURLToPath(new URL('../dist/', import.meta.url));
const { Services } = await import(pathToFileURL(resolve(build, 'src/services.js')).href);
const { MinecraftBody } = await import(pathToFileURL(resolve(build, 'src/body.js')).href);
const { MinecraftExperienceEnvironment } = await import(pathToFileURL(resolve(build, 'src/adapters/minecraft/experience.js')).href);
const { visibleEntityColor } = await import(pathToFileURL(resolve(build, 'src/adapters/minecraft/retina.js')).href);
const root = resolve(values.output); await mkdir(root);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosOptics',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const runtimeRoot = resolve(root, 'runtime'), services = new Services(config, runtimeRoot, resolve(root, 'server-evidence'));
const frames = [], commands = []; let body;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', runtimeRoot, build, startedAt: new Date().toISOString(),
  scope: 'native base-texture visibility, occlusion and motor binding apparatus; zero autonomous learning trials',
  learningWrites: 0, autonomousLearningTrials: 0, apparatusSelectedActions: 0,
  scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  buildHashes: Object.fromEntries(await Promise.all(['body.js', 'adapters/minecraft/retina.js', 'adapters/minecraft/experience.js']
    .map(async name => [name, sha(await readFile(resolve(build, 'src', name)))]))) };
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const command = text => { commands.push(text); services.command(text); };
const pixels = (observation, color) => {
  if (!color) return 0;
  const samples = observation.sensation.samples; let count = 0;
  for (let i = 0; i < samples.length; i += 4)
    if (samples[i + 3] >= 0 && color.every((v, c) => Math.abs(v - samples[i + c]) < 1e-10)) count++;
  return count;
};
const anonymous = observation => {
  const text = JSON.stringify(observation);
  assert(!text.includes('zombie_villager') && !text.includes('entity:') && !text.includes('retinalTargetId'),
    'engine identity leaked across the sensory adapter');
};
try {
  await services.start('empty', { worldSeed: '58130729' });
  for (const text of ['difficulty normal', 'gamerule doMobSpawning false', 'time set day',
    'fill -4 63 -6 4 63 4 bedrock', 'fill -4 67 -6 4 67 4 bedrock',
    'summon zombie_villager .5 64 -2 {NoAI:1b,Silent:1b,PersistenceRequired:1b}']) command(text);
  body = new MinecraftBody({ ...config.minecraft, worldId: 'entity-base-vision-apparatus' }, (kind, value) => {
    if (kind === 'frame') frames.push(value);
  });
  await body.ready(); const environment = new MinecraftExperienceEnvironment(body);
  command('tp KairosOptics .5 64 .5 180 0'); await delay(900);
  const visible = await environment.observe(), offered = environment.listActionOffers(visible);
  const entities = Object.values(body.bot.entities).filter(entity => entity.name === 'zombie_villager');
  report.serverEntityCount = entities.length;
  report.entityColor = visibleEntityColor('zombie_villager');
  report.visiblePixels = pixels(visible, report.entityColor);
  report.offeredActions = offered.map(offer => offer.action.kind);
  await save('visible.json', visible); await save('visible-offers.json', offered); anonymous(visible);
  assert.equal(entities.length, 1, 'native apparatus entity is missing');
  assert(report.entityColor && report.visiblePixels > 0, 'installed-base-entity-has-no-measured-image');
  assert(offered.some(offer => offer.action.kind === 'attack'), 'visible entity supplies no bound motor offer');

  command('fill 0 64 -1 0 66 -1 stone'); await delay(650);
  const occluded = await environment.observe(); await save('occluded.json', occluded); anonymous(occluded);
  report.occludedPixels = pixels(occluded, report.entityColor);
  assert.equal(report.occludedPixels, 0, 'the entity image crosses an opaque wall');
  assert(!environment.listActionOffers(occluded).some(offer => offer.action.kind === 'attack'), 'occluded attack offer leaked');

  command('fill 0 64 -1 0 66 -1 air'); await delay(650);
  const ready = await environment.observe();
  const attack = environment.listActionOffers(ready).find(offer => offer.action.kind === 'attack'); assert(attack);
  command('data get entity @e[type=minecraft:zombie_villager,limit=1] Health'); await delay(200);
  const receipt = await environment.executeOffer(attack);
  assert(receipt.executed && receipt.event, 'bound native motor was not executed');
  report.apparatusSelectedActions = 1;
  await writeFile(resolve(root, 'attack-window.json.gz'), gzipSync(JSON.stringify(receipt.event)));
  anonymous(receipt.event);
  command('data get entity @e[type=minecraft:zombie_villager,limit=1] Health'); await delay(300);
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const health = [...log.matchAll(/has the following entity data: ([\d.]+)f/g)].map(match => Number(match[1]));
  assert(health.length >= 2 && health.at(-1) < health.at(-2), 'server did not confirm the native hit');
  report.hit = { healthBefore: health.at(-2), healthAfter: health.at(-1), frames: receipt.event.frames.length };
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await body?.close(); await services.stop(); report.stoppedAt = new Date().toISOString();
  await save('setup.json', { commands, scope: report.scope });
  await writeFile(resolve(root, 'frames.json.gz'), gzipSync(JSON.stringify(frames)));
  await save('results.json', report); console.log(JSON.stringify(report));
}
