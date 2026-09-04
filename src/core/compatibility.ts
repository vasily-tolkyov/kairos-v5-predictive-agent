/**
 * Canonical identities for the current V5 distributed runtime.
 *
 * Keeping these values in one small, dependency-free module prevents prose,
 * checkpoint writers and readers from silently drifting to different protocol
 * names.  The strings are protocol identities, not feature flags; changing one
 * requires a new checkpoint/schema version.
 */
export const KAIROS_V5_RUNTIME_VERSION =
  'KairosV5DistributedPhysicalRuntimeV1' as const;
export const KAIROS_V5_MEMORY_VERSION =
  'KairosV5DistributedPhysicalMemoryV3' as const;
export const KAIROS_V5_MEMORY_SEMANTICS =
  'distributed-R1-attractor_R2-site-fibre-continuity_R2A-physical-branch-field_R3-transient-current-input' as const;
export const KAIROS_V5_CONTEXT_VERSION = 'V5PublicRelativeLayoutV1' as const;
export const KAIROS_V5_CONFIG_VERSION = 'KairosV5PhysicalControlConfigV2' as const;

export const KAIROS_V5_COMPATIBILITY = Object.freeze({
  runtime: KAIROS_V5_RUNTIME_VERSION,
  memory: KAIROS_V5_MEMORY_VERSION,
  memorySemantics: KAIROS_V5_MEMORY_SEMANTICS,
  context: KAIROS_V5_CONTEXT_VERSION,
  config: KAIROS_V5_CONFIG_VERSION,
});
