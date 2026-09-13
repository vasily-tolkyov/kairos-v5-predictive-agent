import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { ExperienceSession, ExperienceMedium } from '../dist/src/prototype.js';
import { MinecraftBodyConnection } from './minecraft-body-connection.mjs';
import { loadConfiguration } from '../dist/src/services.js';
import { MinecraftExperienceEnvironment } from '../dist/src/adapters/minecraft/experience.js';
import { EvidenceJournal } from './evidence-journal.mjs';

const { values } = parseArgs({ options: { help: { type: 'boolean' },
  output: { type: 'string' }, actions: { type: 'string', default: '1024' },
  seconds: { type: 'string', default: '3600' }, restore: { type: 'string' },
  'same-world': { type: 'boolean' }, goal: { type: 'string' } } });
if (values.help || !values.output) {
  process.stdout.write('Usage: npm start -- --output NEW_DIRECTORY [--actions 1024] [--seconds 3600]\n'
    + '  [--restore MEMORY_OR_SESSION.json[.gz]] [--same-world] [--goal GOAL_OR_GOAL_ARRAY.json]\n'
    + 'Continues autonomous investigation when no user goal is pending. Limits pause and checkpoint the session.\n'
    + '--same-world restores unfinished tasks and spatial memories; use only when coordinates refer to the same world.\n');
  process.exit(values.help ? 0 : 2);
}
const budget = Number(values.actions), seconds = Number(values.seconds);
if (!Number.isSafeInteger(budget) || budget < 1 || !Number.isFinite(seconds) || seconds <= 0)
  throw new Error('invalid-session-budget');
const compress = promisify(gzip), decompress = promisify(gunzip), output = resolve(values.output);
const journal = new EvidenceJournal(output);
let session = new ExperienceSession();
if (values.restore) {
  const bytes = await readFile(resolve(values.restore));
  const state = JSON.parse((bytes[0] === 31 && bytes[1] === 139 ? await decompress(bytes) : bytes).toString());
  session = state.version === 'ExperienceSession1' ? ExperienceSession.restore(state, { sameWorld: !!values['same-world'] })
    : new ExperienceSession(ExperienceMedium.restore(state));
}
if (values.goal) {
  const input = JSON.parse(await readFile(resolve(values.goal), 'utf8'));
  for (const goal of Array.isArray(input) ? input : [input]) session.submit(goal);
}
await mkdir(dirname(output), { recursive: true }); await mkdir(output); await mkdir(resolve(output, 'events'));
await mkdir(resolve(output, 'passive-events'));
const save = async () => {
  const temporary = resolve(output, 'session.pending.json.gz');
  await writeFile(temporary, await compress(JSON.stringify(session.snapshot())));
  await rename(temporary, resolve(output, 'session.json.gz'));
};
const config = await loadConfiguration();
const body = new MinecraftBodyConnection({ ...config.minecraft, worldId: 'experience-' + randomUUID() }, () => {});
const base = new MinecraftExperienceEnvironment(body);
let eventCount = 0, stopping = false;
let passiveCount = 0;
const recordPassive = async events => {
  for (const event of events ?? []) await writeFile(resolve(output, 'passive-events', String(++passiveCount).padStart(7, '0') + '.json.gz'),
    await compress(JSON.stringify(event)));
  return events ?? [];
};
process.once('SIGINT', () => { stopping = true; }); process.once('SIGTERM', () => { stopping = true; });
const environment = {
  maintenanceGoals: base.maintenanceGoals,
  drainPassiveEvents: async () => recordPassive(await base.drainPassiveEvents()),
  observe: () => base.observe(), listActionOffers: observation => base.listActionOffers(observation),
  waitForObservationAfter: sequence => base.waitForObservationAfter(sequence),
  executeOffer: async (offer, beforeExecute) => {
    let receipt;
    try { receipt = await base.executeOffer(offer, beforeExecute); }
    catch (error) {
      await journal.write('action-errors', { error: String(error.stack ?? error), offer });
      try { await recordPassive(await base.drainPassiveEvents()); }
      catch (recoveryError) { await journal.write('action-errors', { phase: 'passive-recovery',
        error: String(recoveryError.stack ?? recoveryError), offer }); }
      throw error;
    }
    await recordPassive(receipt.precedingPassiveEvents);
    if (receipt.event) await writeFile(resolve(output, 'events', String(++eventCount).padStart(7, '0') + '.json.gz'),
      await compress(JSON.stringify(receipt.event)));
    return receipt;
  },
};
const start = Date.now(); let status = 'budget-paused', failure;
try {
  await body.ready();
  for (let index = 0; index < budget; index++) {
    stopping ||= existsSync(resolve(output, 'PAUSE'));
    if (stopping) { status = 'operator-paused'; break; }
    if ((Date.now() - start) / 1000 >= seconds) { status = 'duration-paused'; break; }
    const decision = await session.step(environment);
    await journal.write('decisions', decision);
    if (index % 32 === 31 || decision.status === 'goal-verified') {
      await save(); process.stdout.write(JSON.stringify({ ...session.stats, seconds: (Date.now() - start) / 1000 }) + '\n');
    }
    if (decision.status === 'observation-stalled' || decision.status === 'no-offers') { status = decision.status; break; }
  }
} catch (error) { status = 'fault-paused'; failure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  try {
    await save();
    try { await journal.export(); }
    catch (error) { status = 'evidence-incomplete'; failure = String(error.stack ?? error); process.exitCode = 1; }
    const result = { status, failure, seconds: (Date.now() - start) / 1000, ...session.stats, tasks: session.tasks, output };
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify({ status, failure, ...session.stats, output }) + '\n');
  } finally { await body.close(); }
}
