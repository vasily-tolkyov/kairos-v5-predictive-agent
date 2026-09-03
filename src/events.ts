import type { Action, ActionCue, Observation, PublicChange, PublicObject, PublicValue, RealEvent,
  RealEventContinuityEvidenceV1, RealEventHierarchyContinuityV1 } from './contracts.js';
import type { ActionObservationScopeV1 } from './control/contracts.js';
import { assert, canonical, sha } from './util.js';

export type FeatureRow = Readonly<Record<string, number>>;
export interface EventLocalPublicRoleBindingV1 {
  readonly version: 'EventLocalPublicRoleBindingV1';
  readonly role: string;
  readonly type: string;
  readonly directActionTarget: boolean;
  /** Public object properties which remained present and unchanged throughout
   * the complete real event. IDs and spatial values never enter this record. */
  readonly stableProperties: Readonly<Record<string, PublicValue>>;
}
export interface EventLocalCurrentPublicValueV1 {
  readonly subjectRole: string;
  readonly property: string;
  readonly value: PublicValue;
}
export interface EventLocalCurrentPublicStateV1 {
  readonly version: 'EventLocalCurrentPublicStateV1';
  readonly values: readonly EventLocalCurrentPublicValueV1[];
  readonly unresolvedRoles: readonly string[];
}
export interface EventLocalDecodedPublicFeaturesV1 {
  readonly version: 'EventLocalDecodedPublicFeaturesV1';
  /** Only channels explicitly decoded at a prediction terminal are present. */
  readonly features: FeatureRow;
  readonly mappedValueCount: number;
  readonly unresolvedChannels: readonly string[];
}
export interface EventRows { readonly rows: readonly FeatureRow[]; readonly changes: readonly (readonly PublicChange[])[];
  /** Event-local, self-centred changes used only by the physical
   * representation and its topology compatibility guard.  `changes` keeps
   * the original public/world observables for grounded goals and readout. */
  readonly measurementChanges: readonly (readonly PublicChange[])[];
  /**
   * Complete public states of the explicitly tracked event subjects in the
   * same event-local frame as `measurementChanges`.  This is deliberately not
   * the whole visible scene: it contains only self plus the real action,
   * goal, or attention scope already frozen into `trackedIds`.  Keeping the
   * observed terminal value lets a bounded no-effect result remain distinct
   * when some other scoped property changed during the same action window.
   */
  readonly measurementStates: readonly Readonly<Record<string,
    Readonly<Record<string, PublicValue>>>>[];
  readonly roles: Readonly<Record<string, string>>;
  readonly roleBindings: readonly EventLocalPublicRoleBindingV1[]; }
export const R2_EVENT_MEASUREMENT_ADAPTER_V1 = 'R2EventMeasurementAdapterV1' as const;
export const R2_EVENT_MEASUREMENT_ADAPTER_V2 = 'R2EventMeasurementAdapterV2' as const;

/** Build the subjects of one real action window without adding hidden state. */
export function actionObservationTrackedIdsV1(actionTargetId: string | undefined,
  scope: ActionObservationScopeV1 | undefined, attendedSubjectIds: readonly string[],
  frames: readonly Observation[]): readonly string[] {
  const publiclyObserved = new Set(frames.flatMap(frame => frame.objects.map(object => object.id)));
  const candidates = [actionTargetId, ...(scope?.referencedPublicObjectIds ?? []), ...attendedSubjectIds]
    .filter((id): id is string => typeof id === 'string' && id !== 'self' && publiclyObserved.has(id));
  return ['self', ...new Set(candidates)];
}

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

function horizontalEgocentricComponentsV1(vector: readonly number[], yaw: number):
readonly [number, number, number] {
  const [x, y, z] = vector;
  const forward: readonly [number, number, number] = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const right: readonly [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const clean = (value: number): number => Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(12));
  const dot = (axis: readonly number[]) => clean(x! * axis[0]! + y! * axis[1]! + z! * axis[2]!);
  return [dot(forward), dot(right), clean(y!)];
}

function egocentricFacingV1(value: string, yaw: number): string {
  if (value === 'up' || value === 'down') return value;
  const vector = value === 'north' ? [0, -1] : value === 'south' ? [0, 1]
    : value === 'east' ? [1, 0] : value === 'west' ? [-1, 0] : null;
  if (!vector) return value;
  const forward = vector[0]! * -Math.sin(yaw) + vector[1]! * -Math.cos(yaw);
  const right = vector[0]! * Math.cos(yaw) + vector[1]! * -Math.sin(yaw);
  return Math.abs(forward) >= Math.abs(right)
    ? forward >= 0 ? 'forward' : 'back'
    : right >= 0 ? 'right' : 'left';
}

