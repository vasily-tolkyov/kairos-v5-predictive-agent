import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { canonical, fileSha, sha, saveJson } from '../dist/src/util.js';
import { validateEvent } from '../dist/src/events.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' },
  'expected-events': { type: 'string', default: '128' } } });
if (!values.input || !values.output) throw new Error('audit-requires-input-and-new-output');
const expectedEvents = Number(values['expected-events']);
if (!Number.isInteger(expectedEvents) || expectedEvents < 1) throw new Error('invalid-expected-events');
const directory = resolve(values.input), rawFrames = new Map();
let previous = null, gaps = 0;
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'frames.jsonl')), crlfDelay: Infinity })) {
  if (!line) continue;
  const { kind, value } = JSON.parse(line);
  if (kind !== 'frame') throw new Error(`unexpected-frame-record:${kind}`);
  if (rawFrames.has(value.sequence)) throw new Error('duplicate-raw-frame');
  if (previous !== null && value.sequence !== previous + 1) gaps++;
  previous = value.sequence;
  rawFrames.set(value.sequence, sha(value));
}
const events = [], bodyResults = [];
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')), crlfDelay: Infinity })) {
  if (!line) continue;
  const record = JSON.parse(line);
  if (record.kind === 'real-event') events.push(record.value);
  if (record.kind === 'body-result') bodyResults.push(record.value);
}
let embeddedFrames = 0, mismatches = 0, receiptMismatches = 0;
for (const event of events) {
  validateEvent(event);
  for (const frame of event.frames) { embeddedFrames++; if (rawFrames.get(frame.sequence) !== sha(frame)) mismatches++; }
  const receipts = bodyResults.filter(value => value.startSequence === event.bodyResult.startSequence
    && value.endSequence === event.bodyResult.endSequence);
  if (receipts.length !== 1 || canonical(receipts[0]) !== canonical(event.bodyResult)) receiptMismatches++;
}
const clean = existsSync(resolve(directory, 'CLEAN_CAPTURE_RESULT.json'));
const result = JSON.parse(await readFile(resolve(directory, clean ? 'CLEAN_CAPTURE_RESULT.json' : 'CAPTURE_RESULT.json'), 'utf8'));
// The first clean-capture reporter assigned undefined to a null success value,
// so its completedCapture boolean was false despite all declared episodes
// completing.  Recompute only that reporter status from the immutable raw
// counts and error absence; never alter or ignore any failed body event.
const completed = clean ? !result.failure && result.capturedEpisodes === result.expectedEpisodes
  && result.realEvents === result.expectedRealEvents : result.completedCapture;
const passed = completed && gaps === 0 && mismatches === 0 && receiptMismatches === 0
  && new Set(events.map(event => event.id)).size === events.length && events.length === expectedEvents
  && bodyResults.length === events.length;
await saveJson(resolve(values.output), { kind: 'independent-raw-frame-and-receipt-audit', passed,
  physicalWrites: 0, controllerExecutions: 0, frameCount: rawFrames.size, gaps,
  eventCount: events.length, receiptCount: bodyResults.length, embeddedFrames, mismatches, receiptMismatches,
  eventsSha256: await fileSha(resolve(directory, 'events.jsonl')),
  framesSha256: await fileSha(resolve(directory, 'frames.jsonl')) });
if (!passed) process.exitCode = 1;
console.log(JSON.stringify({ passed, frameCount: rawFrames.size, eventCount: events.length,
  embeddedFrames, gaps, mismatches, receiptMismatches }));
