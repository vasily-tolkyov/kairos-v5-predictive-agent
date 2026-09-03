import { isAbsolute, resolve } from 'node:path';
import { rebuildTrustedAttempt018R1BaselineV1 } from
  '../dist/src/evaluation/rebuild-minecraft-distributed-g6-r1-baseline-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);

function requiredAbsolute(name) {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name}-absolute-path-required`);
  return value;
}

// This command accepts raw frames, receipts and protocol only.  There is no
// legacy checkpoint/coordinate option by design, and the output directory must
// not already exist.
const source = requiredAbsolute('KAIROS_DISTRIBUTED_G6_ATTEMPT018_SOURCE');
const output = requiredAbsolute('KAIROS_DISTRIBUTED_G6_R1_REBUILD_OUTPUT');
const result = await rebuildTrustedAttempt018R1BaselineV1(source, output);
console.log(JSON.stringify(result));
