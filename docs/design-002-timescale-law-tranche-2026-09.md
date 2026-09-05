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

The state is intentionally not wired into production medium writes yet. It
does not accept a caller-provided final salience or recovery rate, does not
touch support mass/evidence, and does not introduce replay into the V1 medium.
The next D002 tranche must bind this state to a new physical-medium protocol,
provide a runtime-private measurement path, add the replay whitelist and run
the full E1–E7 gates; these primitives are not evidence that D002 is complete.

## Focused checks

`npm run build --silent` and
`node --test dist/test/design-002-timescale-law.test.js dist/test/design-002-timescale-state.test.js` pass (7/7). Full regression
and the required G0/G1/G2/G5 re-qualification remain deferred by the current
execution scope.

## Boundary classification

- Law primitives: **implemented**.
- Isolated V2 arousal/rehearsal state and strict restore: **implemented**.
- Production salience-conditioned recovery: **deferred**.
- Arousal wired into the physical medium: **deferred**.
- Idle replay and homeostasis wiring: **deferred**.
- E1–E7 experimental validation: **not run**.
