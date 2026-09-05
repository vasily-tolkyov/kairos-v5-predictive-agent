# DESIGN-002 encoding-gain ingress (2026-09)

This tranche connects the already-frozen V4 arousal law to real R1, R2 and
R2A plastic deposition. It is deliberately separate from passive-event
salience, replay and homeostasis.

## Contract

The timescale owner is the only source of the gain. Each layer exposes a
read-only `encodingGain(layer)` derived from its own medium arousal and the
canonical law. The learning stores receive that value through an internal
provider; callers cannot provide salience, a recovery rate, a physical site,
or an evidence count.

The medium's V4 deposit path scales fast activation, potential learning and
bond coupling. It does **not** scale the trusted evidence count: site, bond,
and returned-footprint `supportMass` remain tied to the actual episode
strength (one for a normal event). Directed temporal fibres receive the same
plastic gain while their support count remains uninflated. The legacy
`applyEpisode` path remains gain `1` and therefore preserves the default V3
behavior.

## Verification

`test/design-002-runtime-encoding-gain.test.ts` compares two identical V4
memories. One receives a measured prediction deviation before the second
event; the other does not. The aroused memory has a strictly larger potential
increment for the same R1 footprint, while both footprints and site support
count exactly one event. A second test proves gain `1` is byte-equivalent to
the legacy medium method. The existing V4 ingress, persistence, bridge and
R1/R2/R2A focused tests also pass.

Commands:

```text
npm run build --silent
node --test dist/test/design-002-runtime-encoding-gain.test.js \
  dist/test/runtime-v4-measurement-ingress.test.js \
  dist/test/distributed-hierarchical-memory-v4-timescale.test.js \
  dist/test/compute-timescale-v4-bridge.test.js
node --test dist/test/r2-continuous-event.test.js \
  dist/test/r2a-stable-pattern.test.js \
  dist/test/r2a-projected-relation.test.js \
  dist/test/distributed-r2a-consolidation-batch.test.js
```

Results: build exit `0`; new gain set `2/2` passed with no skips; V4 owner/
bridge/persistence set `7/7` passed with no skips; second
R2/R2A set `50/50` passed with no skips. A broader R2/R2A process was stopped
after it continued consuming substantial CPU without producing new failures;
its partial output is not counted as a pass.

## Boundary

No model, Minecraft, Formal, replay writer, or E1-E7 qualification was run;
broad passive-event qualification remains outstanding. This is an additive
V4-opt-in law connection, not a claim that DESIGN-002 is complete. The
distributed medium source is changed
only to expose the law-derived plastic-gain path; the underlying random field,
Metropolis dynamics, recovery constants and PredictionClone semantics are
unchanged.
