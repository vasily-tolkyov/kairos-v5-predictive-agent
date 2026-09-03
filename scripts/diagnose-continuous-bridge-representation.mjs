import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistanceEmbedding } from '../dist/src/distance-embedding.js';
import { eventRows, relativePublicFeatures } from '../dist/src/events.js';

const project = resolve(import.meta.dirname, '..');
const source = JSON.parse(await readFile(resolve(project, 'evidence',
  'hierarchical-multilevel-goal-chain-live-v1-attempt-017',
  'REBUILT_ROLE_BOUND_HIERARCHICAL_EXPERIENCE.json'), 'utf8'));
const run = process.argv[2] ?? 'hierarchical-continuous-bridge-curriculum-live-v1-attempt-002';
const first = Number(process.argv[3] ?? 281), last = Number(process.argv[4] ?? 298);
const lines = (await readFile(resolve(project, 'evidence', run, 'frames.jsonl'), 'utf8'))
  .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const frames = lines.filter(row => row.kind === 'frame' && row.value.sequence >= first
  && row.value.sequence <= last).map(row => row.value);
const event = { version: 'RealEventV5', id: 'diagnostic',
  cue: { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null },
  frames, trackedIds: ['self', ...(process.argv[5] ? [process.argv[5]] : [])],
  bodyResult: { action: { kind: 'move', parameters: { direction: 'forward', ticks: 4 } },
    executed: true, status: 'completed', terminationReason: 'stable',
    startSequence: first, endSequence: last }, provenance: 'executed-real-body', complete: true };
const rows = eventRows(event).rows;
const embedding = new DistanceEmbedding(source.eventMap);
const encoded = rows.map(row => embedding.encode(row));
let maximumAdjacentGap = 0;
for (let index = 1; index < encoded.length; index++) maximumAdjacentGap = Math.max(maximumAdjacentGap,
  Math.hypot(...encoded[index].coordinate.map((value, axis) => value - encoded[index - 1].coordinate[axis])));
const vocabulary = new Set(source.contextVocabulary);
const unknownKeys = [...new Set([...encoded.flatMap(value => value.unknownKeys),
  ...[frames[0], frames.at(-1)].flatMap(frame => Object.keys(relativePublicFeatures(frame)))
    .filter(key => !vocabulary.has(key))])].sort();
process.stdout.write(`${JSON.stringify({ run, first, last, frameCount: frames.length,
  activeSeconds: frames.length ? [frames[0].activeSeconds, frames.at(-1).activeSeconds] : null,
  maximumAdjacentGap, limit: .06, unknownKeys,
  contextKeyCount: source.contextKeys.length, contextVocabularyCount: source.contextVocabulary.length,
  firstObjects: frames[0]?.objects.map(value => ({ id: value.id, type: value.type })),
  lastObjects: frames.at(-1)?.objects.map(value => ({ id: value.id, type: value.type })) }, null, 2)}\n`);
