import Type from 'typebox';
import type { Action, Observation } from './contracts.js';
import { assert } from './util.js';

const object = (properties: Parameters<typeof Type.Object>[0]) => Type.Object(properties, { additionalProperties: false });
const choice = (values: readonly string[]) => Type.Union(values.map(value => Type.Literal(value)));
const ticks = (maximum: number) => Type.Integer({ minimum: 1, maximum, description: '真实50毫秒物理刻数' });
const branch = (kind: string, parameters: Parameters<typeof Type.Object>[0], target = false) => object({
  kind: Type.Literal(kind), parameters: object(parameters), ...(target ? { targetId: Type.String({ pattern: '^o[1-9][0-9]*$', description: '当前观察中的精确对象别名' }) } : {}),
});
export const ACTION_SCHEMA = Type.Union([
  branch('observe', { ticks: ticks(100) }), branch('wait', { ticks: ticks(100) }),
  branch('look', { yawDegrees: Type.Number({ minimum: -90, maximum: 90, description: '相对偏航度；正值左转' }),
    pitchDegrees: Type.Number({ minimum: -90, maximum: 90, description: '相对俯仰度；正值向上' }) }),
  branch('move', { direction: choice(['forward', 'back', 'left', 'right']), ticks: ticks(20) }),
  branch('jump', { forward: Type.Boolean(), ticks: ticks(20) }),
  branch('interact', {}, true), branch('attack', {}, true), branch('break', {}, true),
  branch('place', { face: choice(['up', 'north', 'south', 'east', 'west']) }, true),
  branch('select-hotbar', { slot: Type.Integer({ minimum: 0, maximum: 8 }) }),
]);

/** Shared structural check also used by the body; no guessed defaults or target correction. */
export function validateAction(action: Action): void {
  const fields: Record<string, readonly string[]> = { observe: ['ticks'], wait: ['ticks'], look: ['yawDegrees', 'pitchDegrees'],
    move: ['direction', 'ticks'], jump: ['forward', 'ticks'], interact: [], attack: [], break: [], place: ['face'], 'select-hotbar': ['slot'] };
  assert(action && fields[action.kind] && action.parameters && typeof action.parameters === 'object', 'invalid-action-kind-or-parameters');
  const p = action.parameters, required = fields[action.kind]!;
  assert(Object.keys(p).length === required.length && required.every(key => p[key] !== undefined), 'action-parameters-not-exact');
  const targeted = ['interact', 'attack', 'break', 'place'].includes(action.kind);
  assert(targeted ? typeof action.targetId === 'string' && action.targetId.length > 0 : action.targetId === undefined, 'action-target-not-exact');
  assert(Object.keys(action).every(key => ['kind', 'parameters', ...(targeted ? ['targetId'] : [])].includes(key)), 'unknown-action-field');
  if ('ticks' in p) assert(typeof p.ticks === 'number' && Number.isInteger(p.ticks) && p.ticks >= 1 && p.ticks <= (['wait', 'observe'].includes(action.kind) ? 100 : 20), 'invalid-action-ticks');
  if (action.kind === 'look') for (const key of required) assert(typeof p[key] === 'number' && Number.isFinite(p[key]) && Math.abs(p[key] as number) <= 90, 'invalid-look-angles');
  if (action.kind === 'move') assert(['forward', 'back', 'left', 'right'].includes(String(p.direction)), 'invalid-move-direction');
  if (action.kind === 'jump') assert(typeof p.forward === 'boolean', 'invalid-jump-forward');
  if (action.kind === 'place') assert(['up', 'north', 'south', 'east', 'west'].includes(String(p.face)), 'invalid-place-face');
  if (action.kind === 'select-hotbar') assert(typeof p.slot === 'number' && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 8, 'invalid-hotbar-slot');
}

export const SPATIAL_CONVENTION = 'positionFRU依次为身体水平朝向的前、右、世界上，单位格；不是R1坐标。偏航0面向世界-Z，偏航正向左转；俯仰正向上。look参数是相对角度，单位度。place面名为公开世界方向，不是自动瞄准。';
export const QUERY_CONVENTION = 'recall.subject是历史主体：自身填self；body只是显示容器。对象的historyQuerySubject查询同类型历史，不代表当前个体；o1等仅用于当前动作目标。property填公开或历史变化中的真实属性名，不是通用value；value是所查的历史结果值。可省略subject跨主体查询。不自动修正或扩大查询。';
/** Goal-local identity map. No prefix repair, fuzzy matching or replacement by nearby objects. */
export class PublicObjectAliases {
  #toAlias = new Map<string, string>();
  #toId = new Map<string, string>();
  reset(): void { this.#toAlias.clear(); this.#toId.clear(); }
  alias(rawId: string): string {
    if (rawId === 'self') return 'self';
    let result = this.#toAlias.get(rawId);
    if (!result) { result = `o${this.#toAlias.size + 1}`; this.#toAlias.set(rawId, result); this.#toId.set(result, rawId); }
    return result;
  }
  resolveAction(action: Action, current: Observation): Action {
    validateAction(action);
    if (action.targetId === undefined) return structuredClone(action);
    const raw = this.#toId.get(action.targetId);
    assert(raw && current.objects.some(o => o.id === raw), 'unknown-or-no-longer-visible-object-alias');
    return { ...structuredClone(action), targetId: raw };
  }
  present(frame: Observation): unknown {
    const sin = Math.sin(frame.self.yaw), cos = Math.cos(frame.self.yaw), round = (n: number) => Number(n.toFixed(3));
    return { sequence: frame.sequence, activeSeconds: frame.activeSeconds,
      body: { subject: 'self', ...frame.self.properties, yawDegrees: round(frame.self.yaw * 180 / Math.PI), pitchDegrees: round(frame.self.pitch * 180 / Math.PI) },
      queryVocabulary: { selfProperties: Object.keys(frame.self.properties).sort(),
        objectProperties: [...new Set(frame.objects.flatMap(o => Object.keys(o.properties)))].sort(),
        historySubjects: ['self', ...new Set(frame.objects.map(o => o.type))] },
      objects: frame.objects.map(o => ({ id: this.alias(o.id), type: o.type, historyQuerySubject: o.type,
        positionFRU: [round(-sin * o.relativePosition[0] - cos * o.relativePosition[2]), round(cos * o.relativePosition[0] - sin * o.relativePosition[2]), round(o.relativePosition[1])],
        properties: o.properties })), crosshair: frame.targetId ? this.alias(frame.targetId) : null };
  }
  snapshot(): unknown { return [...this.#toAlias.entries()].map(([publicId, alias]) => ({ alias, publicId })); }
}
