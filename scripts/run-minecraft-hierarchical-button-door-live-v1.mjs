import { resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { runMinecraftHierarchicalButtonDoorLiveV1 } from
  '../dist/src/evaluation/minecraft-hierarchical-button-door-live-v1.js';

const project = resolve(import.meta.dirname, '..');
process.chdir(project);
const evidenceName = process.env.KAIROS_BUTTON_DOOR_EVIDENCE_NAME
  ?? 'hierarchical-button-door-live-v1-attempt-011';
if (!/^hierarchical-button-door-live-v1-attempt-[0-9]{3}$/.test(evidenceName))
  throw new Error(`invalid-button-door-evidence-name:${evidenceName}`);
const evidence = resolve(project, 'evidence', evidenceName);
const result = await runMinecraftHierarchicalButtonDoorLiveV1(await loadConfiguration(), evidence);
process.stdout.write(`${JSON.stringify({ evidence, result }, null, 2)}\n`);
