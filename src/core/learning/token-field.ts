import type {
  CommonFieldToken,
  FieldToken,
  ResidualFieldState,
  TokenFieldEncoderStateV2,
  Vec3,
} from "../contracts.js";
import { clone3, vec3 } from "../vector.js";

export const TOKEN_FIELD_WIDTH = 256;
export const COMMON_COVERAGE_MIN = 0.75;
export const RESIDUAL_MODE_SIMILARITY_MIN = 0.80;
const TOKEN_DISPLACEMENT = 0.12;
const TOKEN_LANE_SPACING = 1.5;
const TOKEN_KERNEL_WIDTH = 0.18;
const ONE_SIGMA_OVERLAP = Math.exp(-0.5);

export interface EncodedTokenField {
  readonly anchorId: string;
  readonly tokens: readonly FieldToken[];
}

export interface CommonalityAnalysis {
  readonly commonInput: readonly CommonFieldToken[];
  readonly residuals: ReadonlyMap<string, ResidualFieldState>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function directionFor(index: number): Vec3 {
  const raw = vec3(
    Math.sin((index + 1) * 1.3247179572447458),
    Math.cos((index + 3) * 0.7548776662466927),
    Math.sin((index + 7) * 0.5698402909980532),
  );
  const magnitude = Math.hypot(raw[0]!, raw[1]!, raw[2]!) || 1;
  return vec3(raw[0]! / magnitude, raw[1]! / magnitude, raw[2]! / magnitude);
}

function baseFor(index: number): Vec3 {
  const x = index % 8;
  const y = Math.floor(index / 8) % 8;
  const z = Math.floor(index / 64);
  return vec3(
    (x - 3.5) * TOKEN_LANE_SPACING,
    (y - 3.5) * TOKEN_LANE_SPACING,
    (z - 1.5) * TOKEN_LANE_SPACING,
  );
}

function coordinateFor(index: number, standardizedValue: number): Vec3 {
  const base = baseFor(index);
  const direction = directionFor(index);
  const displacement = TOKEN_DISPLACEMENT * clamp(standardizedValue, -3, 3);
  return vec3(
    base[0]! + displacement * direction[0]!,
    base[1]! + displacement * direction[1]!,
    base[2]! + displacement * direction[2]!,
  );
}

function squaredDistance(left: Vec3, right: Vec3): number {
  const dx = left[0]! - right[0]!;
  const dy = left[1]! - right[1]!;
  const dz = left[2]! - right[2]!;
  return dx * dx + dy * dy + dz * dz;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export class DeterministicTokenFieldEncoder {
  #inputMean = new Float64Array();
  #inputDeviation = new Float64Array();
  #frozen = false;

  fit(perceptions: readonly Float64Array[]): void {
    if (this.#frozen) throw new Error("frozen token-field encoder cannot be refit");
    if (perceptions.length < 16) throw new RangeError("token-field fitting requires at least sixteen perceptions");
    if (perceptions.some((row) => row.length !== TOKEN_FIELD_WIDTH)) {
      throw new RangeError("token-field encoder requires exactly 256 public dimensions");
    }
    this.#inputMean = new Float64Array(TOKEN_FIELD_WIDTH);
    this.#inputDeviation = new Float64Array(TOKEN_FIELD_WIDTH);
    for (let feature = 0; feature < TOKEN_FIELD_WIDTH; feature += 1) {
      const mean = perceptions.reduce((sum, row) => sum + row[feature]!, 0) / perceptions.length;
      const variance = perceptions.reduce((sum, row) => sum + (row[feature]! - mean) ** 2, 0)
        / perceptions.length;
      this.#inputMean[feature] = mean;
      this.#inputDeviation[feature] = Math.sqrt(variance) || 1;
    }
  }

  freeze(): void {
    if (this.#inputMean.length !== TOKEN_FIELD_WIDTH) throw new Error("token-field encoder must be fit before freeze");
    this.#frozen = true;
  }

  static fromState(state: TokenFieldEncoderStateV2): DeterministicTokenFieldEncoder {
    if (!state.frozen || state.width !== TOKEN_FIELD_WIDTH
      || state.inputMean.length !== TOKEN_FIELD_WIDTH
      || state.inputDeviation.length !== TOKEN_FIELD_WIDTH) {
      throw new RangeError("invalid frozen token-field encoder state");
    }
    const encoder = new DeterministicTokenFieldEncoder();
    encoder.#inputMean = new Float64Array(state.inputMean);
    encoder.#inputDeviation = new Float64Array(state.inputDeviation);
    encoder.#frozen = true;
    return encoder;
  }

  exportState(): TokenFieldEncoderStateV2 {
    if (!this.#frozen) throw new Error("token-field encoder must be frozen before export");
    return {
      width: TOKEN_FIELD_WIDTH,
      frozen: true,
      inputMean: [...this.#inputMean],
      inputDeviation: [...this.#inputDeviation],
    };
  }

  encode(anchorId: string, perception: Float64Array): EncodedTokenField {
    if (!this.#frozen) throw new Error("token-field encoder must be frozen before encode");
    if (perception.length !== TOKEN_FIELD_WIDTH) throw new RangeError("public perception width mismatch");
    const tokens: FieldToken[] = [];
    for (let index = 0; index < TOKEN_FIELD_WIDTH; index += 1) {
      const standardizedValue = (perception[index]! - this.#inputMean[index]!)
        / this.#inputDeviation[index]!;
      tokens.push({
        tokenIndex: index,
        coordinate: coordinateFor(index, standardizedValue),
        standardizedValue,
      });
    }
    return { anchorId, tokens };
  }

  isFrozen(): boolean {
    return this.#frozen;
  }
}

export class PhysicalCommonalityWorkspace {
  analyze(fields: readonly EncodedTokenField[]): CommonalityAnalysis {
    if (fields.length < 2) throw new RangeError("commonality analysis requires at least two fields");
    const ordered = [...fields].sort((left, right) => left.anchorId.localeCompare(right.anchorId));
    if (new Set(ordered.map((field) => field.anchorId)).size !== ordered.length) {
      throw new RangeError("commonality coverage counts unique experience anchors only");
    }
    if (ordered.some((field) => field.tokens.length !== TOKEN_FIELD_WIDTH)) {
      throw new RangeError("every token field must contain 256 tokens");
    }
    const commonInput: CommonFieldToken[] = [];
    const commonValues = new Float64Array(TOKEN_FIELD_WIDTH);
    const commonMask = new Uint8Array(TOKEN_FIELD_WIDTH);
    for (let tokenIndex = 0; tokenIndex < TOKEN_FIELD_WIDTH; tokenIndex += 1) {
      const values = ordered.map((field) => field.tokens[tokenIndex]!.standardizedValue);
      const central = median(values);
      const coordinate = coordinateFor(tokenIndex, central);
      let supporters = 0;
      for (const field of ordered) {
        const token = field.tokens[tokenIndex]!;
        const overlap = Math.exp(-squaredDistance(token.coordinate, coordinate)
          / (2 * TOKEN_KERNEL_WIDTH * TOKEN_KERNEL_WIDTH));
        if (overlap >= ONE_SIGMA_OVERLAP) supporters += 1;
      }
      const coverage = supporters / ordered.length;
      commonValues[tokenIndex] = central;
      if (coverage >= COMMON_COVERAGE_MIN) {
        commonMask[tokenIndex] = 1;
        commonInput.push({
          tokenIndex,
          coordinate,
          standardizedValue: central,
          coverage,
        });
      }
    }
    const residuals = new Map<string, ResidualFieldState>();
    for (const field of ordered) {
      const values = new Float64Array(TOKEN_FIELD_WIDTH);
      let energy = 0;
      for (let tokenIndex = 0; tokenIndex < TOKEN_FIELD_WIDTH; tokenIndex += 1) {
        const current = field.tokens[tokenIndex]!.standardizedValue;
        const residual = commonMask[tokenIndex] === 1 ? current - commonValues[tokenIndex]! : current;
        values[tokenIndex] = residual;
        energy += residual * residual;
      }
      residuals.set(field.anchorId, { values: [...values], magnitude: Math.sqrt(energy) });
    }
    return { commonInput, residuals };
  }

  residualAgainst(
    field: EncodedTokenField,
    commonInput: readonly CommonFieldToken[],
  ): { readonly residual: ResidualFieldState; readonly contextMatch: number } {
    const commonByIndex = new Map(commonInput.map((token) => [token.tokenIndex, token]));
    const values = new Float64Array(TOKEN_FIELD_WIDTH);
    let energy = 0;
    let overlapSum = 0;
    for (const token of field.tokens) {
      const common = commonByIndex.get(token.tokenIndex);
      const residual = common === undefined
        ? token.standardizedValue
        : token.standardizedValue - common.standardizedValue;
      values[token.tokenIndex] = residual;
      energy += residual * residual;
      if (common !== undefined) {
        overlapSum += Math.exp(-squaredDistance(token.coordinate, common.coordinate)
          / (2 * TOKEN_KERNEL_WIDTH * TOKEN_KERNEL_WIDTH));
      }
    }
    return {
      residual: { values: [...values], magnitude: Math.sqrt(energy) },
      contextMatch: commonInput.length === 0 ? 0 : overlapSum / commonInput.length,
    };
  }
}

export function residualSimilarity(left: ResidualFieldState, right: ResidualFieldState): number {
  if (left.values.length !== right.values.length) throw new RangeError("residual widths differ");
  if (left.magnitude <= 1e-12 || right.magnitude <= 1e-12) {
    return left.magnitude <= 1e-12 && right.magnitude <= 1e-12 ? 1 : 0;
  }
  let product = 0;
  for (let index = 0; index < left.values.length; index += 1) {
    product += left.values[index]! * right.values[index]!;
  }
  const cosine = Math.max(-1, Math.min(1, product / (left.magnitude * right.magnitude)));
  const physicalOverlap = Math.exp(-((1 - Math.abs(cosine)) ** 2) / (2 * 0.90 ** 2));
  return cosine < 0 ? -physicalOverlap : physicalOverlap;
}

export function cloneCommonField(tokens: readonly CommonFieldToken[]): readonly CommonFieldToken[] {
  return tokens.map((token) => ({ ...token, coordinate: clone3(token.coordinate) }));
}
