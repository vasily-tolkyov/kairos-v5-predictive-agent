import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ExperienceMedium } from '../dist/src/experience-medium.js';

const [checkpoint, run, output, phase = 'learn-A'] = process.argv.slice(2);
if (!checkpoint || !run || !output) throw new Error('usage: recover-experience-journal.mjs CHECKPOINT.gz RUN NEW_CHECKPOINT.gz [PHASE]');
const decompress = promisify(gunzip), compress = promisify(gzip);
const medium = ExperienceMedium.restore(JSON.parse(await decompress(await readFile(resolve(checkpoint)))));
const startWrites = medium.writes, records = [];
for (const name of (await readdir(resolve(run, 'events'))).sort()) {
  const path = resolve(run, 'events', name), raw = await readFile(path), record = JSON.parse(await decompress(raw));
  if (record.phase !== phase) continue;
  const result = medium.observe(record.event);
  records.push({ path, sha256: createHash('sha256').update(raw).digest('hex'), eventId: record.event.id, learned: result.learned });
}
await writeFile(resolve(output), await compress(JSON.stringify(medium.snapshot())), { flag: 'wx' });
const report = { checkpoint: resolve(checkpoint), startWrites, endWrites: medium.writes,
  recoveredWindows: medium.writes - startWrites, duplicateWindows: records.filter(r => !r.learned).length,
  newPhysicalTrials: 0, records };
await writeFile(resolve(output + '.provenance.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ startWrites, endWrites: medium.writes, recoveredWindows: report.recoveredWindows, newPhysicalTrials: 0 }));
