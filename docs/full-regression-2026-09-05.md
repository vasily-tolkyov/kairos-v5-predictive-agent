# Full regression record (2026-09-05)

## Commands

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run build --silent` | 0 | TypeScript build passed |
| `npm test` | 0 | 571 passed, 0 failed, 2 skipped |

The test process duration was approximately 756 seconds. The two skipped tests
are explicitly opt-in diagnostic runs requiring
`KAIROS_RUN_R2A_PRECONSOLIDATION_DIAGNOSTIC=1` and
`KAIROS_RUN_REAL_G5_TWO_STEP=1`; they were not silently counted as passes.

## Post-recovery-transform rerun

After the isolated `DistributedMediumRecoveryV2` transform and duplicate-
structure validation fix, the same commands were run once more:

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run build --silent` | 0 | TypeScript build passed |
| `npm test` | 0 | 573 passed, 0 failed, 2 skipped |

The rerun duration was `796833.4638 ms`. The skipped tests and their explicit
environment gates are unchanged. This is the authoritative regression result
for the current source after the recovery transform; it does not promote the
staged DESIGN-002 work to production.

## Scope and boundaries

- The full suite includes the existing R1/R2/R2A, PredictionClone, control,
  attention, lifecycle, and Minecraft adapter checks plus the new DESIGN-002
  law, protocol, replay and measured-deviation tests.
- No Minecraft server, model service, viewer, Formal V3 run, or live network
  service was started by this command.
- No production snapshot or physical medium was written by the test suite.
- The four protected physics/PredictionClone files were not changed by this
  tranche; the new behavior remains staged and production V1 remains active.

## Classification

Regression status: **green for the current source scope**. DESIGN-002 remains
partially implemented: V2 per-structure recovery, runtime-private measurement
authority, production replay writer and homeostatic wiring still require their
own protocol tranche and E1–E7 validation.
