# DESIGN-001 authority and oscillator slice (2026-09)

This slice adds two law-level helpers without changing the running controller:

- `experimentOscillatorSlotV1(activeSeconds, runSeed)` produces a deterministic,
  phase-locked intervention slot from active experience time and a run seed.
  It does not inspect goals, field state, outcomes, or controller state.  The
  schedule is therefore fixed before an intervention result exists.
- `metaAuthorityDecisionV1(grade, prospectiveValidation)` maps an already
  qualified meta-evidence grade to a bounded drive bias.  Authority is exactly
  zero during prospective validation, `0.10` for `meta-predictive-stable`, and
  `0.20` for `meta-intervention-supported`; repeated or insufficient evidence
  has zero authority.

The helpers are intentionally isolated.  No caller can use them to create a
meta relation, raise a world-relation grade, inject internal channels, or
dispatch an override.  Production controller wiring, meta-R2A qualification,
and intervention execution remain separate gated work.  The existing V3
controller and V4 opt-in timescale/replay path are unchanged.

## Focused verification

```text
npm run build --silent                         exit 0
node --test dist/test/design-001-authority-oscillator.test.js \
  dist/test/design-002-production-replay.test.js  5/5 passed, 0 skipped
```

Full regression, model, Minecraft, Formal V3, and production meta-authority
experiments are intentionally deferred to the next review round.
