const FROZEN_DATA = new WeakSet<object>();

/** Freeze plain transported data only. Object.freeze alone cannot make an
 * accessor's result or a custom toJSON implementation immutable. Private
 * registration, not an outer frozen flag, permits skipping a repeated walk. */
export function freezeEvidenceData(value: unknown, visiting = new WeakSet<object>()): void {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw new Error('non-data-real-evidence');
  if (FROZEN_DATA.has(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype))
    throw new Error('non-plain-real-evidence');
  if (visiting.has(value)) throw new Error('cyclic-real-evidence');
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key === 'symbol' || !Object.hasOwn(descriptor, 'value')) throw new Error('non-data-real-evidence');
    freezeEvidenceData(descriptor.value, visiting);
  }
  Object.freeze(value); visiting.delete(value); FROZEN_DATA.add(value);
}
