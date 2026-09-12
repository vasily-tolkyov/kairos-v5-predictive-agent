import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzip } from 'node:zlib';
import { Services } from '../dist/src/services.js';
import { MinecraftBody } from '../dist/src/body.js';
import { MinecraftExperienceEnvironment } from '../dist/src/adapters/minecraft/experience.js';

// A hardware-port check, not a controller policy or a learning curriculum.
// Fixture names and server audits stay on the evaluator's side of the boundary.
const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, port: { type: 'string', default: '25595' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
const root = resolve(values.output); await mkdir(root);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosPortCheck',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const services = new Services(config, resolve(root, 'runtime'), resolve(root, 'server-evidence'));
const records = [], compress = promisify(gzip); let body;
try {
  await services.start('empty');
  const setup = ['setblock 0 65 0 oak_planks', 'setblock 2 65 0 bedrock', 'setblock 4 65 0 oak_planks'];
  for (const command of setup) services.command(command);
  await writeFile(resolve(root, 'setup.json'), JSON.stringify({ commands: setup, scope: 'actuator validation only' }, null, 2));
  body = new MinecraftBody({ ...config.minecraft, worldId: 'port-check' }, () => {}); await body.ready();
  const environment = new MinecraftExperienceEnvironment(body);
  for (const [index, marker] of ['REMOVABLE_CHANGED', 'UNREMOVABLE_UNCHANGED', 'LATER_REMOVABLE_CHANGED'].entries()) {
    services.command(`tp KairosPortCheck ${index * 2 + .5} 64 2.5 180 0`); await delay(700);
    const before = await environment.observe(), raw = body.latest();
    assert.equal(raw.targetId, `block:${index * 2},65,0`);
    const offer = environment.listActionOffers(before).find(value => value.action.kind === 'break'); assert(offer);
    const started = Date.now(), receipt = await environment.executeOffer(offer);
    assert(receipt.executed && receipt.event); assert(receipt.event.frames.length >= 2);
    await writeFile(resolve(root, `event-${index}.json.gz`), await compress(JSON.stringify(receipt.event)));
    const expected = index === 1 ? 'bedrock' : 'air';
    services.command(`execute if block ${index * 2} 65 0 ${expected} run say ${marker}`); await delay(300);
    assert((await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8')).includes(marker), 'server-outcome-disagrees');
    records.push({ marker, executed: receipt.executed, physicalSeconds: (Date.now() - started) / 1000,
      frames: receipt.event.frames.length, termination: receipt.event.bodyResult.terminationReason,
      serverVerified: true, localPredictedBlockMutation: false });
  }
  await writeFile(resolve(root, 'results.json'), JSON.stringify({ status: 'passed',
    scope: 'native actuator feedback, not autonomous goal success', records }, null, 2));
} finally { await body?.close(); await services.stop(); }
