import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runTemporalFidelityProbeV1 } from '../dist/src/evaluation/temporal-fidelity-probe-v1.js';

const { values } = parseArgs({ options: {
  input: { type: 'string' }, output: { type: 'string' },
} });
if (!values.input) throw new Error('temporal-fidelity-probe-requires-input');
const fixture = JSON.parse(await readFile(resolve(values.input), 'utf8'));
if (!fixture || typeof fixture !== 'object' || !fixture.snapshot || !Array.isArray(fixture.cases))
  throw new Error('temporal-fidelity-fixture-requires-snapshot-and-cases');
const cases = fixture.cases.map((value) => ({ ...value,
  seeds: (value.seeds ?? []).map((seed) => BigInt(seed)),
}));
const report = runTemporalFidelityProbeV1(fixture.snapshot, cases);
if (values.output) {
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, (_key, value) =>
    typeof value === 'bigint' ? `0x${value.toString(16)}` : value, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ version: report.version,
  caseCount: report.cases.length, hypothesisPasses: report.hypothesisPasses }, null, 2)}\n`);
