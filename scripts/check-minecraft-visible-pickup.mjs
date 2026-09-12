import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Isolated sensing/contact apparatus. No demonstrations are fed to a learner.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25602' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = values.build ? resolve(values.build) : new URL('../dist/', import.meta.url).pathname;
const { Services } = await import(resolve(build, 'src/services.js'));
const { MinecraftBody } = await import(resolve(build, 'src/body.js'));
const { MinecraftExperienceEnvironment } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));
const { visibleItemColor } = await import(resolve(build, 'src/adapters/minecraft/retina.js'));
const root = resolve(values.output); await mkdir(root);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosPickup',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const runtimeRoot = resolve(root, 'runtime'), services = new Services(config, runtimeRoot, resolve(root, 'server-evidence'));
const frames = [], commands = [], windows = []; let body;
const report = { status: 'running', runtimeRoot, scope: 'native item visibility/contact apparatus; no autonomous learning/planning claim',
  build, bodySha256: createHash('sha256').update(await readFile(resolve(build, 'src/body.js'))).digest('hex'),
  startedAt: new Date().toISOString() };
const command = text => { commands.push(text); services.command(text); };
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const icon = visibleItemColor('apple'); assert(icon);
const matchingPixels = observation => {
  const visual = observation.sensation; let count = 0;
  for (let i = 0; i < visual.samples.length; i += 4)
    if (visual.samples[i + 3] >= 0 && icon.every((value, c) => Math.abs(value - visual.samples[i + c]) < 1e-10)) count++;
  return count;
};
try {
  await services.start('empty'); command('fill -5 63 -5 5 63 5 bedrock');
  command('fill -1 64 -1 1 65 -1 stone');
  command('summon item .5 64 -1.7 {Item:{id:"minecraft:apple",count:1},Motion:[0d,0d,0d],PickupDelay:0s}');
  body = new MinecraftBody({ ...config.minecraft, worldId: 'visible-pickup-apparatus' }, (kind, value) => {
    if (kind === 'frame') frames.push(value);
  });
  await body.ready(); const environment = new MinecraftExperienceEnvironment(body);
  command('tp KairosPickup .5 64 .5 180 33'); await delay(700);
  const hidden = await environment.observe(); await save('occluded.json', hidden);
  assert.equal(matchingPixels(hidden), 0, 'an occluder must hide the item image');
  command('fill -1 64 -1 1 65 -1 air'); await delay(700);
  const visible = await environment.observe(); await save('visible.json', visible);
  const pixels = matchingPixels(visible); report.visiblePixels = pixels;
  assert(pixels > 0, 'dropped-item-has-no-measured-image');
  assert(visible.objects.some(object => ['red', 'green', 'blue'].every((key, i) =>
    Math.abs(Number(object.properties[key]) - icon[i]) < .03)), 'item-image-never-forms-an-anonymous-percept');
  assert(!JSON.stringify(visible).includes('apple')); assert(!JSON.stringify(visible).includes('entity:'));
  const beforeCount = visible.self.properties.hotbarCount0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const observed = await environment.observe();
    if (observed.self.properties.hotbarCount0 > beforeCount) break;
    const offer = environment.listActionOffers(observed).find(offer => offer.action.kind === 'move'
      && offer.action.parameters.direction === 'forward' && offer.action.parameters.ticks === 4); assert(offer);
    const result = await environment.executeOffer(offer); assert(result.executed && result.event); windows.push(result.event);
  }
  const after = await environment.observe(); await save('after-contact.json', after);
  assert(after.self.properties.hotbarCount0 > beforeCount, 'ordinary-contact-did-not-change-visible-inventory');
  services.command('data get entity KairosPickup Inventory'); await delay(250);
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const inventory = [...log.matchAll(/KairosPickup has the following entity data: (\[[^\n]*\])/g)].at(-1)?.[1];
  assert(inventory?.includes('minecraft:apple') && inventory.includes('count: 1'), 'independent-server-inventory-does-not-confirm-pickup');
  report.contact = { beforeCount, afterCount: after.self.properties.hotbarCount0, actions: windows.length, serverInventory: inventory };
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  report.final = body ? body.latest().self : null;
  await body?.close(); await services.stop(); report.stoppedAt = new Date().toISOString();
  await save('setup.json', { commands, scope: report.scope });
  await writeFile(resolve(root, 'frames.json.gz'), gzipSync(JSON.stringify(frames)));
  await writeFile(resolve(root, 'contact-windows.json.gz'), gzipSync(JSON.stringify(windows)));
  await save('results.json', report); console.log(JSON.stringify(report));
}
