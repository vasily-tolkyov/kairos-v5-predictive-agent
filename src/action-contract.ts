import type { Action } from './contracts.js';
import { assert } from './util.js';

/** Exact structural validation shared by the body and the physical controller. */
export function validateAction(action: Action): void {
  const fields: Record<string, readonly string[]> = {
    observe: ['ticks'], wait: ['ticks'], look: ['yawDegrees', 'pitchDegrees'],
    move: ['direction', 'ticks'], jump: ['forward', 'ticks'], interact: [], attack: [], break: [],
    place: ['face'], 'select-hotbar': ['slot'],
  };
  assert(action && fields[action.kind] && action.parameters && typeof action.parameters === 'object',
    'invalid-action-kind-or-parameters');
  const parameters = action.parameters;
  const required = fields[action.kind]!;
  assert(Object.keys(parameters).length === required.length
    && required.every(key => parameters[key] !== undefined), 'action-parameters-not-exact');
  const targeted = ['interact', 'attack', 'break', 'place'].includes(action.kind);
  assert(targeted ? typeof action.targetId === 'string' && action.targetId.length > 0
    : action.targetId === undefined, 'action-target-not-exact');
  assert(Object.keys(action).every(key => ['kind', 'parameters', ...(targeted ? ['targetId'] : [])].includes(key)),
    'unknown-action-field');
  if ('ticks' in parameters) assert(typeof parameters.ticks === 'number' && Number.isInteger(parameters.ticks)
    && parameters.ticks >= 1 && parameters.ticks <= (['wait', 'observe'].includes(action.kind) ? 100 : 20),
  'invalid-action-ticks');
  if (action.kind === 'look') for (const key of required) assert(typeof parameters[key] === 'number'
    && Number.isFinite(parameters[key]) && Math.abs(parameters[key] as number) <= 90, 'invalid-look-angles');
  if (action.kind === 'move') assert(['forward', 'back', 'left', 'right'].includes(String(parameters.direction)),
    'invalid-move-direction');
  if (action.kind === 'jump') assert(typeof parameters.forward === 'boolean', 'invalid-jump-forward');
  if (action.kind === 'place') assert(['up', 'north', 'south', 'east', 'west'].includes(String(parameters.face)),
    'invalid-place-face');
  if (action.kind === 'select-hotbar') assert(typeof parameters.slot === 'number'
    && Number.isInteger(parameters.slot) && parameters.slot >= 0 && parameters.slot <= 8, 'invalid-hotbar-slot');
}
