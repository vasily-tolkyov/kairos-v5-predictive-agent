# DESIGN-002 production replay wiring (2026-09)

This tranche connects the already frozen consolidation planner to the opt-in
V4 distributed memory.  The ordinary V3 memory path remains unchanged and
cannot reach replay.

## Runtime boundary

`DistributedHierarchicalPhysicalMemoryV1.replayIfIdleV1` accepts the four
controller-owned idle signals (goal, pending attention, novelty and unknown),
and returns `null` unless the existing idle law accepts them.  It selects
already-deposited footprints independently in R1, R2 and R2A with stable
layer-specific seeds.  All selected plans are validated before the first write.

The live medium is exposed through `DistributedMediumReplayWriterV1`.  Its
whitelist can only:

- refresh the potential of an existing site by the fixed replay increment;
- strengthen an existing learned bond without changing its support mass;
- record a rehearsal in the owning V4 timescale state; and
- apply the fixed homeostatic potential downscale.

It cannot create a site, bond, footprint, R2A relation or evidence.  Replay
does not call the trusted-real-event writer and does not alter a footprint's
support mass.  A read-only prediction cache is invalidated after a successful
replay so subsequent queries see the new physical potential.

The V4 owner records rehearsal under the same opaque `trace:<id>` structure
identity used by measured recovery.  This affects the law-derived future
recovery rate, not the historical evidence count.  The three layer snapshots
remain aligned at the same logical time.

## Evidence boundary

The focused production tests demonstrate: deterministic idle gating, V3
inaccessibility, existing-site-only refresh, unchanged support/evidence, bond
support preservation, rehearsal persistence and homeostasis.  They do not
claim E1–E7 qualification, broad passive-event qualification, or a completed
Minecraft capability run.  Full regression and the remaining R-series gates
are intentionally deferred to the next review round.
