import type { Vec3 } from "./contracts.js";

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  const result = new Float64Array([x, y, z]);
  assertVec3(result);
  return result;
}

export function assertVec3(value: ArrayLike<number>): asserts value is Vec3 {
  if (value.length !== 3) throw new RangeError("a physical-medium coordinate must have exactly 3 values");
  for (let index = 0; index < 3; index += 1) {
    if (!Number.isFinite(value[index])) throw new RangeError("coordinate values must be finite float64 numbers");
  }
}

export function clone3(a: Vec3): Vec3 {
  assertVec3(a);
  return new Float64Array(a);
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!);
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

export function scale3(a: Vec3, scalar: number): Vec3 {
  return vec3(a[0]! * scalar, a[1]! * scalar, a[2]! * scalar);
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  );
}

export function normSquared3(a: Vec3): number {
  return dot3(a, a);
}

export function norm3(a: Vec3): number {
  return Math.sqrt(normSquared3(a));
}

export function distanceSquared3(a: Vec3, b: Vec3): number {
  const x = a[0]! - b[0]!;
  const y = a[1]! - b[1]!;
  const z = a[2]! - b[2]!;
  return x * x + y * y + z * z;
}

export function normalize3(a: Vec3, epsilon = 1e-12): Vec3 | null {
  const magnitude = norm3(a);
  return magnitude <= epsilon ? null : scale3(a, 1 / magnitude);
}

export function sameBits3(a: Vec3, b: Vec3): boolean {
  const aa = new BigUint64Array(a.buffer, a.byteOffset, 3);
  const bb = new BigUint64Array(b.buffer, b.byteOffset, 3);
  return aa[0] === bb[0] && aa[1] === bb[1] && aa[2] === bb[2];
}

export function freezeVec3(a: Vec3): Vec3 {
  // Typed arrays cannot be frozen in current JavaScript engines. Returning a
  // defensive copy is the immutable-boundary convention used by this project.
  return clone3(a);
}
