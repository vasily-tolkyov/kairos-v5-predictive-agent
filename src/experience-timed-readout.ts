import type { Observation, PublicValue, RealEvent } from './contracts.js';
import { EXPERIENCE_LIVE_LAW, isActualLiveState, isExperienceLiveState,
  actualObservationDigest, areConsecutiveActualStates, projectLiveChannels, type LiveStateV1 } from './experience-live-state.js';
import { extractExperienceIntervals, type SourceExperienceIntervals } from './experience-intervals.js';
import { sha } from './util.js';
import { worldToBody } from './perception.js';

export const CONTINUOUS_READOUT = 'continuous-window-v1' as const;
export interface ExperienceWindowLiveTraceV1 {
  readonly version: 'ExperienceWindowLiveTraceV1';
  readonly parentWindowId: string;
  readonly parentEventDigest: string;
  /** Original frozen states, in original frame order; serialized lookalikes
   * and an end-state substituted for a missing first state are not evidence. */
  readonly states: readonly LiveStateV1[];
}
function require(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
export function validateLivePredictionState(state: LiveStateV1, observation: Observation): void {
  require(isExperienceLiveState(state) && state.law === EXPERIENCE_LIVE_LAW, 'unowned-live-prediction-state');
  if (state.origin === 'real') require(isActualLiveState(state) && observation.predictionSupport === undefined
    && state.frame?.sequence === observation.sequence && state.frame.sensorySha256 === actualObservationDigest(observation),
  'live-prediction-frame-mismatch');
  else require(observation.predictionSupport !== undefined, 'imagined-state-with-real-observation');
}
export function validateExperienceLiveTrace(event: RealEvent, trace: ExperienceWindowLiveTraceV1): SourceExperienceIntervals {
  require(trace?.version === 'ExperienceWindowLiveTraceV1' && trace.parentWindowId === event.id
    && trace.parentEventDigest === sha(event) && trace.states.length === event.frames.length, 'live-trace-source-mismatch');
  const epoch = trace.states[0]?.frame?.epoch;
  for (let i = 0; i < event.frames.length; i++) {
    const state = trace.states[i]!, frame = event.frames[i]!;
    require(isActualLiveState(state) && state.origin === 'real' && state.frame?.epoch === epoch
      && state.frame?.sequence === frame.sequence && state.frame.sensorySha256 === actualObservationDigest(frame), 'unowned-or-conflicting-live-trace');
    if (i) require(state.frame.sequence === trace.states[i - 1]!.frame!.sequence + 1
      && state.revision === trace.states[i - 1]!.revision + 1 && state.continuity !== 'gap'
      && areConsecutiveActualStates(trace.states[i - 1]!, state), 'discontinuous-live-trace');
    require(frame.physicalClock ? state.physicalClock?.physicsTick === frame.physicalClock.physicsTick
      && state.physicalClock.secondsPerTick === frame.physicalClock.secondsPerTick
      : state.physicalClock === null, 'live-trace-clock-mismatch');
  }
  return extractExperienceIntervals(event);
}

/** The same 49-coefficient RLS receives a fixed 32-channel projection and the
 * actual 16-state history, with every raw condition retained for local support
 * tests. There is no mutable first-32 channel admission list. */
export function continuousReadoutInput(state: LiveStateV1, sensory: Record<string, PublicValue>,
  extra: Readonly<Record<string, PublicValue>> = {}): Record<string, PublicValue> {
  const channels = { ...sensory, ...Object.fromEntries(Object.entries(state.channels).map(([key, value]) => ['live/' + key, value])), ...extra };
  const projection = projectLiveChannels(channels, 4096);
  return { ...channels,
    ...Object.fromEntries(projection.map((value, i) => ['@continuous/r/' + i, value])),
    ...Object.fromEntries(state.h.map((value, i) => ['@continuous/h/' + i, value])) };
}
export function continuousReadoutField(input: Readonly<Record<string, PublicValue>>): number[] {
  const field = [1, ...Array.from({ length: 32 }, (_, i) => input['@continuous/r/' + i]),
    ...Array.from({ length: 16 }, (_, i) => input['@continuous/h/' + i])];
  require(field.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1),
    'invalid-continuous-readout-field');
  return field as number[];
}

type Targets = [string, PublicValue, PublicValue][];
/** Measured endpoints only. No route, action effect, hidden identity or future
 * motor duration is inserted into an input. Absent objects mask motion. */
export function measuredPairTargets(first: Observation, last: Observation, attentionId?: string | null) {
  const self: Targets = worldToBody(last.self.position.map((v, i) => v - first.self.position[i]!), first.self.yaw)
    .map((v, i) => [`motion/${i}`, 0, v]);
  self.push(['yaw', 0, Math.atan2(Math.sin(last.self.yaw - first.self.yaw), Math.cos(last.self.yaw - first.self.yaw))],
    ['pitch', first.self.pitch, last.self.pitch]);
  for (const [name, before] of Object.entries(first.self.properties)) {
    const after = last.self.properties[name]; if (after !== undefined) self.push([`property/${name}`, before, after]);
  }
  if (last.perception) {
    const gaze = last.objects.find(object => object.id === last.targetId);
    self.push(['appearance/visible', false, Boolean(gaze)]);
    if (gaze) {
      self.push(['appearance/type', null, gaze.type]);
      worldToBody(gaze.relativePosition, last.self.yaw).forEach((value, axis) => self.push([`appearance/position/${axis}`, 0, value]));
      for (const [key, value] of Object.entries(gaze.properties)) if (!['confidence', 'ambiguity'].includes(key))
        self.push([`appearance/property/${key}`, typeof value === 'number' ? 0 : null, value]);
    }
  }
  const focus = new Set([attentionId !== undefined ? attentionId : first.perception?.attendedId, first.targetId,
    ...(!first.perception ? first.objects.map(object => object.id) : [])]);
  let maskedObjects = 0;
  const objects = first.objects.filter(object => focus.has(object.id)).map(object => {
    const after = last.objects.find(value => value.id === object.id);
    if (!after) { maskedObjects++; return { object, targets: [['measurement', true, false]] as Targets }; }
    const beforeTrack = first.perception?.tracks.find(value => value.id === object.id);
    const afterTrack = last.perception?.tracks.find(value => value.id === object.id);
    const movement = worldToBody(after.relativePosition.map((v, i) => v - object.relativePosition[i]!
      + last.self.position[i]! - first.self.position[i]!), first.self.yaw);
    const targets: Targets = movement.flatMap((v, i) => (!beforeTrack || beforeTrack.motionEvidence[i])
      && (!afterTrack || afterTrack.motionEvidence[i]) && (!beforeTrack || !afterTrack || beforeTrack.anchorEpoch === afterTrack.anchorEpoch)
      ? [[`motion/${i}`, 0, v] as [string, PublicValue, PublicValue]] : []);
    targets.push(['gaze', object.id === first.targetId, after.id === last.targetId],
      ['measurement', true, !beforeTrack || !afterTrack || beforeTrack.anchorEpoch === afterTrack.anchorEpoch]);
    for (const [key, before] of Object.entries(object.properties)) if (!['confidence', 'ambiguity'].includes(key)
      && after.properties[key] !== undefined) targets.push([`property/${key}`, before, after.properties[key]!]);
    return { object, targets };
  });
  return { self, objects, maskedObjects };
}
