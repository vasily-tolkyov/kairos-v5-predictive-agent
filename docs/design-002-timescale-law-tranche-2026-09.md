# DESIGN-002 timescale law tranche (2026-09)

This tranche isolates the law-level functions needed by the R4 protocol
revision before touching the distributed-medium snapshot version.

Implemented in `src/core/learning/memory-timescales.ts`:

- continuous salience derived from measured surprise, goal relevance, support
  mass and rehearsal count;
- monotone, bounded effective recovery rate with the existing base rate
  `0.002` at zero salience;
- autonomous arousal state driven by measured surprise flux and decayed by
  elapsed experience time;
- bounded encoding gain and fixed-factor homeostatic downscale.

The module is intentionally not wired into production medium writes yet. It
does not accept a caller-provided final salience or recovery rate, does not
touch support mass/evidence, and does not introduce replay or a new snapshot
version. The next D002 tranche must add the versioned medium state, a private
measurement path, replay whitelist and full E1–E7 gates together; these
functions are not evidence that D002 is complete.

## Focused checks

`npm run build --silent` and
`node --test dist/test/design-002-timescale-law.test.js` pass. Full regression
and the required G0/G1/G2/G5 re-qualification remain deferred by the current
execution scope.

## Boundary classification

- Law primitives: **implemented**.
- Production salience-conditioned recovery: **deferred**.
- Arousal as a medium-owned snapshot state: **deferred**.
- Idle replay and homeostasis wiring: **deferred**.
- E1–E7 experimental validation: **not run**.
