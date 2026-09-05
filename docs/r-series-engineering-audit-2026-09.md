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
- DESIGN-002 now has an isolated law kernel, strict V2 time-state, an
  idle-only replay whitelist planner, and a strict V2 protocol envelope with
  ordered measured-observation validation for continuous measured salience,
  autonomous arousal evolution, bounded encoding gain, homeostatic scaling and
  rehearsal counts. Attention now has an isolated, bounded deviation
  measurement derived from supported predictions and observed changes. The
  staged V1/V2 logical-clock adapter keeps both snapshots aligned and applies
  the snapshot transform to its own live staged substrate when measured input
  is supplied. A snapshot-only V2 recovery transform applies the frozen law to
  measured structure inputs without mutating live production.
  The
  distributed medium remains on its V1 protocol until the envelope, private
  measurement path and an approved replay writer are implemented together;
  these additions are not wired as a hidden V1 compatibility patch.
  The latest isolated follow-up persists the last measured structure
  observations in V2 time state and applies them across later unmeasured
  intervals; this remains staged-only and does not alter the V1 production
  hierarchy.
  A subsequent boundary hardening limits a stored measurement to the next
  recovery interval, requires equal medium/time clocks, and binds replay
  parameters to the canonical law; no production owner consumes these APIs.
- DESIGN-001 L1 now has a small runtime-owned interoceptive channel module.
  Channels are frozen before an action, carried with the trusted event as
  `verified-internal` metadata, and deliberately kept out of public
  `Observation.self.properties`. When the controller snapshot has the relevant
  fresh state, all six declared bounded signals are computed: branch entropy,
  prediction support, applicable-relation fraction, attention-derived surprise
  rate, goal residual and remaining action budget. Missing source state leaves
  that channel unavailable rather than inventing a zero. The L2 meta-relation
  learner, authority mapping and external oscillator remain deferred. These
  channels are currently provenance transport only: `eventRows` and the
  afferent projection do not consume them, so they do not yet alter R1/R2/R2A
  evidence.
- DESIGN-001 L2 now has an isolated meta-evidence index with fixed eight-band
  quantization, deposition-ordinal episode reconstruction, and external ×
  internal joint-context qualification. Trusted runtime events now carry this
  index in the optional distributed-memory snapshot field, including explicit
  unknown-channel observations so missing values do not fabricate episode
  exits. It remains disconnected from world R2A grading and controller
  authority; its `meta-predictive-stable` label is coverage-only and has zero
  behavioral authority.

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

The current L1 implementation is deliberately bounded rather than authoritative:
the six signals are engineering summaries of already-held controller and
attention state, not learned causal variables. In particular, applicable-relation
and surprise-rate are aggregate fractions, and they carry no authority to grade
world evidence. A stronger runtime-only provenance capability is still not
implemented; a structurally valid forged V6 payload remains a known boundary.

## Deferred work

DESIGN-002 (the sole protocol revision), DESIGN-004, DESIGN-005, DESIGN-003b,
PLAN-003 and PLAN-004 are not implemented here. DESIGN-001 authority mapping,
intervention oscillator and production meta-R2A wiring remain deferred. G3/G4 and the
note=2 intervention design remain unresolved project-level gates. Full suite,
capacity sweep and temporal experiment execution are intentionally deferred to
the next review round as requested.
