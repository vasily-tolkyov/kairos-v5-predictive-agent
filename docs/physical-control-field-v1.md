# Transient physical control fields V1

Status labels:

- Existing physical memory and body boundaries: `implemented`.
- Coupled fields replacing a language-model analysis core: `hypothesis` until the neutral two-step experiment passes.
- Minecraft button-door behavior: not validated until a real run produces the full evidence chain.

Each joint site represents one `(operation × branch)` pair.  The eight
operations are `recall-effect`, `compare-condition`, `predict-branch`,
`expand-condition`, `execute`, `observe-public`, `finish-verified`, and
`finish-unknown`.  Every site carries the six transient branch signals (goal
difference, condition, binding, rollout, unknown, and attention/competition)
and competes in one leaky coupled field.  The configured seeded noise source,
`dt=0.02`, maximum 500 integration steps, threshold `0.65`, margin `0.10`,
and 20-step persistence are unchanged; no winner is returned unless those
physical convergence conditions hold.

Branch competition uses `W+ = 0.70` recurrent self-excitation and `W- = 2.00` summed lateral inhibition. `W+` remains weaker than the unit leak, so a weak isolated input cannot self-amplify into a decision. Summed inhibition makes an exactly symmetric multi-candidate state unstable; the configured physical noise only breaks that symmetry. `W- = 2.00` is the smallest tested value for which a read-only replay of all 269 branch-input cycles from the first two real runs converged (`1.80`: 2 failures; `2.00`: 0); it does not depend on either action's identity.

The implemented control-operation competition is the same joint field with
`W+ = 0.70` and `W- = 2.00`; it is not a second operation-only integrator.
The coupling is shared by all eight operations and encodes no operation order,
action identity, or Minecraft answer.  A two-level design (a separate branch
field followed by a separate operation field, with `0.70/2.00` and
`0.20/0.80` couplings) was considered but remains unimplemented; it must not
be inferred from this document or from a runtime snapshot.

The controller supplies only normalized facts:

- goal residual from a grounded public predicate;
- the weakest surviving R1/R2/R2A physical link;
- current stable-factor applicability;
- the fraction of actual random rollouts that reach a relevant physical readout;
- missing/conflicting/unknown factors;
- recent-use inhibition and novelty for cold-start exploration.

It does not supply an action answer.  More than eight candidates are reported and visited through a rotating active window.  A branch whose physical evidence disappears loses its input and decays.  Temporary factor-transition branches preserve opaque factor IDs only; their co-occurrence is not called causality.

Goal completion requires the same grounded expression to be true in two observations separated by at least five real physics ticks.  Open-world failure is reported only as “current experience and budget did not find a solution,” never as global impossibility.
