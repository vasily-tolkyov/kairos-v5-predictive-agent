import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzip } from 'node:zlib';

// Evaluator-only actuator comparison. No outcomes or action sequences are
// supplied to a learner, and these windows are not an autonomy trial.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25595' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const build = values.build ? resolve(values.build) : new URL('../dist/', import.meta.url).pathname;
const { Services } = await import(resolve(build, 'src/services.js'));
const { MinecraftBody } = await import(resolve(build, 'src/body.js'));
const { MinecraftExperienceEnvironment } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));
const root = resolve(values.output); await mkdir(root);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosSwimCheck',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const services = new Services(config, resolve(root, 'runtime'), resolve(root, 'server-evidence'));
const report = { status: 'running', scope: 'native actuator validation, not autonomous learning or goal success', records: [] };
const compress = promisify(gzip); let body;
try {
  await services.start('empty');
  const setup = ['fill -3 59 -3 3 67 3 bedrock hollow', 'fill -2 60 -2 2 66 2 water'];
  for (const command of setup) services.command(command);
  await writeFile(resolve(root, 'setup.json'), JSON.stringify({ commands: setup, scope: report.scope }, null, 2));
  body = new MinecraftBody({ ...config.minecraft, worldId: 'swim-port-check' }, () => {}); await body.ready();
  const environment = new MinecraftExperienceEnvironment(body);
  services.command('tp KairosSwimCheck .5 60 .5 180 0'); await delay(700);
  for (const [index, parameters] of [{ forward: false, ticks: 4 }, { forward: false, holdTicks: 20 }].entries()) {
    const before = await environment.observe();
    const action = { kind: 'jump', parameters };
    // The legacy pulse remains directly callable only for this comparison.
    const receipt = index === 0 ? await body.execute(action) : await environment.executeOffer(
      environment.listActionOffers(before).find(offer => offer.action.kind === 'jump'
        && offer.action.parameters.holdTicks === 20 && !offer.action.parameters.forward));
    const event = receipt.event; assert(event);
    await writeFile(resolve(root, `event-${index}.json.gz`), await compress(JSON.stringify(event)));
    const after = event.frames.at(-1);
    services.command('data get entity KairosSwimCheck Pos'); await delay(150);
    const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
    const text = [...log.matchAll(/KairosSwimCheck has the following entity data: \[([^\]]+)\]/g)].at(-1)?.[1];
    assert(text, 'missing-independent-server-position');
    const serverPosition = text.split(',').map(value => Number(value.trim().replace(/d$/, '')));
    assert(serverPosition.length === 3 && serverPosition.every(Number.isFinite));
    report.records.push({ parameters, before: before.self, after: after.self, serverPosition,
      frames: event.frames.length, termination: event.bodyResult.terminationReason });
    if (index === 0) assert(after.self.position[1] - before.self.position[1] < .1, 'legacy-control-outcome-differs-from-diagnosis');
    else {
      assert(after.self.position[1] > before.self.position[1] + .1);
      assert(serverPosition[1] > before.self.position[1] + .1, 'server-did-not-confirm-ascent');
      assert(Number.isFinite(after.self.properties.oxygen), 'breathing-channel-missing');
      assert.equal(event.bodyResult.terminationReason, 'motor-released');
    }
  }
  services.command('kill KairosSwimCheck');
  for (let n = 0; n < 40 && (await environment.observe()).self.properties.health > 0; n++) await delay(50);
  await delay(300);
  const terminal = await environment.observe(); assert.equal(terminal.self.properties.health, 0, 'SDK-restarted-without-a-chosen-action');
  const offers = environment.listActionOffers(terminal); assert.deepEqual(offers.map(offer => offer.action.kind), ['respawn']);
  const restarted = await environment.executeOffer(offers[0]); assert(restarted.executed && restarted.event);
  assert.equal(restarted.event.cue.kind, 'respawn'); assert(restarted.observation.self.properties.health > 0);
  await writeFile(resolve(root, 'event-2.json.gz'), await compress(JSON.stringify(restarted.event)));
  services.command('data get entity KairosSwimCheck Health'); await delay(150);
  const audit = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const serverHealth = Number([...audit.matchAll(/KairosSwimCheck has the following entity data: ([\d.]+)f/g)].at(-1)?.[1]);
  assert(serverHealth > 0, 'server-did-not-confirm-restart');
  report.records.push({ kind: 'explicit-restart', automaticRestart: false, healthBefore: terminal.self.properties.health,
    healthAfter: restarted.observation.self.properties.health, serverHealth, frames: restarted.event.frames.length });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await body?.close(); await services.stop();
  await writeFile(resolve(root, 'results.json'), JSON.stringify(report, null, 2));
}
