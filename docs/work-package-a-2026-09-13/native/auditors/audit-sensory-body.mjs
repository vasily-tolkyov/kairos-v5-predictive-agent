import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateEvent } from '../dist/src/events.js';
const [root, output] = process.argv.slice(2);
const load = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const result = await load('results.json');
assert.equal(result.status, 'passed');
const attack = JSON.parse(gunzipSync(await readFile(resolve(root, 'attack-event.json.gz'))));
const item = JSON.parse(gunzipSync(await readFile(resolve(root, 'use-item-event.json.gz'))));
validateEvent(attack); validateEvent(item);
const receipt = item.bodyResult.motorReceipt;
assert(receipt); assert.equal(receipt.requestedTicks, 40); assert.equal(receipt.actualTicks, 40);
assert.equal(receipt.actualSeconds, 2); assert.equal(receipt.releaseReason, 'interval-complete');
const first = item.frames[0].self.properties, last = item.frames.at(-1).self.properties;
const held = result.records.find(row => row.kind === 'held-item-use');
assert.equal(first.food, held.foodBefore); assert.equal(last.food, held.foodAfter);
assert.equal(first.gripCount, held.countBefore); assert.equal(last.gripCount, held.countAfter);
assert(last.food > first.food); assert(last.gripCount < first.gripCount);
const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
const health = [...log.matchAll(/has the following entity data: ([\d.]+)f/g)].map(match => Number(match[1]));
const contact = result.records.find(row => row.kind === 'entity-perception-and-contact');
assert.deepEqual(health.slice(-2), [contact.healthBefore, contact.healthAfter]); assert(health.at(-1) < health.at(-2));
const food = [...log.matchAll(/KairosSense has the following entity data: ([\d.]+)\s*$/gm)].map(match => Number(match[1]));
assert.equal(food.at(-1), last.food); assert(log.includes('All dimensions are saved'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const filenames = ['results.json', 'attack-event.json.gz', 'use-item-event.json.gz', 'server-evidence/minecraft-server.log'];
const evidenceSha256 = Object.fromEntries(await Promise.all(filenames.map(async name => [name, digest(await readFile(resolve(root, name)))])));
const audit = { version: 'NativeSensoryBodyReceiptAudit1', status: 'passed', source: resolve(root),
  auditedAt: new Date().toISOString(), motorReceipt: receipt, foodBefore: first.food, foodAfter: last.food,
  countBefore: first.gripCount, countAfter: last.gripCount, engineFood: food.at(-1),
  engineEntityHealthBefore: health.at(-2), engineEntityHealthAfter: health.at(-1), evidenceSha256,
  evaluatorSelectedPhysicalActions: 2, autonomousTrials: 0, learningWrites: 0,
  limitation: 'Isolated apparatus-selected entity contact and held-item use; no learned survival/task result and no native held-item CPU catch-up or interruption trial.' };
await writeFile(resolve(output), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: audit.status, output, actualItemTicks: receipt.actualTicks, engineFood: food.at(-1) }));
