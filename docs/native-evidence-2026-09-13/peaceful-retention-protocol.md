# Revisited-task retention after the one-hour learning run

Registered before preparing or running the post-learning trial. This addresses
retention of prior task performance after actual online updates, not open-world
novelty, a new independent seed or supported causal multistage competence.

Reference: peaceful-natural-retained-frozen, R3 actor, initial peaceful world
seed 129604783, original R2 dynamics/affordances, choice counter 1801. It reached
the z < -14.5 goal in 40 actions with zero writes, within 192 decisions / 480 s.

Create an unused byte-identical copy of peaceful-natural-initial. Replace only
its learned dynamics and affordances with those from the stopped one-hour online
model. Preserve every nonlearning state field, including physical counters and
choice counter 1801, and all world files. Record both model hashes and unchanged
world-tree hash. The transplant itself adds zero actions or learning writes.

Run the same immutable R3 actor, exact existing goal file, frozen dynamics and
affordances, 192 decisions / 480 seconds, task-only, native 100/50 ms planner
limits. Only this native run counts as the post-learning test. It runs after the
controller pair, without another concurrent Minecraft trial.

Audit the original windows, unchanged learned digest, goal confirmations and
stopped-player position. Report success/failure and action count. A retained
ability does not by itself demonstrate a newly acquired ability; failure in
this one matched initial scene supports a retention concern, not a general
estimate of catastrophic forgetting. Keep negative results and avoid replacing
the test after seeing its outcome.
