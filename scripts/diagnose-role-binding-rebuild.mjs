import { resolve } from 'node:path';
import { Compute } from '../dist/src/compute.js';
import { readLegacyHierarchicalMemoryV9LiveV1,
  rebuildHierarchicalRoleBindingsFromTrustedEvidenceLiveV1 }
  from '../dist/src/evaluation/rebuild-hierarchical-role-bindings-live-v1.js';

const source = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('trusted-source-directory-required');
const compute = new Compute();
try {
  const legacy = await readLegacyHierarchicalMemoryV9LiveV1(source);
  const result = await rebuildHierarchicalRoleBindingsFromTrustedEvidenceLiveV1(compute, source, legacy);
  process.stdout.write(`${JSON.stringify(result.audit, null, 2)}\n`);
} finally {
  await compute.close();
}
