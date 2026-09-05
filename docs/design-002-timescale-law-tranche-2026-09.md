# DESIGN-002 timescale law tranche (2026-09)

This tranche isolates the law-level functions and the independent V2
time-state needed by the R4 protocol revision before touching the V1
distributed-medium recovery path.

Implemented in `src/core/learning/memory-timescales.ts`:

- continuous salience derived from measured surprise, goal relevance, support
  mass and rehearsal count;
- monotone, bounded effective recovery rate with the existing base rate
  `0.002` at zero salience;
- autonomous arousal state driven by measured surprise flux and decayed by
  elapsed experience time;
- bounded encoding gain and fixed-factor homeostatic downscale.
- a strict `DistributedMediumTimescaleSnapshotV2` carrying medium-owned
  arousal, logical time and deterministic rehearsal counts.
- a deterministic idle-only consolidation replay planner with a narrow writer
  port that can refresh existing potential/bonds and rehearsal counts, but
  cannot create support mass, evidence, or new physical structures.
- a strict V2 protocol envelope that composes the existing V1 medium snapshot
  with the medium-owned timescale snapshot and law identity, plus ordered
  measured-observation validation.
- a read-only attention comparison that emits a bounded deviation magnitude
  from supported predicted changes versus observed public changes; unsupported
  predictions remain unmeasured.
- a staged clock adapter that keeps a V1 medium instance and V2 time state at
  one logical observation time, while explicitly delegating recovery to V1
  until the production protocol revision is approved.
- a snapshot-only V2 recovery transform that applies the frozen law to
  measured per-structure inputs and preserves all evidence fields; duplicate
  structure measurements in one interval are rejected rather than silently
  overwritten. Measured observations are retained for audit and are applied
  only to the immediately following recovery interval; stale observations do
  not create indefinite salience. Protocol compose/restore requires equal
  medium and timescale clocks, and replay execution binds refresh values to
  the canonical law constants.
- a staged `RuntimeMeasuredSalienceBridgeV1` that derives protocol measurements
  from attention deviation, goal-residual change and support read from an
  existing physical structure; it accepts no caller-supplied recovery rate or
  support mass.

The V2 envelope remains a versioned contract boundary. A
runtime-private, V4-opt-in measurement path now routes bounded action outcomes
through the trusted owner, and that owner's arousal-derived encoding gain is
applied to R1/R2/R2A plastic deposition without inflating evidence support;
the ordinary V3 runtime remains unchanged. The V4 owner now also exposes the
idle-gated replay writer/homeostasis path; broad passive-event qualification and
the full E1–E7 gates are still deferred, so these primitives are not evidence
that D002 is complete.

## Focused checks

`npm run build --silent` and
`node --test dist/test/design-002-timescale-law.test.js dist/test/design-002-timescale-state.test.js dist/test/design-002-consolidation-replay.test.js dist/test/design-002-timescale-protocol.test.js` pass (12/12). Full regression
and the required G0/G1/G2/G5 re-qualification remain deferred by the current
execution scope.

## Boundary classification

- Law primitives: **implemented**.
- Isolated V2 arousal/rehearsal state and strict restore: **implemented**.
- V2 protocol envelope and ordered measurement boundary: **implemented in
  isolation**.
- Attention deviation measurement: **implemented in isolation**; action-outcome
  arousal injection and V4 encoding-gain deposition are **implemented in the
  opt-in owner seam**, including the V4 passive-event runtime path; broad
  passive-event qualification remains **deferred**.
- V1/V2 logical-clock adapter: **implemented in isolation**; production medium
  replacement and per-structure recovery are **deferred**.
- V2 snapshot recovery transform: **implemented in isolation**; live medium
  mutation and full E1–E7 validation are **deferred**.
- Runtime measurement bridge: **implemented**; trusted action-outcome ingress
  is **implemented as an explicit V4 opt-in**, while broad passive-event
  qualification and full production checkpoint policy remain **deferred**.
- Replay's narrow writer now requires explicit site/bond existence checks, so
  the whitelist cannot silently create structures absent from the substrate.
- A staged `DistributedHierarchicalTimescaleOwnerV1` now owns one V2 time
  state beside each R1/R2/R2A medium reference, advances all three on one
  logical clock, applies measured rates in place, and restores byte-stably.
  It is a versioned owner seam, not yet the V1 hierarchy checkpoint.  The
  additive `KairosV5DistributedPhysicalMemoryV4` checkpoint can opt in to
  this owner and restore its time state onto the existing layer references;
  the default V3 snapshot and recovery path remain unchanged.  Same-time
  measurements are processed, and all layer measurements are validated before
  any layer mutates (cross-layer validation is atomic).  Mid-interval
  measurements affect only the recovery segment after their actual observation
  time; the earlier segment retains the base rate.
  `Compute`/`worker` now expose explicit `enableTimescaleV2`,
  `advanceMeasured`, `snapshotV4` and `restoreV4` calls for this opt-in seam;
  the ordinary Runtime saver and V3 restore path still do not select it.
- Production salience-conditioned recovery: **deferred**.
- Arousal wired into V4 action/passive-event plastic deposition: **implemented
  in the opt-in owner seam**; default V3 remains unchanged.
- Idle replay planner, whitelist and V4 production writer/homeostasis wiring:
  **implemented behind explicit opt-in**; default V3 remains unchanged.
- E1–E7 experimental validation: **not run**.
