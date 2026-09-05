# DESIGN-002 runtime measurement ingress evidence

## Scope and classification

This is one additive, V4-opt-in production seam. It is not a migration of the
default V3 runtime and is not a completion claim for DESIGN-002. A completed
real action can now carry its event identity, observed active time, and measured
goal-residual change to the V4 owner. The owner resolves physical structures
from committed R1/R2/R2A annotations and feeds the frozen timescale law. A
typed attention deviation is forwarded only when the attention comparison
actually produced one; unsupported changes remain unmeasured.

The memory clock and all three layer clocks advance together when a measurement
arrives after the event deposit. Runtime-level duplicate measurement for an
event is rejected. No new R1/R2/R2A evidence, support mass, relation, or
coordinate is created by this path.

## Focused verification

Command:

```text
npm run build --silent
node --test dist/test/runtime-v4-measurement-ingress.test.js dist/test/runtime-v4-timescale-persistence.test.js dist/test/control-habit-persistence.test.js dist/test/compute-timescale-v4-bridge.test.js dist/test/distributed-hierarchical-memory-v4-timescale.test.js
```

Result: build exit `0`; `12/12` tests passed, `0` failed, `0` skipped. The
measured focused test process wall time was `9049.8577 ms` and peak parent
process working set was `41.00 MiB` on this host. The set used one short-lived
Node worker and no external service.

## Boundary and deferred work

V3 behavior, the protected physics files, PredictionClone, model services,
Minecraft, Formal, and existing physical evidence remain unchanged. This
tranche does not implement passive-event salience, replay/homeostasis, or the
E1–E7 gates. Encoding-gain deposition is now covered by the separate
`design-002-encoding-gain-ingress-2026-09.md` tranche. Those remaining items
stay separate work packages;
the next review must not treat this focused seam as a full timescale or
capability validation.
