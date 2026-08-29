function plain(value: unknown): unknown {
  if (value instanceof Float64Array || value instanceof Uint32Array) return [...value];
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, plain(item)]),
    );
  }
  return value;
}

export function deterministicJson(value: unknown): string {
  return JSON.stringify(plain(value));
}

export function fnv1a64(value: unknown): string {
  const text = deterministicJson(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
