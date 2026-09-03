import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftHierarchicalShortChainLiveV1 } from
  '../dist/src/evaluation/minecraft-hierarchical-short-chain-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
// Never reuse a sealed attempt directory.  A current run starts from an empty
// hierarchy, forms physical road-density patterns, and performs its own
// prospective interventions.  Old evidence/checkpoints are not inputs.
const evidenceName = process.env.KAIROS_HIERARCHICAL_SHORT_CHAIN_EVIDENCE_NAME;
if (!/^hierarchical-minecraft-short-chain-live-v1-v13-attempt-[0-9]{3}$/.test(evidenceName ?? '')) {
  throw new Error('hierarchical-short-chain-v13-evidence-name-required');
}
const evidence = resolve(project, 'evidence', evidenceName);
const config = await loadConfiguration();
const result = await runMinecraftHierarchicalShortChainLiveV1(config, evidence);
console.log(JSON.stringify(result));
