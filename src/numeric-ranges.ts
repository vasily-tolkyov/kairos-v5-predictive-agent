/** Empirical possibility envelopes, not statistical confidence guarantees. */
export type NumericRange = readonly [number, number];
export type NumericRanges = Readonly<Record<string, NumericRange>>;
export const pointRange = (value: number): NumericRange => [value, value];
export const hull = (ranges: readonly NumericRange[]): NumericRange => [
  Math.min(...ranges.map(value => value[0])), Math.max(...ranges.map(value => value[1]))];
export const addRanges = (a: NumericRange, b: NumericRange): NumericRange => [a[0] + b[0], a[1] + b[1]];
export const scaleRange = (a: NumericRange, scale: number): NumericRange => scale >= 0
  ? [a[0] * scale, a[1] * scale] : [a[1] * scale, a[0] * scale];
const product = (a: NumericRange, b: NumericRange): NumericRange => {
  const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [Math.min(...values), Math.max(...values)];
};
function sine(range: NumericRange): NumericRange {
  const [lo, hi] = range; if (hi - lo >= 2 * Math.PI) return [-1, 1];
  const values = [Math.sin(lo), Math.sin(hi)];
  for (let k = Math.ceil((lo - Math.PI / 2) / Math.PI); Math.PI / 2 + k * Math.PI <= hi; k++)
    values.push(k % 2 ? -1 : 1);
  return [Math.min(...values), Math.max(...values)];
}
/** Same measured yaw coordinate transform as perception. An unavailable
 * component can be ignored only for a geometrically zero coefficient. */
export function rotateRanges(values: readonly (NumericRange | null)[], yaw: NumericRange,
  toBody = false): (NumericRange | null)[] {
  const s = sine(yaw), c = sine(addRanges(yaw, pointRange(Math.PI / 2)));
  const term = (value: NumericRange | null, coefficient: NumericRange): NumericRange | null =>
    Math.max(Math.abs(coefficient[0]), Math.abs(coefficient[1])) < 1e-9 ? [0, 0]
      : value ? product(value, coefficient) : null;
  const sum = (a: NumericRange | null, b: NumericRange | null) => a && b ? addRanges(a, b) : null;
  return toBody
    ? [sum(term(values[0] ?? null, scaleRange(s, -1)), term(values[2] ?? null, scaleRange(c, -1))),
      sum(term(values[0] ?? null, c), term(values[2] ?? null, scaleRange(s, -1))), values[1] ?? null]
    : [sum(term(values[0] ?? null, scaleRange(s, -1)), term(values[1] ?? null, c)), values[2] ?? null,
      sum(term(values[0] ?? null, scaleRange(c, -1)), term(values[1] ?? null, scaleRange(s, -1)))];
}
