import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { replayMinecraftMultilevelRun003V1 } from '../dist/src/evaluation/replay-minecraft-multilevel-run003-r2a-v1.js';

const positional = process.argv.slice(2).filter(value => value !== '--output'
  && process.argv[process.argv.indexOf(value) - 1] !== '--output');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex < 0 ? null : resolve(process.argv[outputIndex + 1]);
const sourceDirectory = resolve(positional[0] ??
  'D:/Kairos_V5_Predictive_Agent/evidence/minecraft-multilevel-guided-training-live-v1-run-003');
const result = await replayMinecraftMultilevelRun003V1(sourceDirectory,
  completed => process.stderr.write(`replayed ${completed}/256\n`));
const serialized = `${JSON.stringify(result.audit)}\n`;
if (outputPath) {
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
