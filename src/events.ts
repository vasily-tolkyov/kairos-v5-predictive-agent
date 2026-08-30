import type { Action, ActionCue, Observation, PublicChange, PublicValue, RealEvent } from './contracts.js';
import { assert, canonical, sha } from './util.js';

export type FeatureRow = Readonly<Record<string, number>>;
export interface EventRows { readonly rows: readonly FeatureRow[]; readonly changes: readonly (readonly PublicChange[])[];
  readonly roles: Readonly<Record<string, string>>; }
export const R2_EVENT_MEASUREMENT_ADAPTER_V1 = 'R2EventMeasurementAdapterV1' as const;
export const R2_EVENT_MEASUREMENT_ADAPTER_V2 = 'R2EventMeasurementAdapterV2' as const;

export function cueFor(action: Action, observation: Observation): ActionCue {
  const target = observation.objects.find(object => object.id === action.targetId);
  return { kind: action.kind, parameters: { ...action.parameters }, targetRole: target?.type ?? null };
}
export function validateEvent(event: RealEvent): void {
  assert(event.version === 'RealEventV5' && event.complete && event.frames.length >= 2, 'incomplete-real-event');
  assert(event.provenance === 'executed-real-body' || event.provenance === 'observed-passive', 'non-real-event');
  if (event.provenance === 'executed-real-body') {
    assert(event.bodyResult?.executed && event.bodyResult.status === 'completed', 'unexecuted-event');
    const action = event.bodyResult.action, first = event.frames[0]!;
    if (event.cue.kind === 'interact' || action.kind === 'interact') {
      assert(event.cue.kind === 'interact' && action.kind === 'interact'
        && action.targetId !== undefined && action.targetId !== null
        && first.targetId === action.targetId
        && first.objects.some(object => object.id === action.targetId)
        && event.trackedIds.includes(action.targetId), 'invalid-interact-event-precondition');
    }
    assert(canonical(event.cue) === canonical(cueFor(action, first)), 'event-cue-does-not-match-body-action');
  }
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
  // R2A describes conditions in the observer's current perceptual frame.  A
  // world-axis displacement plus a separately stored yaw makes the same
  // visible relation look unrelated after the body rotates.  Rotate public
  // displacements into the camera's forward/right/up basis instead.  This is
  // a coordinate change over already-public values; it neither uses a world
  // position as an R1 coordinate nor adds a semantic affordance rule.
  row['self/pitch'] = observation.self.pitch;
  const bucket15Degrees = (radians: number): string => String(Math.round(radians / (Math.PI / 12)));
  put(row, 'self/pitch-15deg-bucket', bucket15Degrees(observation.self.pitch));
  const egocentric = (relative: readonly number[]): readonly [number, number, number] => {
    const [x, y, z] = relative;
    const yaw = observation.self.yaw, pitch = observation.self.pitch;
    const forward: readonly [number, number, number] = [
      -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
    ];
    const right: readonly [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up: readonly [number, number, number] = [
      Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch),
    ];
    const dot = (axis: readonly number[]) => {
      const value = x! * axis[0]! + y! * axis[1]! + z! * axis[2]!;
      // Trigonometric round-off is not a perceived condition.
      return Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(12));
    };
    return [dot(forward), dot(right), dot(up)];
  };
  const crosshairTarget = observation.objects.find(object => object.id === observation.targetId);
  put(row, 'crosshair/present', crosshairTarget !== undefined);
  put(row, 'crosshair/target-type', crosshairTarget?.type ?? null);
  if (crosshairTarget) egocentric(crosshairTarget.relativePosition).forEach((value, axis) => {
    row[`crosshair/egocentric/${['forward', 'right', 'up'][axis]}`] = value;
  });
  const ordered = [...observation.objects].sort((a, b) => a.type.localeCompare(b.type)
    || Math.hypot(...a.relativePosition) - Math.hypot(...b.relativePosition));
  const counts = new Map<string, number>();
  for (const object of ordered) {
    const ordinal = counts.get(object.type) ?? 0; counts.set(object.type, ordinal + 1);
    const prefix = `visible/${object.type}/${ordinal}`;
    row[`${prefix}/present`] = 1;
    egocentric(object.relativePosition).forEach((value, axis) => {
      row[`${prefix}/egocentric/${['forward', 'right', 'up'][axis]}`] = value;
    });
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
    const crosshairTarget = frame.objects.find(object => object.id === frame.targetId);
    result.crosshair = { visible: crosshairTarget !== undefined, type: crosshairTarget?.type ?? null };
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
  const frameValues = event.frames.map(values);
  const initial = frameValues[0]!; let previous = initial;
  const changes: PublicChange[][] = [];
  for (let observationIndex = 0; observationIndex < frameValues.length; observationIndex++) {
    const current = frameValues[observationIndex]!; const changed: PublicChange[] = [];
    for (const [subject, properties] of Object.entries(current)) {
      for (const [property, after] of Object.entries(properties)) {
        const before = previous[subject]?.[property];
        if (before !== undefined && before !== after) changed.push({ subject, property, before, after,
          observationIndex, meaning: 'observed-co-occurrence' });
      }
    }
    previous = current; changes.push(changed);
  }
  // No-world-change is a fact about the *completed* observed window, never an eternal outcome.
  if (changes.every(row => row.length === 0)) changes[changes.length - 1]!.push({ subject: 'event',
    property: 'change-within-observed-window', before: false, after: false,
    observationIndex: changes.length - 1, meaning: 'observed-co-occurrence' });
  // R1/R2 measure an action-anchored event's public dynamics. The initiating
  // cue identifies which subjective action this result belongs to; repeating
  // the complete static scene would instead make the path metric depend on
  // preconditions that belong to R2A and allowed no-change observations to
  // bridge unrelated result basins. Keep only the exact action cue, event
  // progress and cumulative public transitions that have actually occurred.
  const cumulative = new Map<string, { subject: string; property: string;
    before: PublicValue; after: PublicValue }>();
  const rows = event.frames.map((frame, observationIndex) => {
    const row: Record<string, number> = { 'event/elapsed': Math.log1p(frame.activeSeconds - first.activeSeconds) };
    put(row, 'cue/kind', event.cue.kind); put(row, 'cue/target', event.cue.targetRole);
    for (const [key, value] of Object.entries(event.cue.parameters)) put(row, `cue/${key}`, value);
    for (const change of changes[observationIndex]!) {
      const key = `${change.subject}/${change.property}`, earlier = cumulative.get(key);
      cumulative.set(key, { subject: change.subject, property: change.property,
        before: earlier?.before ?? change.before, after: change.after });
    }
    for (const transition of [...cumulative.values()].sort((left, right) =>
      `${left.subject}/${left.property}`.localeCompare(`${right.subject}/${right.property}`))) {
      const prefix = `change/${transition.subject}/${transition.property}`;
      row[`${prefix}/observed`] = 1;
      put(row, `${prefix}/before`, transition.before); put(row, `${prefix}/after`, transition.after);
      if (typeof transition.before === 'number' && typeof transition.after === 'number') {
        row[`${prefix}/delta`] = transition.after - transition.before;
      }
    }
    if (observationIndex === event.frames.length - 1
      && changes.flat().every(change => change.subject === 'event'
        && change.property === 'change-within-observed-window')) {
      row['event/no-public-change-within-window'] = 1;
    }
    return row;
  });
  return { rows, changes, roles };
}
export const cueIdentity = (cue: ActionCue): string => sha(cue);
