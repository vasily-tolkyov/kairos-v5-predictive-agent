# R-series tranche evidence (2026-09-05)

This is the read-only engineering evidence for the current additive tranche.
It is not a model, Minecraft, Formal V3, or production-capability result.

## Scope

- PLAN-001 repairs were carried forward from the reviewed baseline.
- PLAN-002 read-only revision-scoped cache and exact seed-batch surfaces.
- DESIGN-006 temporal-fidelity probe and DESIGN-003a capacity probe.
- DESIGN-001 L1 runtime-owned interoceptive provenance and isolated L2
  meta-evidence episode index.
- DESIGN-002 isolated tranche: continuous measured salience, autonomous
  arousal, bounded encoding gain, homeostatic scaling and strict V2 time-state
  restore primitives, an isolated idle replay whitelist planner, a strict V2
  protocol envelope with ordered measurement validation, and an isolated
  attention deviation measurement plus a staged V1/V2 logical-clock adapter.

## Reproducible checks

| Command | Result |
| --- | --- |
| `npm run build --silent` | exit 0 |
| `node --test dist/test/design-001-meta-evidence.test.js dist/test/design-001-interoception.test.js dist/test/plan-002-performance.test.js dist/test/design-006-temporal-fidelity.test.js dist/test/design-003a-capacity-probe.test.js` | 17/17, skipped 0 |

The focused checks cover deterministic eight-band quantization, deposition
ordinal episode splitting, joint-context gating, snapshot replay, V6 internal
metadata validation, six-channel pre-outcome summaries (including freshness
filtering), exact worker ordering, and read-only temporal/capacity probes.

## Physical and runtime boundary

- No model, Minecraft server, viewer, Formal V3, or live network service was
  started in this tranche.
- No production memory snapshot, R1/R2/R2A medium, or protected physics file
  was written by the probes; the runtime snapshot path persists the index only
  after an enriched trusted event supplies a band.
- The L2 index is not connected to world R2A grading or controller authority.
- The DESIGN-002 primitives and V2 time-state are not connected to the V1
  medium recovery path; the isolated replay planner has no production writer,
  no V1 snapshot was modified and no replay write occurred.
- The internal channel metadata is not yet consumed by `eventRows` or the
  world afferent projection; it is provenance transport only. The additional
  prediction, applicability and attention fields are bounded summaries of
fresh controller state, not causal evidence or controller authority.

The additional DESIGN-002 direct checks are recorded separately in
`docs/design-002-timescale-law-tranche-2026-09.md` (12/12); they do not exercise
the V1 recovery path.

## Known open classifications

- `DESIGN-001-L2-provenance-firewall`: V5 injection is rejected, while a
  structurally valid forged V6 still needs a runtime-private capability before
  any meta grade can be promoted.
- `DESIGN-001-production-wiring`: snapshot persistence is wired, but meta
  episodes are not passed through R2/R2A event state and cannot raise any world
  evidence grade.
- `DESIGN-002-protocol-deferred`: the law, isolated V2 state, idle replay
  whitelist planner and protocol envelope are present, but the versioned
  production medium snapshot, private measurement capability, approved writer
  and replay/homeostasis wiring remain gated on the next separately approved
  tranche. The attention deviation value is currently read-only and has no
  medium-writing authority; the clock adapter still delegates recovery to V1.
- Full regression, capacity sweep and temporal experiment remain deferred to
  the next review round by request.

## Repositories

The source checkout is `D:\kimi_kairos\kairos-v5-predictive-agent`; the original
`D:\Kairos_V5_Predictive_Agent` checkout remains untouched. The previous
  tranche was pushed as `360e7b1`; the DESIGN-002 law/state and isolated replay
  additions are recorded in the subsequent repository commits.
