import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runCapacityProbeV1 } from '../dist/src/evaluation/capacity-probe-v1.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
if (!values.input) throw new Error('capacity-probe-requires-input');
const fixture = JSON.parse(await readFile(resolve(values.input), 'utf8'));
if (!fixture || typeof fixture !== 'object' || !Array.isArray(fixture.levels))
  throw new Error('capacity-fixture-requires-levels');
const report = runCapacityProbeV1(fixture.levels);
if (values.output) {
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ version: report.version,
  levels: report.points.length }, null, 2)}\n`);