function egocentricAxisV1(value: string, yaw: number): string {
  if (value === 'y') return 'up';
  const vector = value === 'x' ? [1, 0] : value === 'z' ? [0, 1] : null;
  if (!vector) return value;
  const forward = Math.abs(vector[0]! * -Math.sin(yaw) + vector[1]! * -Math.cos(yaw));
  const right = Math.abs(vector[0]! * Math.cos(yaw) + vector[1]! * -Math.sin(yaw));
  return forward >= right ? 'forward' : 'right';
}

function publicPropertiesInEgocentricFrameV1(properties: Readonly<Record<string, PublicValue>>,
  referenceYaw: number): Record<string, PublicValue> {
  const result: Record<string, PublicValue> = {};
  for (const [property, value] of Object.entries(properties)) {
    if (['velocityX', 'velocityY', 'velocityZ'].includes(property)) continue;
    if (property === 'facing' && typeof value === 'string') result[property] = egocentricFacingV1(value, referenceYaw);
    else if (property === 'axis' && typeof value === 'string') result[property] = egocentricAxisV1(value, referenceYaw);
    else result[property] = value;
  }
  const velocity = ['velocityX', 'velocityY', 'velocityZ'].map(property =>
    properties[property]);
  if (velocity.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
    const local = horizontalEgocentricComponentsV1(velocity, referenceYaw);
    result['velocity.forward'] = local[0]; result['velocity.right'] = local[1]; result['velocity.up'] = local[2];
  }
  return result;
}

function publicBodyPropertiesInEgocentricFrameV1(observation: Observation): Record<string, PublicValue> {
  return publicPropertiesInEgocentricFrameV1(observation.self.properties, observation.self.yaw);
}

function resolveEventLocalPublicRolesV1(observation: Observation,
  roleBindings: readonly EventLocalPublicRoleBindingV1[]): {
    readonly byRole: ReadonlyMap<string, PublicObject>;
    readonly unresolvedRoles: readonly string[];
  } {
  const byRole = new Map<string, PublicObject>();
  const unresolvedRoles: string[] = [];
  const usedIds = new Set<string>();
  for (const binding of [...roleBindings].sort((left, right) => left.role.localeCompare(right.role, 'en'))) {
    const satisfiesBinding = (object: PublicObject): boolean => object.type === binding.type
      && !usedIds.has(object.id)
      && Object.entries(binding.stableProperties).every(([property, expected]) =>
        Object.prototype.hasOwnProperty.call(object.properties, property)
        && Object.is(object.properties[property], expected));
    const currentTarget = binding.directActionTarget
      ? observation.objects.find(object => object.id === observation.targetId) : undefined;
    const matches = currentTarget && satisfiesBinding(currentTarget) ? [currentTarget]
      : binding.directActionTarget ? [] : observation.objects.filter(satisfiesBinding);
    if (matches.length !== 1) { unresolvedRoles.push(binding.role); continue; }
    byRole.set(binding.role, matches[0]!); usedIds.add(matches[0]!.id);
  }
  return { byRole, unresolvedRoles: [...new Set(unresolvedRoles)].sort((left, right) =>
    left.localeCompare(right, 'en')) };
}

function perceptualEgocentricComponentsV1(relative: readonly number[], yaw: number, pitch: number):
readonly [number, number, number] {
  const [x, y, z] = relative;
  const forward: readonly [number, number, number] = [
    -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
  ];
  const right: readonly [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up: readonly [number, number, number] = [
    Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch),
  ];
  const dot = (axis: readonly number[]) => {
    const value = x! * axis[0]! + y! * axis[1]! + z! * axis[2]!;
    return Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(12));
  };
  return [dot(forward), dot(right), dot(up)];
}

function orderedPublicObjectsV1(observation: Observation): readonly PublicObject[] {
  return [...observation.objects].sort((a, b) => {
    const type = a.type.localeCompare(b.type);
    if (type !== 0) return type;
    const distance = Math.hypot(...a.relativePosition) - Math.hypot(...b.relativePosition);
    if (Math.abs(distance) > 1e-12) return distance;
    const left = perceptualEgocentricComponentsV1(a.relativePosition,
      observation.self.yaw, observation.self.pitch);
    const right = perceptualEgocentricComponentsV1(b.relativePosition,
      observation.self.yaw, observation.self.pitch);
    for (let axis = 0; axis < left.length; axis++) {
      const difference = left[axis]! - right[axis]!;
      if (difference !== 0) return difference;
    }
    return 0;
  });
}

/**
 * Re-express one current public observation in the same event-local channels
 * used by the R1 afferent projection.  It is a pure lookup preparation step:
 * it neither allocates an afferent binding nor guesses between ambiguous
 * public objects.  Positions are used only to expose already-public relative
 * distance; no world coordinate becomes a physical-medium coordinate.
 */
