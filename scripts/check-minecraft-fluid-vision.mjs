import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Native optical apparatus only. Static scene changes never train an agent.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25631' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = values.build ? resolve(values.build) : new URL('../dist/', import.meta.url).pathname;
const { Services } = await import(resolve(build, 'src/services.js'));
const { MinecraftBody } = await import(resolve(build, 'src/body.js'));
const { MinecraftExperienceEnvironment } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));
const root = resolve(values.output); await mkdir(root);
const runtimeRoot = resolve(root, 'runtime');
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosFluid',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const services = new Services(config, runtimeRoot, resolve(root, 'server-evidence'));
const frames = [], commands = []; let body;
const report = { status: 'running', runtimeRoot, build,
  scope: 'native fluid visibility and occlusion apparatus; no autonomous actions or learning',
  bodySha256: createHash('sha256').update(await readFile(resolve(build, 'src/body.js'))).digest('hex'),
  startedAt: new Date().toISOString() };
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const command = value => { commands.push(value); services.command(value); };
const changedPixels = (a, b) => {
  let changed = 0;
  for (let i = 0; i < a.sensation.samples.length; i += 4)
    if ([0, 1, 2, 3].some(channel => Math.abs(a.sensation.samples[i + channel] - b.sensation.samples[i + channel]) > 1e-8)) changed++;
  return changed;
};
try {
  await services.start('empty');
  command('fill -6 62 -8 6 63 5 bedrock');
  command('fill -2 63 -6 2 63 -2 air');
  body = new MinecraftBody({ ...config.minecraft, worldId: 'fluid-optical-apparatus' }, (kind, value) => {
    if (kind === 'frame') frames.push(value);
  });
  await body.ready(); const environment = new MinecraftExperienceEnvironment(body);
  command('tp KairosFluid .5 64 1.5 180 20'); await delay(800);
  const dry = await environment.observe(); await save('dry-open.json', dry);
  command('fill -2 63 -6 2 63 -2 water');
  command('execute if block 0 63 -3 water run say FLUID_SAMPLE_CONFIRMED'); await delay(800);
  const wet = await environment.observe(); await save('wet-open.json', wet);
  assert.deepEqual(wet.self.position, dry.self.position, 'apparatus observer moved');
  assert.equal(wet.self.yaw, dry.self.yaw); assert.equal(wet.self.pitch, dry.self.pitch);
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  assert(log.includes('FLUID_SAMPLE_CONFIRMED'), 'independent-server-fluid-check-missing');
  report.changedOpenPixels = changedPixels(dry, wet);
  assert(report.changedOpenPixels > 0, 'an-exposed-liquid-surface-has-no-measured-image');
  assert(!JSON.stringify(wet).includes('"water"') && !JSON.stringify(wet).includes('block:'));
  command('fill -3 63 -1 3 67 -1 stone'); await delay(600);
  const hiddenWet = await environment.observe(); await save('wet-occluded.json', hiddenWet);
  command('fill -2 63 -6 2 63 -2 air'); await delay(600);
  const hiddenDry = await environment.observe(); await save('dry-occluded.json', hiddenDry);
  report.changedOccludedPixels = changedPixels(hiddenWet, hiddenDry);
  assert.equal(report.changedOccludedPixels, 0, 'hidden-fluid-leaked-through-the-occluder');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  report.final = body ? body.latest().self : null;
  await body?.close(); await services.stop(); report.stoppedAt = new Date().toISOString();
  await save('setup.json', { commands, scope: report.scope });
  await writeFile(resolve(root, 'frames.json.gz'), gzipSync(JSON.stringify(frames)));
  await save('results.json', report); console.log(JSON.stringify(report));
}
