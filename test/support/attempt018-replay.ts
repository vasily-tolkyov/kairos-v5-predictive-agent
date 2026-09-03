import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { ActionCue, BodyResult, Observation, RealEvent } from '../../src/contracts.js';

export const ATTEMPT_018 = resolve(
  'evidence/hierarchical-multilevel-goal-chain-live-v1-attempt-018',
);

interface RecordedLine<T> { readonly kind: string; readonly value: T }
interface FrozenFoundationSpecification {
  readonly episodeId: string;
  readonly arm: string;
  readonly chain: { readonly actionCue: ActionCue; readonly verificationCue: ActionCue };
}
interface FrozenProtocol {
  readonly foundation: readonly FrozenFoundationSpecification[];
}

async function jsonLines<T>(path: string): Promise<T[]> {
  const values: T[] = [];
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) values.push(JSON.parse(line) as T);
  return values;
}

function sameAction(cue: ActionCue, result: BodyResult): boolean {
  return cue.kind === result.action.kind
    && JSON.stringify(cue.parameters) === JSON.stringify(result.action.parameters);
}

function trackedIds(frames: readonly Observation[], result: BodyResult): readonly string[] {
  const ids = new Set<string>(['self']);
  if (result.action.targetId) ids.add(result.action.targetId);
  const first = frames[0]!, last = frames.at(-1)!;
  const firstById = new Map(first.objects.map(value => [value.id, value]));
  const lastById = new Map(last.objects.map(value => [value.id, value]));
  for (const id of new Set([...firstById.keys(), ...lastById.keys()])) {
    const before = firstById.get(id), after = lastById.get(id);
    if (JSON.stringify(before) !== JSON.stringify(after)) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Reconstructs only facts present in sealed public frames and body receipts.
 * Arm/comparison names remain in `scorerArms`; they are never copied into a
 * RealEvent passed to a learner.
 */
export async function readAttempt018RealEvents(
  directory = ATTEMPT_018,
): Promise<{ readonly events: readonly RealEvent[]; readonly scorerArms: readonly string[];
  readonly sourceFrameCount: number }> {
  const protocol = JSON.parse(
    await readFile(resolve(directory, 'RUN_PROTOCOL.json'), 'utf8'),
  ) as FrozenProtocol;
  const eventLines = await jsonLines<RecordedLine<BodyResult>>(resolve(directory, 'events.jsonl'));
  const receipts = eventLines.filter(value => value.kind === 'body-result').map(value => value.value);
  const frameLines = await jsonLines<RecordedLine<Observation>>(resolve(directory, 'frames.jsonl'));
  const frames = frameLines.filter(value => value.kind === 'frame').map(value => value.value);
  const bySequence = new Map(frames.map(value => [value.sequence, value]));
  if (protocol.foundation.length !== 128 || receipts.length !== 256)
    throw new Error(`attempt-018-cardinality:${protocol.foundation.length}:${receipts.length}`);
  const reconstructed: RealEvent[] = [];
  const scorerArms: string[] = [];
  for (let index = 0; index < protocol.foundation.length; index += 1) {
    const specification = protocol.foundation[index]!;
    for (let part = 0; part < 2; part += 1) {
      const receipt = receipts[index * 2 + part]!;
      const cue = part === 0 ? specification.chain.actionCue : specification.chain.verificationCue;
      if (!sameAction(cue, receipt))
        throw new Error(`attempt-018-action-plan-mismatch:${index}:${part}`);
      const window: Observation[] = [];
      for (let sequence = receipt.startSequence; sequence <= receipt.endSequence; sequence += 1) {
        const frame = bySequence.get(sequence);
        if (!frame) throw new Error(`attempt-018-frame-gap:${sequence}`);
        window.push(frame);
      }
      reconstructed.push({
        version: 'RealEventV5',
        id: `attempt-018-public-event-${String(index * 2 + part + 1).padStart(3, '0')}`,
        cue: structuredClone(cue),
        frames: window,
        trackedIds: trackedIds(window, receipt),
        bodyResult: structuredClone(receipt),
        provenance: 'executed-real-body',
        complete: true,
      });
      scorerArms.push(specification.arm);
    }
  }
  return { events: reconstructed, scorerArms, sourceFrameCount: frames.length };
}