export function eventLocalCurrentPublicStateV1(observation: Observation,
  roleBindings: readonly EventLocalPublicRoleBindingV1[]): EventLocalCurrentPublicStateV1 {
  const { byRole, unresolvedRoles } = resolveEventLocalPublicRolesV1(observation, roleBindings);

  const values: EventLocalCurrentPublicValueV1[] = [];
  const append = (subjectRole: string, properties: Readonly<Record<string, PublicValue>>): void => {
    for (const [property, value] of Object.entries(properties).sort(([left], [right]) =>
      left.localeCompare(right, 'en'))) values.push({ subjectRole, property, value });
  };
  const crosshair = observation.objects.find(object => object.id === observation.targetId);
  const crosshairBound = crosshair && [...byRole.values()].some(object => object.id === crosshair.id);
  append('crosshair', { visible: crosshair !== undefined, type: crosshairBound ? crosshair!.type : null });
  append('self', { ...publicBodyPropertiesInEgocentricFrameV1(observation), yaw: 0, pitch: 0,
    'displacement.forward': 0, 'displacement.right': 0, 'displacement.up': 0 });
  for (const binding of roleBindings) {
    const object = byRole.get(binding.role);
    if (!object) { append(binding.role, { visible: false }); continue; }
    append(binding.role, { ...publicPropertiesInEgocentricFrameV1(object.properties, observation.self.yaw),
      visible: true, relativeDistance: Math.hypot(...object.relativePosition),
      'displacement.forward': 0, 'displacement.right': 0, 'displacement.up': 0 });
  }
  return { version: 'EventLocalCurrentPublicStateV1', values,
    unresolvedRoles };
}

/**
 * Translate only terminal values which the physical R1 clone actually
 * decoded into the public R3 channel vocabulary.  This deliberately does not
 * start from `relativePublicFeatures(observation)`: a current property which
 * was not decoded at the terminal is unknown, not an implied invariant.
 */
export function eventLocalDecodedPublicFeaturesV1(observation: Observation,
  roleBindings: readonly EventLocalPublicRoleBindingV1[],
  decodedValues: readonly EventLocalCurrentPublicValueV1[]): EventLocalDecodedPublicFeaturesV1 {
  const row: Record<string, number> = {};
  const unresolved = new Set<string>();
  const mapped = new Set<string>();
  const { byRole, unresolvedRoles } = resolveEventLocalPublicRolesV1(observation, roleBindings);
  unresolvedRoles.forEach(role => unresolved.add(`role-unresolved:${role}`));

  const decodedYaw = decodedValues.find(value => value.subjectRole === 'self'
    && value.property === 'yaw' && typeof value.value === 'number')?.value;
  const decodedPitch = decodedValues.find(value => value.subjectRole === 'self'
    && value.property === 'pitch' && typeof value.value === 'number')?.value;
  const predictedObserver = { ...observation, self: { ...observation.self,
    yaw: observation.self.yaw + (typeof decodedYaw === 'number' ? decodedYaw : 0),
    pitch: observation.self.pitch + (typeof decodedPitch === 'number' ? decodedPitch : 0) } };
  const prefixes = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const object of orderedPublicObjectsV1(predictedObserver)) {
    const ordinal = counts.get(object.type) ?? 0;
    counts.set(object.type, ordinal + 1);
    prefixes.set(object.id, `visible/${object.type}/${ordinal}`);
  }
  const mapValue = (source: string, key: string, value: PublicValue): void => {
    put(row, key, value); mapped.add(source);
  };
  const ordered = [...decodedValues].sort((left, right) =>
    `${left.subjectRole}/${left.property}`.localeCompare(`${right.subjectRole}/${right.property}`, 'en'));
  const observerRelativeProperties = new Set(['facing', 'axis',
    'velocity.forward', 'velocity.right', 'velocity.up']);
  for (const value of ordered) {
    const source = `${value.subjectRole}/${value.property}`;
    if (value.subjectRole === 'self') {
      if (value.property === 'pitch') {
        if (typeof value.value !== 'number') { unresolved.add(`value-not-numeric:${source}`); continue; }
        const predictedPitch = observation.self.pitch + value.value;
        mapValue(source, 'self/pitch', predictedPitch);
        put(row, 'self/pitch-15deg-bucket', String(Math.round(predictedPitch / (Math.PI / 12))));
        continue;
      }
      if (value.property === 'yaw' || value.property.startsWith('displacement.')) {
        unresolved.add(`not-a-current-R3-channel:${source}`); continue;
      }
      if (observerRelativeProperties.has(value.property)
        && (typeof decodedYaw !== 'number' || Math.abs(decodedYaw) > 1e-12)) {
        unresolved.add(`observer-frame-not-decodable:${source}`); continue;
      }
      mapValue(source, `self/${value.property}`, value.value); continue;
    }
    if (value.subjectRole === 'crosshair') {
      if (value.property === 'visible') mapValue(source, 'crosshair/present', value.value);
      else if (value.property === 'type') mapValue(source, 'crosshair/target-type', value.value);
      else unresolved.add(`not-a-current-R3-channel:${source}`);
      continue;
    }
    if (value.subjectRole === 'event') {
      unresolved.add(`not-a-current-R3-channel:${source}`); continue;
    }
    const object = byRole.get(value.subjectRole);
    const prefix = object ? prefixes.get(object.id) : undefined;
    if (!object || !prefix) { unresolved.add(`role-unresolved:${value.subjectRole}`); continue; }
    if (value.property.startsWith('displacement.')) {
      unresolved.add(`not-a-current-R3-channel:${source}`); continue;
    }
    if (observerRelativeProperties.has(value.property)
      && (typeof decodedYaw !== 'number' || Math.abs(decodedYaw) > 1e-12)) {
      unresolved.add(`observer-frame-not-decodable:${source}`); continue;
    }
    const property = value.property === 'visible' ? 'present'
      : value.property === 'facing' ? 'facing-egocentric'
      : value.property === 'axis' ? 'axis-egocentric' : value.property;
    mapValue(source, `${prefix}/${property}`, value.value);
  }
  return { version: 'EventLocalDecodedPublicFeaturesV1', features: row,
    mappedValueCount: mapped.size,
    unresolvedChannels: [...unresolved].sort((left, right) => left.localeCompare(right, 'en')) };
}

