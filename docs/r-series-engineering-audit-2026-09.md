# R-series engineering/code audit (2026-09)

This audit closes the current upgrade tranche without claiming that the later
research designs are implemented.

## Implemented in this tranche

- PLAN-001's distributed readout, contradiction accounting and novelty changes
  are present in the clone and remain isolated from the original checkout.
- PLAN-002 adds in-process revision-scoped read-only substrate caches and
  explicit exact seed-batch surfaces. The default production reasoning path is
  still serial; parallel workers are opt-in and preserve seed order.
- DESIGN-006 and DESIGN-003a are evaluation-only runners. They create fresh
  memory instances from caller fixtures and do not write project evidence or
  production snapshots unless an explicit output path is supplied.

## Theory boundary

The current distributed medium exposes an engineering attractor readout
(terminal residence, return and escape). This is not, by itself, evidence of a
mathematical REACT fixed-point anchor with a proved Jacobian, residual or
escape-action quantity. Those measurements belong to a later theory/experiment
decision and were not smuggled into this implementation.

The control field's recurrent and inhibitory coefficients are fixed protocol
laws. Learned meta-representation, salience-conditioned recovery, homeostasis,
and control-learning arbitration remain separate gated designs. No caller may
inject an internal meta-channel or use a metadata grade to raise a world
evidence grade.

The temporal probe compares physical terminal status and reached assembly
identity. The current PredictionClone has no public semantic decoder, so the
probe intentionally does not claim decoded public-change equivalence. The
capacity probe likewise leaves readout rates `null` when a fixture has not
provided measurements; it never fabricates a score from event counts.

## Deferred work

DESIGN-001, DESIGN-002 (the sole protocol revision), DESIGN-004, DESIGN-005,
DESIGN-003b, PLAN-003 and PLAN-004 are not implemented here. G3/G4 and the
note=2 intervention design remain unresolved project-level gates. Full suite,
capacity sweep and temporal experiment execution are intentionally deferred to
the next review round as requested.
