import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { ExperienceSession } from '../dist/src/experience-session.js';

// Consolidate previously archived actual windows. No policy, scene labels,
// target outcomes, new camera frames, or extra physical trials are supplied.
const [basePath, sources, output] = process.argv.slice(2);
if (!basePath || !sources || !output) throw new Error('required: BASE_SESSION SOURCES_COMMA_SEPARATED NEW_OUTPUT_GZ');
const decompress = promisify(gunzip), compress = promisify(gzip);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const baseBytes = await readFile(resolve(basePath));
const session = ExperienceSession.restore(JSON.parse(await decompress(baseBytes)));
const initialWrites = session.agent.medium.writes, evidence = [];
let exactOfferFrames = 0;
for (const source of sources.split(',').map(value => resolve(value))) {
  const report = JSON.parse(await readFile(resolve(source, 'results.json'), 'utf8'));
  if (!report.final || report.status === 'running') throw new Error('source-not-checkpointed-and-stopped');
  const rows = existsSync(resolve(source, 'journal', 'physical-actions'))
    ? await Promise.all((await readdir(resolve(source, 'journal', 'physical-actions'))).sort().map(async name =>
      JSON.parse(await readFile(resolve(source, 'journal', 'physical-actions', name), 'utf8'))))
    : (await readFile(resolve(source, 'physical-actions.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const byEvent = new Map(rows.filter(row => row.eventId).map(row => [row.eventId, row]));
  for (const name of (await readdir(resolve(source, 'events'))).filter(name => name.endsWith('.json.gz')).sort()) {
    const path = resolve(source, 'events', name), bytes = await readFile(path), event = JSON.parse(await decompress(bytes));
    if (!event.frames.every(frame => frame.sensation?.version === 'AnonymousRGBD1'
      && frame.perception?.version === 'AttentivePerception8')) throw new Error('source-requires-original-frame-migration:' + path);
    // Obsolete retained anchors must not be silently accepted as current
    // visible surface coordinates. This importer never changes a measurement.
    for (const frame of event.frames) for (const object of frame.objects) {
      const measured = frame.perception.tracks.find(track => track.id === object.id)?.surface?.point;
      if (measured && Math.hypot(...measured.map((value, i) => value - object.relativePosition[i])) > 1e-8)
        throw new Error('source-uses-an-unmeasured-retained-anchor:' + path);
    }
    const offers = byEvent.get(event.id)?.availableOffers;
    const exactOffers = Array.isArray(offers) && offers.length > 0
      && offers.every(offer => offer.observationSequence === event.frames[0].sequence);
    if (exactOffers) { session.agent.affordances.observe(event.frames[0], offers); exactOfferFrames++; }
    const learned = session.agent.medium.observe(event);
    if (!learned.learned) throw new Error('source-window-was-not-new:' + event.id);
    evidence.push({ path, sha256: digest(bytes), eventId: event.id, exactOffers,
      measuredChannels: learned.measuredChannels, maskedObjects: learned.maskedObjects });
    if (evidence.length % 128 === 0) console.log(JSON.stringify({ appendedWindows: evidence.length,
      writes: session.agent.medium.writes, exactOfferFrames }));
  }
}
const bytes = await compress(JSON.stringify(new ExperienceSession(session.agent.medium, session.agent.affordances).snapshot()));
const provenance = { scope: 'one-time consolidation of archived actual windows; no new physical trials',
  base: { path: resolve(basePath), sha256: digest(baseBytes), writes: initialWrites },
  newPhysicalTrials: 0, appendedWindows: evidence.length, writes: session.agent.medium.writes,
  exactOfferFrames, missingOrStaleOfferFrames: evidence.length - exactOfferFrames,
  outputSha256: digest(bytes), compiledHashes: Object.fromEntries(await Promise.all([
    'experience-medium', 'contextual-readout', 'learned-affordances', 'numeric-ranges'].map(async name =>
    [name, digest(await readFile(new URL('../dist/src/' + name + '.js', import.meta.url)))]))), evidence };
await writeFile(resolve(output), bytes, { flag: 'wx' });
await writeFile(resolve(output + '.provenance.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), writes: provenance.writes,
  appendedWindows: evidence.length, exactOfferFrames, newPhysicalTrials: 0 }));