export function relativePublicFeatures(observation: Observation): FeatureRow {
  const row: Record<string, number> = {};
  for (const [property, value] of Object.entries(publicBodyPropertiesInEgocentricFrameV1(observation)))
    put(row, `self/${property}`, value);
  // R2A describes conditions in the observer's current perceptual frame.  A
  // world-axis displacement plus a separately stored yaw makes the same
  // visible relation look unrelated after the body rotates.  Rotate public
  // displacements into the camera's forward/right/up basis instead.  This is
  // a coordinate change over already-public values; it neither uses a world
  // position as an R1 coordinate nor adds a semantic affordance rule.
  row['self/pitch'] = observation.self.pitch;
  const bucket15Degrees = (radians: number): string => String(Math.round(radians / (Math.PI / 12)));
  put(row, 'self/pitch-15deg-bucket', bucket15Degrees(observation.self.pitch));
  const egocentric = (relative: readonly number[]): readonly [number, number, number] =>
    perceptualEgocentricComponentsV1(relative, observation.self.yaw, observation.self.pitch);
  const crosshairTarget = observation.objects.find(object => object.id === observation.targetId);
  put(row, 'crosshair/present', crosshairTarget !== undefined);
  put(row, 'crosshair/target-type', crosshairTarget?.type ?? null);
  if (crosshairTarget) {
    row['crosshair/relativeDistance'] = Math.hypot(...crosshairTarget.relativePosition);
    egocentric(crosshairTarget.relativePosition).forEach((value, axis) => {
      row[`crosshair/egocentric/${['forward', 'right', 'up'][axis]}`] = value;
    });
  }
  // Equal-distance objects were previously left in bridge arrival order. That
  // order is not a public spatial fact and changes across rotated layouts,
  // causing an ordinal such as smooth_stone/0 to name a different visible
  // relation. Resolve ties in the same egocentric coordinates exposed below;
  // absolute world coordinates and instance ids remain excluded.
  const ordered = orderedPublicObjectsV1(observation);
  const counts = new Map<string, number>();
  for (const object of ordered) {
    const ordinal = counts.get(object.type) ?? 0; counts.set(object.type, ordinal + 1);
    const prefix = `visible/${object.type}/${ordinal}`;
    row[`${prefix}/present`] = 1;
    row[`${prefix}/relativeDistance`] = Math.hypot(...object.relativePosition);
    egocentric(object.relativePosition).forEach((value, axis) => {
      row[`${prefix}/egocentric/${['forward', 'right', 'up'][axis]}`] = value;
    });
    for (const [property, value] of Object.entries(object.properties)) {
      if (property === 'facing' && typeof value === 'string')
        put(row, `${prefix}/facing-egocentric`, egocentricFacingV1(value, observation.self.yaw));
      else if (property === 'axis' && typeof value === 'string')
        put(row, `${prefix}/axis-egocentric`, egocentricAxisV1(value, observation.self.yaw));
      else put(row, `${prefix}/${property}`, value);
    }
  }
  return row;
}
export function eventRows(event: RealEvent): EventRows {
  validateEvent(event);
  const first = event.frames[0]!;
  const roles: Record<string, string> = { self: 'self' };
  const counts = new Map<string, number>();
  const directTargetId = event.bodyResult?.action.targetId;
  const trackedObjects = event.trackedIds.filter(id => id !== 'self').flatMap(id => {
    const object = first.objects.find(value => value.id === id)
      ?? event.frames.flatMap(frame => frame.objects).find(value => value.id === id);
    if (!object) return [];
    const local = horizontalEgocentricComponentsV1(object.relativePosition, first.self.yaw);
    const priority = id === directTargetId ? 0 : 1;
    const key = canonical({ type: object.type, relativeDistance: Math.hypot(...object.relativePosition), local,
      properties: publicPropertiesInEgocentricFrameV1(object.properties, first.self.yaw) });
    return [{ id, object, key, priority }];
  }).sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key, 'en'));
  for (let index = 1; index < trackedObjects.length; index++) {
    assert(trackedObjects[index - 1]!.priority !== trackedObjects[index]!.priority
      || trackedObjects[index - 1]!.key !== trackedObjects[index]!.key,
      'event-local-public-role-ambiguous');
  }
  for (const { id, object } of trackedObjects) {
    const n = counts.get(object.type) ?? 0; counts.set(object.type, n + 1);
    roles[id] = `${object.type}#${n}`;
  }
  const values = (frame: Observation, eventLocal: boolean): Record<string, Record<string, PublicValue>> => {
    const result: Record<string, Record<string, PublicValue>> = {};
    const crosshairTarget = frame.objects.find(object => object.id === frame.targetId);
    // The public ledger keeps the exact type of every real crosshair hit.  The
    // physical event measurement, however, may bind a concrete type only when
    // that object belongs to this event's explicit observation scope.  A
    // coincidental hit on an untracked background block is represented as
    // "some public target" rather than expanding the frozen R1 vocabulary.
    // `visible` keeps it distinct from no hit, while `changes` below remains
    // lossless for grounded readout and audit.
    const measuredCrosshairType = crosshairTarget && roles[crosshairTarget.id]
      ? crosshairTarget.type : null;
    result.crosshair = { visible: crosshairTarget !== undefined,
      type: eventLocal ? measuredCrosshairType : crosshairTarget?.type ?? null };
    if (event.trackedIds.includes('self')) {
      const displacement = frame.self.position.map((p, i) => p - first.self.position[i]!);
      const localDisplacement = horizontalEgocentricComponentsV1(displacement, first.self.yaw);
      result.self = eventLocal ? {
        ...publicPropertiesInEgocentricFrameV1(frame.self.properties, first.self.yaw),
        yaw: Math.atan2(Math.sin(frame.self.yaw - first.self.yaw), Math.cos(frame.self.yaw - first.self.yaw)),
        pitch: frame.self.pitch - first.self.pitch,
        'displacement.forward': localDisplacement[0],
        'displacement.right': localDisplacement[1],
        'displacement.up': localDisplacement[2],
      } : {
        ...frame.self.properties, yaw: frame.self.yaw - first.self.yaw, pitch: frame.self.pitch - first.self.pitch,
        ...Object.fromEntries(displacement.map((value, index) => [`displacement.${index}`, value])),
      };
    }
    for (const object of frame.objects) {
      const role = roles[object.id]; if (!role) continue;
      const origin = first.objects.find(candidate => candidate.id === object.id);
      result[role] = { ...(eventLocal
        ? publicPropertiesInEgocentricFrameV1(object.properties, first.self.yaw)
        : object.properties), visible: true,
        relativeDistance: Math.hypot(...object.relativePosition) };
      if (origin) {
        const displacement = frame.self.position.map((position, index) => position - first.self.position[index]!
          + object.relativePosition[index]! - origin.relativePosition[index]!);
        if (eventLocal) {
          const local = horizontalEgocentricComponentsV1(displacement, first.self.yaw);
          result[role]!['displacement.forward'] = local[0];
          result[role]!['displacement.right'] = local[1];
          result[role]!['displacement.up'] = local[2];
        } else for (let index = 0; index < 3; index++)
          result[role]![`displacement.${index}`] = displacement[index]!;
      }
    }
    for (const [id, role] of Object.entries(roles)) if (id !== 'self' && !result[role]) result[role] = { visible: false };
    return result;
  };
  const changesFrom = (frameValues: readonly Record<string, Record<string, PublicValue>>[]): PublicChange[][] => {
    let previous = frameValues[0]!;
    const result: PublicChange[][] = [];
    for (let observationIndex = 0; observationIndex < frameValues.length; observationIndex++) {
      const current = frameValues[observationIndex]!; const changed: PublicChange[] = [];
    for (const [subject, properties] of Object.entries(current)) {
      for (const [property, after] of Object.entries(properties)) {
        const before = previous[subject]?.[property];
        if (before !== undefined && before !== after) changed.push({ subject, property, before, after,
          observationIndex, meaning: 'observed-co-occurrence' });
      }
    }
      previous = current; result.push(changed);
    }
    return result;
  };
  const changes = changesFrom(event.frames.map(frame => values(frame, false)));
  const measurementStates = event.frames.map(frame => values(frame, true));
  const measurementChanges = changesFrom(measurementStates);
  const roleBindings: EventLocalPublicRoleBindingV1[] = trackedObjects.map(({ id, object }) => {
    const observed = event.frames.map(frame => frame.objects.find(value => value.id === id));
    assert(observed.every(value => value === undefined || value.type === object.type),
      'event-local-public-role-type-changed');
    const stableProperties = Object.fromEntries(Object.keys(object.properties).sort().flatMap(property => {
      const expected = object.properties[property];
      return observed.length === event.frames.length
        && observed.every(value => value !== undefined
          && Object.prototype.hasOwnProperty.call(value.properties, property)
          && Object.is(value.properties[property], expected))
        ? [[property, expected!]] : [];
    })) as Readonly<Record<string, PublicValue>>;
    return { version: 'EventLocalPublicRoleBindingV1', role: roles[id]!, type: object.type,
      directActionTarget: id === directTargetId, stableProperties } satisfies EventLocalPublicRoleBindingV1;
  }).sort((left, right) => left.role.localeCompare(right.role, 'en'));
  // No-world-change is a fact about the *completed* observed window, never an eternal outcome.
  if (changes.every(row => row.length === 0)) changes[changes.length - 1]!.push({ subject: 'event',
    property: 'change-within-observed-window', before: false, after: false,
    observationIndex: changes.length - 1, meaning: 'observed-co-occurrence' });
  if (measurementChanges.every(row => row.length === 0)) measurementChanges[measurementChanges.length - 1]!.push({
    subject: 'event', property: 'change-within-observed-window', before: false, after: false,
    observationIndex: measurementChanges.length - 1, meaning: 'observed-co-occurrence' });
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
    for (const change of measurementChanges[observationIndex]!) {
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
      && measurementChanges.flat().every(change => change.subject === 'event'
        && change.property === 'change-within-observed-window')) {
      row['event/no-public-change-within-window'] = 1;
    }
    return row;
  });
  return { rows, changes, measurementChanges, measurementStates, roles, roleBindings };
}
export const cueIdentity = (cue: ActionCue): string => sha(cue);

