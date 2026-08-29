import type { Action, ActionCue, Observation, PublicChange, PublicValue, RealEvent } from './contracts.js';
import { assert, canonical, sha } from './util.js';

export type FeatureRow = Readonly<Record<string, number>>;
export interface EventRows { readonly rows: readonly FeatureRow[]; readonly changes: readonly (readonly PublicChange[])[];
  readonly roles: Readonly<Record<string, string>>; }

export function cueFor(action: Action, observation: Observation): ActionCue {
  const target = observation.objects.find(object => object.id === action.targetId);
  return { kind: action.kind, parameters: { ...action.parameters }, targetRole: target?.type ?? null };
}
export function validateEvent(event: RealEvent): void {
  assert(event.version === 'RealEventV5' && event.complete && event.frames.length >= 2, 'incomplete-real-event');
  assert(event.provenance === 'executed-real-body' || event.provenance === 'observed-passive', 'non-real-event');
  if (event.provenance === 'executed-real-body') assert(event.bodyResult?.executed && event.bodyResult.status === 'completed', 'unexecuted-event');
  for (let i = 1; i < event.frames.length; i++) {
    assert(event.frames[i]!.sequence === event.frames[i - 1]!.sequence + 1, 'event-observation-gap');
    assert(event.frames[i]!.activeSeconds > event.frames[i - 1]!.activeSeconds, 'event-time-not-increasing');
  }
}
function put(row: Record<string, number>, key: string, value: PublicValue): void {
  if (typeof value === 'number') { assert(Number.isFinite(value), 'non-finite-public-value'); row[key] = value; }
  else row[`${key}=${canonical(value)}`] = 1;
}
export function relativePublicFeatures(observation: Observation): FeatureRow {
  const row: Record<string, number> = {};
  for (const [property, value] of Object.entries(observation.self.properties)) put(row, `self/${property}`, value);
  const ordered = [...observation.objects].sort((a, b) => a.type.localeCompare(b.type)
    || Math.hypot(...a.relativePosition) - Math.hypot(...b.relativePosition));
  const counts = new Map<string, number>();
  for (const object of ordered) {
    const ordinal = counts.get(object.type) ?? 0; counts.set(object.type, ordinal + 1);
    const prefix = `visible/${object.type}/${ordinal}`;
    row[`${prefix}/present`] = 1;
    object.relativePosition.forEach((value, axis) => { row[`${prefix}/relative/${axis}`] = value; });
    for (const [property, value] of Object.entries(object.properties)) put(row, `${prefix}/${property}`, value);
  }
  return row;
}
export function eventRows(event: RealEvent): EventRows {
  validateEvent(event);
  const first = event.frames[0]!;
  const roles: Record<string, string> = { self: 'self' };
  const counts = new Map<string, number>();
  for (const id of event.trackedIds) {
    if (id === 'self') continue;
    const object = first.objects.find(value => value.id === id) ?? event.frames.flatMap(frame => frame.objects).find(value => value.id === id);
    if (!object) continue;
    const n = counts.get(object.type) ?? 0; counts.set(object.type, n + 1);
    roles[id] = `${object.type}#${n}`;
  }
  const values = (frame: Observation): Record<string, Record<string, PublicValue>> => {
    const result: Record<string, Record<string, PublicValue>> = {};
    if (event.trackedIds.includes('self')) result.self = {
      ...frame.self.properties, yaw: frame.self.yaw - first.self.yaw, pitch: frame.self.pitch - first.self.pitch,
      ...Object.fromEntries(frame.self.position.map((p, i) => [`displacement.${i}`, p - first.self.position[i]!]))
    };
    for (const object of frame.objects) {
      const role = roles[object.id]; if (!role) continue;
      const origin = first.objects.find(candidate => candidate.id === object.id);
      result[role] = { ...object.properties, visible: true };
      if (origin) for (let i = 0; i < 3; i++) result[role]![`displacement.${i}`] =
        frame.self.position[i]! - first.self.position[i]! + object.relativePosition[i]! - origin.relativePosition[i]!;
    }
    for (const [id, role] of Object.entries(roles)) if (id !== 'self' && !result[role]) result[role] = { visible: false };
    return result;
  };
  const initial = values(first); let previous = initial;
  const changes: PublicChange[][] = [];
  const rows = event.frames.map((frame, observationIndex) => {
    const row: Record<string, number> = { 'event/elapsed': Math.log1p(frame.activeSeconds - first.activeSeconds) };
    put(row, 'cue/kind', event.cue.kind); put(row, 'cue/target', event.cue.targetRole);
    for (const [key, value] of Object.entries(event.cue.parameters)) put(row, `cue/${key}`, value);
    const current = values(frame); const changed: PublicChange[] = [];
    for (const [subject, properties] of Object.entries(current)) {
      for (const [property, after] of Object.entries(properties)) {
        const before = previous[subject]?.[property];
        put(row, `${subject}/${property}`, after);
        if (before !== undefined && before !== after) changed.push({ subject, property, before, after,
          observationIndex, meaning: 'observed-co-occurrence' });
      }
    }
    previous = current; changes.push(changed); return row;
  });
  // No-world-change is a fact about the *completed* observed window, never an eternal outcome.
  if (changes.every(row => row.length === 0)) changes[changes.length - 1]!.push({ subject: 'event',
    property: 'change-within-observed-window', before: false, after: false,
    observationIndex: changes.length - 1, meaning: 'observed-co-occurrence' });
  return { rows, changes, roles };
}
export const cueIdentity = (cue: ActionCue): string => sha(cue);
