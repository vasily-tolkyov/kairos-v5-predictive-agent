# Distributed R2A physical V2 red-test summary

Date: 2026-09-01

Scope: `test/distributed-r2a-physical-v2.red.test.ts`.  The run intentionally
did not modify the production R2A learner and did not execute the historical
or Minecraft suites.

## Commands

- `npm run build`: exit `0` after one test-only readonly-cast correction.
- `node --test dist/test/distributed-r2a-physical-v2.red.test.js`: exit `1`,
  `0/9` passed, `9/9` failed as required before the V2 implementation.

## Independently exposed failures

1. A complete R2 pulse is still hashed into `R2PopulationAssemblyInR2AV1`.
2. Pattern selection still uses action-family identity, Jaccard similarity and
   a set/hitting-set factor classifier instead of attractor/corridor probes.
3. Production still accepts caller-provided `selectedExpectedBranch` and
   `deletionSelectionDrop` intervention conclusions.
4. The hierarchical production memory still owns
   `DistributedR2AStablePatternLearnerV1` and V1 state.
5. `DistributedR2APhysicalPatternLearnerV2` does not yet exist, so the balanced
   anonymous q/s physical-factor gate cannot run.
6. The transient R3 condition switch cannot yet be shown to alter a physical
   branch probability without writing the medium.
7. Raw searchable event-index deletion cannot yet be shown to preserve learned
   physical behaviour.
8. Clearing sites and learned bonds while retaining metadata cannot yet be
   shown to eliminate the branch capability through the V2 API.
9. Four real matched q interventions cannot yet derive full-factor selection,
   factor-ablated selection and the resulting evidence grade from the field.

The dynamic fixtures use anonymous R2 populations and a balanced 2x2 design:
q selects one of two terminal corridors while s occurs equally in both arms.
They do not contain Minecraft types, action answers or result-side scoring
labels.

## Production-layout migration

After the V2 implementation moved to
`src/core/learning/distributed-r2a-physical.ts`, the tests were updated to read
both the thin production export surface and that implementation.  The
intervention scan now reads only
`distributed-r2a-physical-contracts.ts`; the retired V1 contracts are not
treated as production.

Migration verification:

- `npm run build`: exit `0`.
- `distributed-physical-semantics-no-approximation.test.js`: `11/11`, exit `0`.
- The four source/contract gates in
  `distributed-r2a-physical-v2.red.test.js`: `4/4`, exit `0`.

The five dynamic q/s, R3, metadata, damage and intervention gates were not run
during this layout-only migration, because they perform repeated physical
field training/probes and are not needed to establish that source inspection
now targets the correct production files.

## Strong reverse-ablation additions

Three additional gates were added after the V2 surface existed.  Their first
focused run was intentionally red (`0/3`, exit `1`) without running Minecraft
or the complete physical-training fixture:

1. `physicalBranches()` and `probePhysicalBranches(...)` must recover anonymous
   branches from the medium after `patterns`, `relations`, `evidenceEvents` and
   `eventInputs` are removed.  Current failure: the metadata-free physical scan
   API does not exist.
2. Keeping site wells while setting every learned bond's
   `directedConductance` to zero must preserve anonymous attractors but reduce
   conditional branch selection to zero.  Current failure: the same missing
   physical scan/probe API prevents this reverse ablation.
3. Intervention input may contain only its two real event references and a
   version.  Canonical pair identity, relation, factor, reached branch and
   ablation loss must all be field-derived.  Current failure: production still
   reads caller `pairId`, `relationId` and `changedFactorId`, so the same real
   pair can be relabelled and counted again.
