# DESIGN-002 staged adapter evidence (2026-09)

## Scope

This tranche adds the isolated `DistributedMediumTimescaleAdapterV2`. It
keeps a V1 medium instance and the V2 time state at one logical observation
time, derives recovery rates from measured components, and composes the strict
V2 protocol snapshot. It also adds a snapshot-only recovery transform that
applies the frozen law to measured structure inputs. Neither component is
imported by the production hierarchy.

## Reproducible commands

| Command | Result |
| --- | --- |
| `npm run build --silent` | exit 0 |
| `node --test dist/test/design-002-timescale-law.test.js dist/test/design-002-timescale-state.test.js dist/test/design-002-consolidation-replay.test.js dist/test/design-002-timescale-protocol.test.js dist/test/design-002-timescale-adapter.test.js dist/test/design-002-medium-recovery.test.js dist/test/prediction-deviation.test.js dist/test/attention.test.js` | 22/22, skipped 0 |
| `git diff --check` | exit 0 |

The focused command completed in under one second after compilation. No model,
Minecraft server, viewer, Formal V3 run, or live network service was started.

The first targeted run of the new recovery test was `21/22`: its duplicate
measurement assertion exposed a `Set.add` truthiness bug in the new transform.
The minimal fix changed the check to `has` followed by `add`; the final run
above is the post-fix result.

## Boundary and failure classification

- Physical V1 snapshots and production memory were not written.
- The adapter delegates recovery to V1; per-structure salience recovery is
  `DESIGN-002-production-protocol-deferred`. The snapshot transform is a
  deterministic pre-production implementation of that law and is not a live
  writer.
- Runtime-private measurement authority, replay writer integration and
  homeostasis wiring remain deferred.
- No test or command failed in the final run. The earlier `21/22` failure is
  retained as the implementation defect that the new test exposed; it was
  corrected in production code, not by weakening the assertion.
- Protected physics, PredictionClone and configuration files were not modified.

## Artifacts

- `src/core/physics/distributed-medium-timescale-adapter-v2.ts`
- `src/core/physics/distributed-medium-timescale-protocol-v2.ts`
- `test/design-002-timescale-adapter.test.ts`
- `test/design-002-timescale-protocol.test.ts`

## Follow-up: measured live adapter path (2026-09-05)

The staged adapter now applies `recoverDistributedMediumProtocolSnapshotV2`
to its live in-memory substrate whenever an ordered measured observation is
provided. Empty intervals retain the V1 base-rate path. This is a real
implementation of the isolated V2 law, not a caller-provided recovery rate;
the focused adapter/protocol/recovery set is now 8/8 after the added test.

This remains deliberately outside the production hierarchy. The production
owner still lacks a versioned V2 checkpoint, runtime-private measurement
capability (including post-event goal residual), and an approved replay writer.
Those are required before changing production recovery semantics.

The same follow-up also closed two measurement-boundary defects in the
snapshot transform: a structure-level measurement must name an actually
present `site:`, `trace:`, or `bond:` structure, and duplicate measurements for
one structure within a recovery interval are rejected locally. The generic
ordered batch validator intentionally continues to allow repeated structures
at different observation times; only the single-interval recovery transform
has the stricter one-value-per-structure contract.

Focused verification after this boundary fix: build exit 0 and 9/9
timescale/recovery/adapter tests passed. No production hierarchy, model,
Minecraft, or Formal V3 state was changed.

## Follow-up: identity-preserving medium seam

`DistributedPhysicalMedium3DV1` now exposes an in-place
`recoverWithStructureRates` seam. It applies structure-specific decay while
retaining the medium object identity held by R1/R2/R2A; replacing a medium
with `fromSnapshot` is therefore not required for a future production owner.
The seam rejects unknown structure IDs and keeps the existing `recover()` base
rate behavior unchanged. Build plus the affected medium/recovery/adapter set
passed 15/15. This is a preparation seam only: production hierarchy recovery
still uses the V1 path until the versioned V2 owner and trusted measurement
bridge are implemented together.

## Follow-up: measured-state persistence across empty intervals

Measured observations are now retained in the V2 time-state snapshot and are
reused by later recovery intervals that contain no new measurement. The staged
adapter therefore does not silently fall back to the legacy base rate after a
single measured observation. Assembly identities are also recognized by the
read-only structure validator. Empty-rate recovery avoids rebuilding the full
known-structure set, preserving the existing base-rate path's cost profile.

Focused verification after this follow-up: build exit 0 and 21/21 state,
recovery, adapter and medium tests passed. Production R1/R2/R2A ownership,
checkpoints and runtime measurement authority remain unchanged and deferred.

## Follow-up: boundary hardening

The isolated tranche now treats a measured observation as valid only for the
immediately following recovery interval; stale observations are retained for
audit but do not impose an indefinitely slow rate. V2 protocol composition and
restore require medium and timescale logical clocks to be equal, and measured
observations cannot lie ahead of the timescale clock. Replay execution uses the
canonical law constants internally rather than caller-provided refresh or
homeostatic factors. Focused state/recovery/protocol/adapter/replay tests pass
26/26 after these boundary checks. These changes remain pre-production.
