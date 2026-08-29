import { vec3 } from "./vector.js";
import type { Vec3 } from "./contracts.js";

const MASK_64 = (1n << 64n) - 1n;
const UINT53 = 9_007_199_254_740_992;

export class SplitMix64 {
  readonly #initialSeed: bigint;
  #state: bigint;
  #spareGaussian: number | null = null;

  constructor(seed: bigint) {
    this.#initialSeed = seed & MASK_64;
    this.#state = this.#initialSeed;
  }

  get initialSeed(): bigint {
    return this.#initialSeed;
  }

  nextUint64(): bigint {
    this.#state = (this.#state + 0x9e3779b97f4a7c15n) & MASK_64;
    let z = this.#state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    return (z ^ (z >> 31n)) & MASK_64;
  }

  uniform(): number {
    return Number(this.nextUint64() >> 11n) / UINT53;
  }

  gaussian(): number {
    if (this.#spareGaussian !== null) {
      const value = this.#spareGaussian;
      this.#spareGaussian = null;
      return value;
    }
    // Half-bin offset makes u strictly inside (0,1), eliminating rejection
    // loops and keeping every formal simulation's draw count statically bounded.
    const u = (Number(this.nextUint64() >> 11n) + 0.5) / UINT53;
    const v = this.uniform();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    this.#spareGaussian = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  }

  gaussian3(): Vec3 {
    return vec3(this.gaussian(), this.gaussian(), this.gaussian());
  }

  fork(tag: bigint): SplitMix64 {
    return new SplitMix64((this.#initialSeed ^ (tag * 0x9e3779b97f4a7c15n)) & MASK_64);
  }
}
