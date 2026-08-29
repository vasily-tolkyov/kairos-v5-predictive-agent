import Value from 'typebox/value';
import type { TSchema } from 'typebox';
import { assert, canonical } from './util.js';

/** A transport representation only. No task, action, observation, or memory policy lives here. */
type Schema = { type?: string; anyOf?: Schema[]; properties?: Record<string, Schema>; required?: string[];
  items?: Schema; const?: unknown; [keyword: string]: unknown };
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const literal = (value: string): Schema => ({ type: 'string', enum: [value] });
const UNIT = object({ unit: literal('empty') });
const KEEP = object({ op: literal('keep') });
const checked = (schema: Schema, value: unknown): boolean => Value.Check(schema as TSchema, value);
const cloneSchema = (schema: TSchema): Schema => JSON.parse(JSON.stringify(schema));
const variants = (schema: Schema): Schema[] => schema.anyOf ? schema.anyOf.flatMap(variants) : [schema];

function optional(schema: Schema): Schema {
  return { ...(schema.description ? { description: schema.description } : {}), anyOf: [KEEP, ...variants(schema).map(derive)] };
}
function derive(schema: Schema): Schema {
  if (schema.anyOf) return { ...schema, anyOf: schema.anyOf.map(derive) };
  if (schema.type === 'object') {
    const properties = schema.properties ?? {};
    assert(schema.additionalProperties === false, 'strict-wire-requires-closed-logical-object');
    if (!Object.keys(properties).length) return UNIT;
    const required = new Set(schema.required ?? []);
    return { ...schema, ...object(Object.fromEntries(Object.entries(properties).map(([key, field]) =>
      [key, required.has(key) ? derive(field) : optional(field)]))) };
  }
  if (schema.type === 'array') {
    assert(schema.items, 'strict-wire-array-items-required');
    const { minItems: _min, maxItems: _max, ...rest } = schema;
    return { ...rest, items: derive(schema.items) }; // Original bounds are checked after decoding.
  }
  if (typeof schema.const === 'string') {
    const { const: value, ...rest } = schema; return { ...rest, enum: [value] };
  }
  return { ...schema };
}

export const STRICT_WIRE_VERSION = 'KairosNativeValueStrictWireV3';
export const STRICT_WIRE_GUIDANCE = 'DeepSeek工具使用原生值可逆线格式V3：字符串、数字、布尔、数组和非空对象直接使用原JSON类型和值，包括false、0、空字符串和空数组，不包裹set-*对象。原可选字段此次省略才用{"op":"keep"}；逻辑允许且明确给出的null直接使用JSON null，与省略不同。不接受set-null包装。原必填字段不可keep。只有原本零参数的对象使用{"unit":"empty"}。对象内可选字段递归遵循同一规则。动作仍使用kind、parameters及需要时的targetId原层级。线标记不是动作、默认参数、任务结论或证据。';
export const deriveStrictToolSchema = (logical: TSchema): TSchema => derive(cloneSchema(logical)) as TSchema;

function equalBranches(values: unknown[]): unknown {
  assert(values.length > 0, 'strict-wire-no-matching-branch');
  const first = canonical(values[0]);
  assert(values.every(value => canonical(value) === first), 'strict-wire-ambiguous-branch');
  return values[0];
}
function encode(schema: Schema, value: any): unknown {
  if (schema.anyOf) return equalBranches(schema.anyOf.filter(branch => checked(branch, value)).map(branch => encode(branch, value)));
  if (schema.type === 'array') return value.map((item: unknown) => encode(schema.items!, item));
  if (schema.type !== 'object') return value;
  const properties = schema.properties ?? {};
  if (!Object.keys(properties).length) return { unit: 'empty' };
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(properties).map(([key, field]) => {
    if (required.has(key)) return [key, encode(field, value[key])];
    if (!Object.hasOwn(value, key)) return [key, { op: 'keep' }];
    return [key, encode(field, value[key])];
  }));
}
function decode(schema: Schema, value: any): unknown {
  if (schema.anyOf) return equalBranches(schema.anyOf.filter(branch => checked(derive(branch), value)).map(branch => decode(branch, value)));
  if (schema.type === 'array') return value.map((item: unknown) => decode(schema.items!, item));
  if (schema.type !== 'object') return value;
  const properties = schema.properties ?? {};
  if (!Object.keys(properties).length) return {};
  const result: Record<string, unknown> = {}, required = new Set(schema.required ?? []);
  for (const [key, field] of Object.entries(properties)) {
    if (required.has(key)) { result[key] = decode(field, value[key]); continue; }
    const patch = value[key];
    if (patch !== null && typeof patch === 'object' && patch.op === 'keep') continue;
    result[key] = decode(field, patch);
  }
  return result;
}

/** Useful for lossless round-trip tests. Production never repairs or re-encodes a model's bad call. */
export function encodeStrictToolArguments(logical: TSchema, value: unknown): any {
  const schema = cloneSchema(logical);
  assert(checked(schema, value), 'strict-wire-invalid-logical-arguments');
  const wire = encode(schema, value);
  assert(checked(derive(schema), wire), 'strict-wire-encoding-invalid');
  return wire;
}
/** Runs on the actual received wire arguments; no defaults, coercion, or inferred action data. */
export function decodeStrictToolArguments(logical: TSchema, wire: unknown): any {
  const schema = cloneSchema(logical);
  assert(checked(derive(schema), wire), 'strict-wire-invalid-arguments');
  const result = decode(schema, wire);
  assert(checked(schema, result), 'strict-wire-decoded-logical-validation-failed');
  return result;
}

/** Pi already holds the derived schemas; only set the provider's native flag, never its generic converter. */
export function nativeStrictTools(tools: unknown): unknown {
  assert(Array.isArray(tools) && tools.length > 0, 'strict-wire-missing-tools');
  return tools.map(tool => {
    assert(tool?.type === 'function' && tool.function?.parameters, 'strict-wire-non-function-tool');
    return { ...tool, function: { ...tool.function, strict: true } };
  });
}
