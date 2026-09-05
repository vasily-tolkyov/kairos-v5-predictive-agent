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
