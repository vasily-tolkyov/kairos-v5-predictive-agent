# Transient physical control fields V1

Status labels:

- Existing physical memory and body boundaries: `implemented`.
- Coupled fields replacing a language-model analysis core: `hypothesis` until the neutral two-step experiment passes.
- Minecraft button-door behavior: not validated until a real run produces the full evidence chain.

Each branch owns six transient state values: goal difference, condition, binding, rollout, unknown, and competition.  Each operation is another competing state.  They follow the configured leaky coupled dynamics with a fixed seeded noise source, `dt=0.02`, at most 500 integration steps, and no winner unless one activation stays above `0.65`, leads by `0.10`, for 20 steps.

Branch competition uses `W+ = 0.70` recurrent self-excitation and `W- = 2.00` summed lateral inhibition. `W+` remains weaker than the unit leak, so a weak isolated input cannot self-amplify into a decision. Summed inhibition makes an exactly symmetric multi-candidate state unstable; the configured physical noise only breaks that symmetry. `W- = 2.00` is the smallest tested value for which a read-only replay of all 269 branch-input cycles from the first two real runs converged (`1.80`: 2 failures; `2.00`: 0); it does not depend on either action's identity.

Control-operation competition uses the same differential equation with `W+ = 0.20` and `W- = 0.80`. The weaker coupling lets a completed operation decay and yield when a newly stronger operation input arrives. It is shared by all seven operations and encodes no operation order, action identity, or Minecraft answer.

The controller supplies only normalized facts:

- goal residual from a grounded public predicate;
- the weakest surviving R1/R2/R2A physical link;
- current stable-factor applicability;
- the fraction of actual random rollouts that reach a relevant physical readout;
- missing/conflicting/unknown factors;
- recent-use inhibition and novelty for cold-start exploration.

It does not supply an action answer.  More than eight candidates are reported and visited through a rotating active window.  A branch whose physical evidence disappears loses its input and decays.  Temporary factor-transition branches preserve opaque factor IDs only; their co-occurrence is not called causality.

Goal completion requires the same grounded expression to be true in two observations separated by at least five real physics ticks.  Open-world failure is reported only as “current experience and budget did not find a solution,” never as global impossibility.