export const PUBLIC_TRANSITION_TOPOLOGY_VERSION_V1 = 'PublicTransitionTopologyV1' as const;

export interface PublicTransitionTopologyV1 {
  readonly version: typeof PUBLIC_TRANSITION_TOPOLOGY_VERSION_V1;
  readonly source: 'closed-public-R1-event-transitions';
  readonly transitions: readonly {
    readonly subjectRole: string;
    readonly property: string;
    readonly before: PublicValue;
    readonly after: PublicValue;
    readonly numericDirection: 'increase' | 'decrease' | 'unchanged' | 'transient' | null;
    readonly numericMagnitudeUnits: number | null;
    readonly numericExcursionUnits: number | null;
    readonly firstObservedOrder: number;
  }[];
  readonly identitySha256: string;
  readonly compatibilitySha256: string;
}

/** Rebuild the opaque topology from the persisted public change waves. */
export function publicTransitionTopologyFromChangesV1(
  changes: readonly (readonly PublicChange[])[],
): PublicTransitionTopologyV1 {
  const allowedRole = (role: string): boolean => role === 'self' || role === 'crosshair'
    || role === 'event' || /^[^#]+#[0-9]+$/.test(role);
  const resolution = (property: string): number => {
    if (property === 'yaw' || property === 'pitch') return Math.PI / 12;
    if (/^velocity(?:[XYZ]|\.(?:forward|right|up))$/.test(property)) return .05;
    if (property === 'relativeDistance' || property.startsWith('displacement.')) return .25;
    return .25;
  };
  const continuousProperty = (property: string): boolean => property === 'yaw' || property === 'pitch'
    || /^velocity(?:[XYZ]|\.(?:forward|right|up))$/.test(property) || property === 'relativeDistance'
    || property.startsWith('displacement.');
  const accumulated = new Map<string, { subjectRole: string; property: string;
    before: PublicValue; after: PublicValue; firstObservedOrder: number;
    numericMinimum: number | null; numericMaximum: number | null }>();
  let order = 0;
  for (const wave of changes) {
    if (wave.length === 0) continue;
    for (const change of [...wave].sort((left, right) =>
      `${left.subject}/${left.property}`.localeCompare(`${right.subject}/${right.property}`, 'en'))) {
      assert(allowedRole(change.subject), 'public-transition-topology-concrete-subject-rejected');
      const key = `${change.subject}/${change.property}`;
      const existing = accumulated.get(key);
      if (existing) {
        existing.after = change.after;
        if (typeof change.after === 'number') {
          existing.numericMinimum = Math.min(existing.numericMinimum ?? change.after, change.after);
          existing.numericMaximum = Math.max(existing.numericMaximum ?? change.after, change.after);
        }
      } else accumulated.set(key, { subjectRole: change.subject, property: change.property,
        before: change.before, after: change.after, firstObservedOrder: order++,
        numericMinimum: typeof change.before === 'number' && typeof change.after === 'number'
          ? Math.min(change.before, change.after) : null,
        numericMaximum: typeof change.before === 'number' && typeof change.after === 'number'
          ? Math.max(change.before, change.after) : null });
    }
  }
  const transitions = [...accumulated.values()].sort((left, right) =>
    left.firstObservedOrder - right.firstObservedOrder
      || `${left.subjectRole}/${left.property}`.localeCompare(`${right.subjectRole}/${right.property}`, 'en'))
    .map(value => {
      const numeric = typeof value.before === 'number' && typeof value.after === 'number';
      if (typeof value.before === 'number') assert(Number.isFinite(value.before),
        'public-transition-topology-non-finite-value');
      if (typeof value.after === 'number') assert(Number.isFinite(value.after),
        'public-transition-topology-non-finite-value');
      const delta = numeric ? (value.after as number) - (value.before as number) : 0;
      const resolutionValue = resolution(value.property);
      const netUnits = numeric ? Math.round(Math.abs(delta) / resolutionValue) : 0;
      const excursion = numeric ? Math.max(Math.abs((value.numericMinimum ?? value.before as number)
        - (value.before as number)), Math.abs((value.numericMaximum ?? value.before as number)
        - (value.before as number))) : 0;
      const excursionUnits = numeric ? Math.round(excursion / resolutionValue) : 0;
      const discreteNumeric = numeric && !continuousProperty(value.property)
        && Number.isSafeInteger(value.before) && Number.isSafeInteger(value.after);
      const before = numeric && !discreteNumeric ? null : value.before;
      const after = numeric && !discreteNumeric ? null : value.after;
      const { numericMinimum: _minimum, numericMaximum: _maximum, ...publicValue } = value;
      return Object.freeze({ ...publicValue, before, after,
        numericDirection: !numeric ? null : netUnits > 0 ? delta > 0 ? 'increase' as const
          : 'decrease' as const : excursionUnits > 0 ? 'transient' as const : 'unchanged' as const,
        numericMagnitudeUnits: numeric ? Math.max(netUnits, excursionUnits) : null,
        numericExcursionUnits: numeric ? excursionUnits : null });
    });
  assert(transitions.length > 0, 'public-transition-topology-empty-closed-event');
  const identity = { version: PUBLIC_TRANSITION_TOPOLOGY_VERSION_V1,
    source: 'closed-public-R1-event-transitions' as const, transitions };
  const compatible = transitions.flatMap(transition => {
    const continuous = continuousProperty(transition.property)
      && transition.numericDirection !== null;
    if (continuous && transition.numericMagnitudeUnits === 0) return [];
    return [{ subjectRole: transition.subjectRole, property: transition.property,
      before: continuous ? null : transition.before, after: continuous ? null : transition.after,
      numericDirection: transition.numericDirection, firstObservedOrder: transition.firstObservedOrder }];
  }).map((transition, retainedOrder) => ({ ...transition, firstObservedOrder: retainedOrder }));
  if (compatible.length === 0) compatible.push({ subjectRole: 'event',
    property: 'change-within-observed-resolution', before: false, after: false,
    numericDirection: null, firstObservedOrder: 0 });
  const compatibility = { version: 'PublicTransitionCompatibilityV1' as const,
    source: 'event-local-public-transition-structure' as const, transitions: compatible };
  return Object.freeze({ ...identity, identitySha256: sha(identity),
    compatibilitySha256: sha(compatibility) });
}

/**
 * Lossless-within-public-resolution identity of what one closed R1 atom
 * actually observed changing.  This is an opaque measurement guard for the
 * lossy three-dimensional R2 projection, not a result label or causal rule.
 * Empty frame runs are removed, so monotone time resampling cannot change the
 * identity. Concrete object/event/session ids, goals and world coordinates
 * are absent because eventRows exposes only event-local public roles.
 */
export function publicTransitionTopologyV1(event: RealEvent): PublicTransitionTopologyV1 {
  const rows = eventRows(event);
  // eventRows owns the object-id -> event-local role mapping.
  void rows.roles;
  return publicTransitionTopologyFromChangesV1(rows.measurementChanges);
}

/** Stable structural compatibility identity used by R2/R2A. Continuous
 * magnitude remains in the physical road and in the audit topology. */
export function publicTransitionTopologyIdV1(event: RealEvent): string {
  return publicTransitionTopologyV1(event).compatibilitySha256;
}

/** Public-resolution audit identity retained on the R1 fact. */
export function publicTransitionTopologyAuditIdV1(event: RealEvent): string {
  return publicTransitionTopologyV1(event).identitySha256;
}

/**
 * Derive only public continuity facts already present in the closed event.
 * This does not decide an R2 boundary and cannot use a goal or learned result.
 */
export function realEventHierarchyContinuityV1(event: RealEvent, sessionId: string,
  boundaryBefore: RealEventHierarchyContinuityV1['boundaryBefore'] = 'continuous'):
  RealEventHierarchyContinuityV1 {
  validateEvent(event);
  assert(sessionId.length > 0, 'hierarchy-session-id-required');
  const first = event.frames[0]!, last = event.frames.at(-1)!;
  const dependencies = new Map<string, RealEventContinuityEvidenceV1>();
  const add = (dependencyId: string, subject: string, property: string,
    basis: RealEventContinuityEvidenceV1['basis'],
    factCategory: RealEventContinuityEvidenceV1['factCategory'], beforeValue: unknown,
    afterValue: unknown): void => {
    dependencies.set(dependencyId, { dependencyId, basis, subject, property,
      beforeObservationSequence: first.sequence, afterObservationSequence: last.sequence,
      beforeValueSha256: sha(beforeValue), afterValueSha256: sha(afterValue), factCategory });
  };
  const action = event.bodyResult?.action;
  const targetIds = new Set([action?.targetId, ...event.trackedIds.filter(id => id !== 'self')]
    .filter((id): id is string => typeof id === 'string' && id.length > 0));
  for (const id of targetIds) {
    const before = first.objects.find(object => object.id === id), after = last.objects.find(object => object.id === id);
    const targetDependency = action?.targetId === id;
    // An explicitly tracked public object is part of the real observation
    // scope even when it remains unchanged.  Its persistence is what lets a
    // later verification observation close the same public process; omitting
    // it incorrectly turns negative/no-change trials into unrelated R1 atoms.
    const scopeDependency = event.trackedIds.includes(id);
    const presenceChanged = before?.type !== after?.type;
    if (targetDependency || scopeDependency || presenceChanged) add(`public-object:${id}:presence`, id, 'visible', targetDependency
      ? 'successor-depends-on-prior-public-observation' : 'public-state-carried-forward',
    targetDependency ? 'public-successor-precondition'
      : before?.type === after?.type ? 'public-state-persistence' : 'public-state-transition',
    before?.type ?? null, after?.type ?? null);
    const relativeBefore = before?.relativePosition ?? null, relativeAfter = after?.relativePosition ?? null;
    if (targetDependency || scopeDependency || canonical(relativeBefore) !== canonical(relativeAfter)) {
      add(`public-object:${id}:relative-position`, id, 'relative-position', targetDependency
        ? 'successor-depends-on-prior-public-observation' : 'public-state-carried-forward',
      targetDependency ? 'public-successor-precondition'
        : canonical(relativeBefore) === canonical(relativeAfter)
          ? 'public-state-persistence' : 'public-state-transition', relativeBefore, relativeAfter);
    }
    for (const property of new Set([...Object.keys(before?.properties ?? {}), ...Object.keys(after?.properties ?? {})])) {
      if (!targetDependency && !scopeDependency && before?.properties[property] === after?.properties[property]) continue;
      add(`public-object:${id}:property:${property}`, id, property, 'public-state-carried-forward',
        before?.properties[property] === after?.properties[property]
          ? 'public-state-persistence' : 'public-state-transition',
      before?.properties[property] ?? null, after?.properties[property] ?? null);
    }
  }
  if (first.targetId || last.targetId) {
    for (const id of new Set([first.targetId, last.targetId].filter((value): value is string => value !== null))) {
      add(`public-crosshair-target:${id}`, id, 'crosshair-binding',
        'successor-depends-on-prior-public-observation', 'public-successor-precondition',
      first.targetId === id, last.targetId === id);
    }
  }
  const noChange = eventRows(event).changes.flat().every(change => change.before === change.after);
  const verification = action && (action.kind === 'observe' || action.kind === 'wait') && noChange;
  if (action && ['look', 'move', 'jump'].includes(action.kind)) {
    const property = action.kind === 'look' ? 'orientation' : 'motion-state';
    const beforeValue = action.kind === 'look' ? [first.self.yaw, first.self.pitch] : first.self.position;
    const afterValue = action.kind === 'look' ? [last.self.yaw, last.self.pitch] : last.self.position;
    add(`self:${property}`, 'self', property, 'public-state-carried-forward',
      canonical(beforeValue) === canonical(afterValue) ? 'public-state-persistence' : 'public-state-transition',
      beforeValue, afterValue);
  }
  // A no-change observe/wait explicitly verifies the body's current public
  // state.  Carrying these two facts lets it close a preceding move/jump or
  // look even when an external scoped object has become publicly unavailable.
  // This is real frame-to-frame continuity, not a goal or action rule.
  if (verification) {
    for (const [property, beforeValue, afterValue] of [
      ['motion-state', first.self.position, last.self.position],
      ['orientation', [first.self.yaw, first.self.pitch], [last.self.yaw, last.self.pitch]],
    ] as const) add(`self:${property}`, 'self', property, 'public-state-carried-forward',
      canonical(beforeValue) === canonical(afterValue) ? 'public-state-persistence' : 'public-state-transition',
      beforeValue, afterValue);
  }
  return { version: 'RealEventHierarchyContinuityV1', sessionId,
    continuityEpochId: `${sessionId}:continuity-1`, boundaryBefore,
    processStatusAfter: verification ? 'publicly-resolved'
      : event.bodyResult?.terminationReason === 'observation-limit' ? 'observation-insufficient' : 'open',
    dependencies: [...dependencies.values()].sort((left, right) => left.dependencyId.localeCompare(right.dependencyId)) };
}
