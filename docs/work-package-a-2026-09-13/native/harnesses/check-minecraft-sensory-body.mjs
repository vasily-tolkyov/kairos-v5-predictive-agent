import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzip } from 'node:zlib';

// Static apparatus and direct port checks, never autonomous capability trials.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25595' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = values.build ? resolve(values.build) : new URL('../dist/', import.meta.url).pathname;
const { Services } = await import(resolve(build, 'src/services.js'));
const { MinecraftBody } = await import(resolve(build, 'src/body.js'));
const { MinecraftExperienceEnvironment } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));
const root = resolve(values.output); await mkdir(root);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosSense',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const services = new Services(config, resolve(root, 'runtime'), resolve(root, 'server-evidence'));
const report = { status: 'running', scope: 'native sensory and actuator checks; no autonomous learning or planning claim', records: [] };
const compress = promisify(gzip), commands = []; let body;
const command = text => { commands.push(text); services.command(text); };
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const serverNumber = async (selector, field) => {
  services.command(`data get entity ${selector} ${field}`); await delay(200);
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const match = [...log.matchAll(/has the following entity data: ([\d.]+)[fb]?\s*$/gm)].at(-1);
  assert(match, 'missing-independent-numeric-audit'); return Number(match[1]);
};
try {
  await services.start('empty');
  command('difficulty normal');
  command('fill -5 63 -5 5 68 5 bedrock hollow');
  command('fill -1 64 -1 1 66 -1 stone');
  command('summon drowned .5 64 -2.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["kairos-sensory-check"]}');
  body = new MinecraftBody({ ...config.minecraft, worldId: 'sensory-body-check' }, () => {}); await body.ready();
  const environment = new MinecraftExperienceEnvironment(body);
  command('tp KairosSense .5 64 .5 180 0'); await delay(700);
  const occluded = await environment.observe(); await save('occluded.json', occluded);
  assert(!environment.listActionOffers(occluded).some(offer => offer.action.kind === 'attack'));
  command('fill -1 64 -1 1 66 -1 air'); await delay(700);
  const visible = await environment.observe(); await save('visible.json', visible);
  await save('visible-raw-body.json', body.latest());
  await save('visible-offers.json', environment.listActionOffers(visible));
  const attack = environment.listActionOffers(visible).find(offer => offer.action.kind === 'attack');
  assert(attack, 'visible-entity-lacks-anonymous-bound-offer');
  assert(visible.objects.some(object => object.id === attack.action.targetId));
  assert(!JSON.stringify(visible).includes('drowned')); assert(!JSON.stringify(visible).includes('entity:'));
  const target = '@e[tag=kairos-sensory-check,limit=1]', healthBefore = await serverNumber(target, 'Health');
  const attacked = await environment.executeOffer(attack); assert(attacked.executed && attacked.event);
  await writeFile(resolve(root, 'attack-event.json.gz'), await compress(JSON.stringify(attacked.event)));
  const healthAfter = await serverNumber(target, 'Health'); assert(healthAfter < healthBefore, 'server-did-not-confirm-contact');
  report.records.push({ kind: 'entity-perception-and-contact', occludedAttackOffers: 0,
    anonymousTarget: attack.action.targetId, healthBefore, healthAfter, frames: attacked.event.frames.length });

  command('item replace entity KairosSense weapon.mainhand with apple 3');
  command('effect give KairosSense hunger 4 200 true'); await delay(4500);
  command('effect clear KairosSense'); await delay(200);
  const before = await environment.observe(); await save('held-item-before.json', before);
  assert(before.self.properties.food < 20, 'apparatus-did-not-create-measurable-deficit');
  assert(before.self.properties.gripColor0 !== undefined, 'non-block-item-has-no-visible-icon');
  const use = environment.listActionOffers(before).find(offer => offer.action.kind === 'use-item'); assert(use);
  const used = await environment.executeOffer(use); assert(used.executed && used.event);
  await writeFile(resolve(root, 'use-item-event.json.gz'), await compress(JSON.stringify(used.event)));
  const after = used.observation, serverFood = await serverNumber('KairosSense', 'foodLevel');
  assert(after.self.properties.food > before.self.properties.food, 'held-item-window-had-no-observed-effect');
  assert.equal(serverFood, after.self.properties.food);
  assert(after.self.properties.gripCount < before.self.properties.gripCount);
  report.records.push({ kind: 'held-item-use', foodBefore: before.self.properties.food, foodAfter: after.self.properties.food,
    countBefore: before.self.properties.gripCount, countAfter: after.self.properties.gripCount,
    serverFood, frames: used.event.frames.length, termination: used.event.bodyResult.terminationReason });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await body?.close(); await services.stop();
  await save('setup.json', { commands, scope: report.scope }); await save('results.json', report);
}
