/**
 * Minecraft is an adapter, not part of the prototype's physical/control API.
 * Keep all Mineflayer, server-process and live-runtime imports behind this
 * boundary so another environment can consume `src/prototype.ts` directly.
 */
export { MinecraftBody } from '../../body.js';
export { Services, loadConfiguration, offlineProfile } from '../../services.js';
export type { Configuration, MinecraftFixtureModeV1 } from '../../services.js';
export { V5Runtime, restoreExperience, restoreExperienceV4,
  assertNewExperienceOutput } from '../../runtime.js';
export type { ExperiencePointer, RestoredExperience,
  RestoredDistributedExperienceV2, RestoredDistributedExperienceV4,
  DistributedExperiencePointerV2, DistributedExperiencePointerV4 } from '../../runtime.js';
