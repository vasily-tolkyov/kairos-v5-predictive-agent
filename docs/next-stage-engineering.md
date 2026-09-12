# Continuing exploration and goal execution — engineering record

This is an unfinished next-stage implementation based on source commit
`1206bb5a94c16d24a8bb8cb4dda4a97fc85182e3`. It does **not** establish lifelong
open-world autonomy. Earlier Minecraft results remain evidence for the earlier
implementation, not a substitute for testing this one.

## Preserved design constraints

Experience comes from actual sensor/action windows. Objects remain revisable
perceptual hypotheses; attention selects which object changes are learned.
Motor effects, availability conditions and plans are not supplied as task
solutions. No recipes, routes, named-object effects or prescribed stage chains
are loaded into the learner. Engine identities stay inside sensing/actuation.
Goal descriptions and imagined outcomes never train the predictive medium.

## Implemented changes

- A bounded contextual readout partitions observations by measured response
  differences. Local calibration uses predictions made before each update.
  Sparsely encountered regions retain samples when frequently visited ones
  fill the buffer. Partitions are learned data, not authored task rules.
- A nearby real counterexample withdraws support for an old response. Its
  measured effect can inform a hypothetical probe, which stays unaccepted.
- Recursive covariance updates are symmetrized and their total magnitude is
  bounded. The previous forgetting update grew unexcited directions until a
  repeated-input stress run failed after 6,656 updates. The bound does not
  count as directional observation evidence.
- Recent event identities have exact conflict checks. Increasing native body
  event streams use bounded cursors. Retired arbitrary IDs use a conservative
  fixed-size filter: a collision skips learning and never duplicates it.
- Availability is learned from actual complete offer sets. Later planning
  nodes can use previously encountered ports that were unavailable initially.
- A separate world memory retains places and uncertain surface correspondences
  across occlusion. It never inserts remembered surfaces into current sensing.
- A continuing session retains pending goals, baselines, verification state and
  exploration intentions across checkpoints. Intentions specify a desired
  measurement, not a stored action sequence. New-world restoration transfers
  learned dynamics without transferring coordinate goals or place identity.
- The adapter senses visible hotbar counts and approximate block-item colors.
  Unsupported item colors stay unknown. Hidden inventory slots, names and
  recipes are not exposed. Full retinal frame retention is reduced to 512.
- Actual cursor-bound motor offers are checked against their exact current
  target. The legacy type-only ambiguity check no longer suppresses a valid
  interaction merely because other visible blocks share the target's type.
  Off-cursor bindings and unperceived entity actions remain refused.
- Current gaze appearance and geometry condition body/scene predictions.
  Previously two otherwise identical interactions on visibly different
  surfaces could not produce distinguishable predicted body consequences.
- Search retains learned scene context, so a visual change can enable a later
  motor even when the body has not moved. Unsupported hypothetical search is
  limited to six steps; supported planning can search up to 32 steps.
- Attention acquisition and world memory use the currently measured surface
  point. A drifting retained anchor is not substituted for today's visible
  location. Failed reacquisition trains a measurement failure, not destruction.
- Intrinsic exploration samples motors according to their measured value,
  instead of permanently excluding every non-maximal score. Attention still
  selects the highest-valued observed subject for the chosen motor. Logged
  decisions distinguish a supported plan, an unaccepted hypothesis and
  curiosity. No motor sequence or task-specific direction is supplied.
- Goal confirmation requires six distinct actual observations, including the
  first satisfied observation. A sequence jump cannot impersonate several
  observed confirmations. Restart resets unfinished confirmation.
- Duplicate waits and auto-aimed placement variants were removed from the
  default motor catalogue; physical right-click already places held blocks at
  the actual ray hit. Legacy action decoding remains for old evidence.
- Native restart can preserve the existing world, body inventory, pending
  goals and experienced time. Session-local percept names are cleared from
  remembered correspondence bindings at restart; geometry must reacquire them.
- The body acknowledges client loading after captured observations, including
  a new spawn. Minecraft 1.21.4 otherwise ignores early interactions until its
  loading timeout. The installed Mineflayer omitted this acknowledgement.
- Digging no longer invokes the SDK operation that rejects infinite dig time
  or optimistically writes air into the client's world. The adapter uses the
  existing client's duration only to time its protocol completion request;
  that duration and material metadata never enter the learner. A server block
  update determines completion. An unchanged target produces a bounded real
  observation window. Early finish requests were rejected as an implementation
  strategy because the server can retain a delayed operation after cancellation.
- Attention now values centering the measured point. It no longer requires an
  entire large surface to fit inside the viewport before attending to a part
  of it becomes useful.

## Verification recorded so far

The v18 integrated targeted gate passed 53 tests. The subsequent gaze-context
gate passed 54; v19 passed 55 tests. The v20 integrated gate passes 64 tests
with zero failures, including production body windows and load acknowledgement.
These gates include:

1. Opposite observable mechanisms retain their predictions without rehearsal
   of the earlier mechanism; unknown context cannot pick a convenient branch.
2. Irreducible alternating noise remains unsupported and loses progress value.
3. Ten dependent stages compose from isolated transitions and actual offer
   observations; no full trajectory is provided. Erasing a required motor's
   experience prevents the plan. This is a synthetic mechanism test.
4. That pending task survives a JSON checkpoint after five actions and finishes
   with ten actions total, verified only through subsequent actual observations.
5. Twenty thousand repeated learning updates remain finite with bounded audit
   and contextual retention; the pre-fix run failed at update 6,656.
6. Existing attention, partial-plane, missing-input, goal-verification and
   anonymous-adapter controls continue to pass in this targeted gate.
7. A rare noisy sensory region cannot borrow confidence from a more frequent
   predictable region with the same mean effect.
8. Current cursor actions remain available among identical blocks; a forged
   or off-cursor target cannot execute.
9. Distinct anonymous target colors can predict distinct body consequences.
   The pre-change model receives both real outcomes but cannot distinguish
   them. No color-to-effect mapping is supplied to the learner.
10. Retired stream reconstruction remains bounded after over 64 sessions;
    filter saturation cannot block the next event in a known active stream.

The first continuing Minecraft diagnostic executed 45 physical actions across
57 recorded decisions, with no resets after its initial placement. It removed
blocks and acquired an item, but did not reach the requested opposite side.
Repeated blocked-motion hypotheses and expensive exhausted searches were
observed. The diagnostic was interrupted; its final raw events extend beyond
the last checkpoint. It must not be reported as a completed successful trial.

Further native diagnostics, all starting from the same original 1,323-window
experience checkpoint and without resets after initial placement:

| Revision | Actions / decisions | Seconds | Requested exit verified | Observed failure |
| --- | ---: | ---: | --- | --- |
| v16 | 163 / 175 | 584.972 | No | Long unsupported searches hallucinated motion through the obstruction; stale surface anchors biased attention. |
| v17 | 93 / 105 | 532.811 | No | 90 of 93 recorded offer sets incorrectly omitted interaction because several blocks shared one type. |
| v18 | 95 / 107 | 540.169 | No | Correct interaction availability restored: 11 digs and 8 interactions; greedy exploration still made zero vertical camera movements. |
| v19 | 63 / 75 | 310.895 | No | Vertical looking began, but the SDK rejected an attempted dig on bedrock with infinite duration. Final session and world were saved after the fault. |

The v16–v18 runs were paused with the checkpoint protocol and retain their
actual events, final session, setup and exact compiled build. Autonomous
investigation waypoints were reached, but they are not the requested exit
task. The current enclosure is an engineering diagnostic seen by its developer,
not a blinded transfer benchmark. Source hashes identify each execution even
when a run was launched with uncommitted changes.

Native body checks additionally establish the following narrow results:

- A copied stopped world restarts with identical position and visible hotbar,
  no setup commands or controller actions, and continuous experienced time.
- The v20c digging-port check receives server-confirmed wood removal, a full
  unchanged bedrock window, and successful wood removal afterwards. Windows
  contain 67, 206 and 68 actual frames respectively. This is actuator validation,
  not autonomous planning evidence.
- The first raw-port check failed: its startup dig was ignored before loading
  acknowledgement. That failed trial is retained. After acknowledgement,
  the native comparison succeeded; the final driver also avoids early finish
  requests that can leave a delayed server operation active.

The v20 continuing run resumes v19's actual changed world and its 1,386-write
checkpoint, including the unfinished goal. It does not rebuild the enclosure
or teleport the body. Earlier experience used the SDK's client prediction;
the old archive cannot retrospectively certify every block change against a
server packet. Acceptance therefore also requires fresh experience with the
corrected driver, rather than relying exclusively on that legacy checkpoint.

## Fresh experience and transfer evaluation

The resumed legacy learner added 164 physical windows over 1,300.154 seconds,
ending with 1,550 total writes and no verified exit. Its active task remained
pending in the saved world. This is a failed diagnostic, not evidence of
successful transfer.

A separate v20 learner started with zero experience in the birch enclosure.
At decision 248 (333.33 seconds), curiosity-driven actions had opened the
obstruction and crossed to its far side. Independent server queries confirm
the far-side position and four acquired planks. The run eventually recorded
476 actual action windows across 518 decisions, retained 56 place cells and
reached the 512-surface memory cap. Surface entries are hypotheses, not 512
distinct physical objects.

Crucially, the exit goal was scheduled only after 512 decisions and was already
satisfied when presented. The log's later `goal-verified` is confirmation of
an existing state: it is **not goal-directed multistage planning evidence**.
This fresh checkpoint is useful training evidence for the following transfer
trials, which present an initially unsatisfied goal from their first decision.
The harness now records initial goal satisfaction separately and labels that
case `already-satisfied-goal-confirmed`; it also hashes frozen dynamics and
affordance models before and after a trial.

V21 transfer variants changed material, width, starting location and optionally
wall thickness, using the same implementation and 476-window fresh checkpoint.
Both trials failed within 256 additional actions: frozen B took 545.115 seconds;
online C took 1,377.564 seconds and added 256 learning windows. B's dynamics and
affordance digests stayed identical. C acquired four planks but did not exit.
The developer knows the fixture generator; these are not blinded benchmarks.

B repeatedly chose a hypothetical forward jump after actual stationary feedback.
The session compared a different, conservative prediction that omitted the
hypothesized displacement, and the frozen model could never absorb the
counterexample. V22 now retains the actual selected probe prediction, labels its
comparison as hypothetical, and uses the bounded recent decision log to withdraw
a disproved planning branch when the measured state remains unchanged. This
working feedback expires and does not block curiosity from trying a motor.
It survives same-world restart but is cleared on transfer to a different world.
Frozen evaluation freezes transferable dynamics and affordances; current task
feedback and observations remain active. No alternative action sequence is given.

V21 removes repeated copying of sensor arrays before immediately discarding
them, and reuses repeated contextual matches and camera predictions within an
immutable observation. Six native-frame replays produced exactly identical
predictions, choices and plans. Curiosity scoring fell from 119–362 ms to
56–115 ms in that replay; search also improved. This is a concurrent-process
timing check, not a new physical capability result. The integrated 64-test
gate remains passing. Prediction comparisons now also expose failed forecast
depth changes, which static body channels previously hid.

Recorded C windows expose how little dynamic prediction is established. With
the fresh A model frozen, all 183 supported complete position predictions were
correct, but every one described a stationary body. None of the 54 move windows
had a supported complete displacement. Only 5 of 54 changing supported view
channels and 2 of 221 changing supported object channels matched. Stable-channel
accuracy therefore cannot stand in for useful world-model coverage. Updating
from C's actual windows during chronological replay increased moving-window
coverage to 11; this replay is not a fresh chosen-action task trial.

V23 addresses three identified constraints without supplying effects: world
coordinate support is projected from only its relevant measured body components;
a supported goal-approach prefix is retained when the complete goal exceeds the
search horizon; and intrinsic sampling averages each actuator's parameter values
before selecting parameters, so adding more choices cannot multiply its prior
share. Orthogonal uncertainty remains unknown, partial progress stays distinct
from predicted completion, and the physical action catalogue is unchanged.

V22's frozen B repeat finished 256 actions in 861.506 seconds without an exit.
It made 36 jumps instead of V21's long repeated-jump sequence and explored 26
place cells, but this did not establish goal completion. V23 acquired two planks
early, then repeated its motion hypothesis again; it was checkpoint-paused after
101 actions and 468.968 seconds to investigate the observed root cause.

Identical sensor/body states in V23 contained a non-gaze surface anchor that
drifted about 0.14 vertically per jump window. Its measured surface point stayed
at approximately y=1.53 relative to the observer while the retained anchor rose
past y=8.5. Registration had integrated tangential motion despite explicitly
absent tangential evidence. V24 projects registration onto measured components
and the measured plane displacement, and exposes the current measured point as
the visible object's position. Historical correspondence anchors remain separate.
Legacy learned inputs can contain old anchor drift; a transferred old model is
therefore a diagnostic, not a clean evaluation of newly encoded experience.

V24 also removes the interaction driver's domain-specific minimum pulse wait.
An actually observed stable change returns control before a short opportunity
disappears. Unobserved effects still have a bounded observation window. The
native harness can now start normal generated terrain at its native spawn with
no setup or teleport commands, normal difficulty and native day/night behavior.
Deaths and spawns are audited; SDK automatic respawn is not learned recovery.
Natural-world capability results remain pending.

V24's final targeted gate passes 70 tests. V25 deletes a second greedy action
override in the continuing session: it replaced the exploration sampler's choice
with a top-scoring motor and could also carry attention chosen for a different
motor. A stationary physical-feedback fixture selected only one of two motors
under the old loop; the same fixture explores both after deleting the override.
Learned spatial investigations remain active. This is a controller regression,
not additional native-world evidence.

The bounded goal runner now delegates to the same continuing feedback owner.
Its separate loop previously omitted local hypothesis withdrawal. The unified
targeted gate passes 71 tests; the frozen-feedback check also covers bounded
execution. Default confirmation still requires six actual observations.

The first natural-world diagnostic generated and verified six autonomous
investigation waypoints before decision 240, but also drowned. The server log
confirms drowning; decisions 210–212 show falling health while selecting hotbar
slots, followed by an audited SDK respawn. This is a survival failure, not a
completed open-world capability. No archived action window inspected at that
boundary spanned the respawn or a large teleport, so direct attribution of the
respawn displacement to a motor is not established in this trial. Breathing
sensation, held jump duration, passive feedback and deliberation latency require
further investigation.

That v24 natural-world run has now finished: 512 decisions, 410 physical action
windows, 827.185 seconds and 117 retained place cells. It had one server-confirmed
drowning and no externally submitted goal. Frozen B's v24 continuation also
failed: 256 additional windows over 1,550.573 seconds, including 231 moves, did
not reach the exit. Changes in irrelevant motion can evade the current exact
state counterexample check. Neither result meets the acceptance requirements.

V26 distinguishes a held motor from the historical one-tick jump pulse. New
ports hold the physical button for 4 or 20 ticks and return after release;
waiting until rest had erased the useful transient ascent in water. The old
parameter identity is retained only for reading previous experience. Current
oxygen is exposed only when actually received. There is no underwater action
rule or supplied swimming sequence.

The native v26b actuator comparison ends the old pulse at pool-bottom y=60,
but the held 20-tick port reaches y=63.043165088340636 in 23 observed frames.
Independent server position queries agree. This scripted apparatus check is
not autonomous swimming evidence. A separate death check confirms that automatic
SDK restart is disabled: the actual health-zero observation exposes an explicit
restart port, and choosing it produces observed and server-confirmed health 20.
Restart is recovery of the interface, not learned survival.

The SDK stops physics-tick events on death. The body now samples that real death
packet and terminates an interrupted motor without requiring a nonexistent
future tick. Unit coverage includes death during a held motor, with no further
physics ticks. Current session searches also have wall-clock budgets so a search
cannot consume the full former expansion budget before returning control. These
are deliberation limits, not a hard real-time guarantee for the entire loop.
The v26 targeted integrated gate passes 74 tests. Native continuation with this
revision is still required; passive interval learning, learned preservation of
bodily variables and open task competence remain unestablished.

V26's natural continuation has already exposed another survival failure: the
server reports an attack by a trident-bearing Drowned. The controller selected
the explicit restart port and continued, but the block-only retinal renderer
could not depict the moving attacker. This does not diagnose drowning or prove
learned defense. Entity visual coverage remains a concrete missing input.

V27 adds body-supplied maintenance goals to the same general goal executor.
The Minecraft adapter prefers measured health, food and oxygen above 18; this
is an explicit physiological preference, not a fact inferred from experience.
No remedy, action name or sequence enters these goals. Missing measurements do
not fabricate a deficit. A deficient condition temporarily takes priority over
the external task, which remains pending and resumes afterwards. Maintenance
does not count as an externally verified task. Permuting measured motor effects
in the regression fixture changes the chosen remedy without changing the body
goal or controller. Native preservation is not yet established.

Eight unsupported probes without measured goal progress now yield sixteen
decisions to intrinsic exploration before further goal-directed hypotheses.
Supported plans remain available. The budget survives same-world restart and
does not enter transferable model state. A fixture with irrelevant sideways
motion catches the previous unlimited-repeat failure. The integrated v27 gate
passes 76 tests; these limits are engineering budgets, not biological constants.

V26's natural continuation finished 768 further decisions and 757 actual motor
windows in 1,258.715 seconds. The continuing model has 1,167 writes and 219 place
cells. Its initially unsatisfied external location goal remains pending; one
server-confirmed killing and one controller-selected restart occurred. A frozen
v27 transfer of an earlier 799-window natural checkpoint into a new spruce
enclosure also failed within 256 actions and 347.107 seconds. Model digests were
identical. Of 255 executed decisions with prediction information, 95 used a
supported approach and 160 exhausted their search; only one decision recorded
new best measured goal progress. High-confidence extrapolation also needs actual
feedback: the unsupported-probe budget alone did not solve this failure.

V28 renders supported moving entities into the same RGBD array, using installed
visual textures and physical bounding silhouettes. Names and native identity
remain inside the renderer. Optical cursor binding is checked before exposing
an anonymous interaction; a surface behind an entity cannot receive that action.
This remains a coarse silhouette renderer, not animated full-client vision.
Seventy-four entity texture colors agree with independent Pillow decoding within
RGB rounding. Unavailable entity visual assets remain unsupported.

The held-item port now exposes a timed physical press without selecting an item,
invoking a consumption helper, or supplying its effect. Non-block hotbar icons
use their installed image colors. In the v28c native apparatus check, a wall
occludes an entity and its attack offer; after uncovering it, an anonymous bound
action changes server-reported target health from 20 to 19.06. A separate held
apple window changes sensed and server-queried food from 5 to 9 and count from
3 to 2, over 43 actual frames. These are apparatus checks, not autonomous food
acquisition or defense. The first setup failed with an overlong test username;
the second lost its hostile fixture in peaceful difficulty. Both failed records
are retained. The integrated v28 gate passes 79 tests.

V29 separates learned future gaze measurements from persistence of a tracked
object. Actual later gaze appearance, relative position and visibility train
the same motor-conditioned medium. A predicted newly visible surface receives
an unbound gaze role; only the current real observation can bind execution.
Losing a tracked measurement removes that predicted visible object without
claiming destruction. Feedback compares the predicted gaze role to the actual
later gaze, including incorrect colors and geometry, not to an invented ID.
One actual sample can inspire an explicitly unsupported probe; factual support
still requires calibration. No block removal or successor surface is supplied
as an action rule.

The new three-stage fixture requires two separate operations to reveal new
surfaces, followed by movement. Training windows are isolated, future object IDs
are new, transferable experience is frozen, and the actual goal is confirmed
after execution. The model now composes the sequence. Its first run exposed a
second failure: numeric context splits lay directly on observed values, so a
tiny prediction roundoff could remove a learned future action. Boundaries now
lie between distinct measured values. The integrated v29 gate passes 82 tests.
This is a synthetic composition result; native transfer is still required.

The original-frame migration accepts native and legacy wrapped events. It
re-encodes each window once, binds the original chosen attention by its measured
surface point and appearance, and records source hashes. Optional affordance
reconstruction uses only complete offer sets from exactly the event's first
observation sequence; absent or stale sets supply no evidence. Migration is
never counted as additional exploration or new physical trials.

The v29 native comparison failed in both arms within 256 actions. The frozen
1,643-window model took 710.923 seconds; the initially empty online learner took
360.233 seconds. The frozen arm repeatedly chose a newly introduced held-item
port whose novelty could not decrease in a frozen model. The cold arm repeated
a nominally supported tiny movement forecast while the body stayed blocked.
Matching within the prediction tolerance did not mean that the expected progress
actually occurred. Neither arm supplies native multistage success.

V30 uses the bounded current decision log to reduce the novelty of already
tried motors in the same sensed context, including frozen evaluation. It does
not alter transferable learned state. A planned prerequisite must produce its
predicted nontrivial measurement changes to count as advancement; small forecasts
inside tolerance cannot indefinitely justify stationary execution. Unfulfilled
supported plans now share the same finite trial budget. The ten-stage and newly
revealed-surface composition gates still pass. The integrated gate passes 85
tests. This does not yet implement full uncertainty propagation through a plan.

An archive audit finds all 476, 410, 757 and 256 original event files in the
respective A, v24-natural, v26-natural and v27-transfer runs, but some appended
action/decision summary rows are missing. The cause of those missing append
records is not established. Counts of physical windows remain grounded in the
separate event files and checkpoint ledger; absent decision labels are not
invented. New runs write each journal record independently and derive JSONL
exports at shutdown. Current-frame offers also retain their actual observation
binding, and receipts include the complete offers for the actual action-start
frame. This removes the need to relabel earlier offer sets as later evidence.

V31 replaces early per-channel averaged probe outcomes with the nearest whole
measured response retained in each contextual circuit. The same recalled row
supplies the bodily and newly visible gaze hypothesis. It remains unsupported,
and recall never adds a learning trial. Separate object circuits are still
separate recalls; this is not a globally coherent world trajectory. The 86-test
integration gate passes, including mutually exclusive early responses and an
updated stationary counterexample. Native success has not been established.

The v30 frozen continuation completed another 256 physical windows in 505.811
seconds without leaving the enclosure. Its transferable model digest remained
unchanged. One supported forecast expected z=-0.7312346 while the body remained
at z=-0.7. In the online arm, another expected z=-0.7004543 while the body also
remained at z=-0.7. Both matched the old 0.1 comparison tolerance. Trial budgeting
limits repetition but does not make these point forecasts valid progress.

V32 carries empirical numeric response envelopes through bodily coordinates,
gaze geometry, sensed properties, subsequent contextual reads and learned
future action availability. Goal forecasts must hold over the retained range,
not merely at its mean. These finite observed ranges are possibility envelopes,
not confidence guarantees or complete distributions. A missing context with
incompatible learned responses can no longer be overruled by a globally
accurate average readout. Predicted gaze goals now resolve the visible role's
supported channels. Imagined ranges cannot enter physical learning or memory.

The first v32 native-frame replay still reproduced the false displacement:
missing contextual evidence had bypassed the new envelope through that global
fallback. After removing it, the same archived stationary action has no
supported positional forecast and no supported progress plan. This is an
offline diagnosis, not another physical trial. All 93 integration checks pass,
including reliable millimetre motion, accumulated observed stalls, uncertain
prerequisites and the existing ten-stage and three-surface compositions.

The v30 online continuation ended after 384 physical windows in 820.666 seconds,
with 640 cumulative learned windows and its goal still pending. Both v30 runs'
independent journals reconcile to all 640 raw event files. Every recorded
action-start offer set and bodily state matches its event's first frame.

V33 allows an early joint-response hypothesis to propose partial progress when
the goal lies beyond the current search budget. The plan remains explicitly
unsupported and retains its actual feedback/refutation budget. Short-term motor
habituation now uses the recent actual trials across changing camera samples;
predictive refutation still requires the matching local physical context.
The integration gate passes 94 checks. Native validation is pending.

An offline profile of the frozen v30 failure frame took about 1.7 ms per direct
prediction over 26 offers. A 100 ms hypothesis search examined two nodes and
returned no plan; allowing more time found a five-step unsupported hypothesis
in about 206 ms. This establishes a search-budget limitation, not the physical
validity of that proposed sequence.

`scripts/extend-measured-experience.mjs BASE_SESSION SOURCES NEW_OUTPUT_GZ`
consolidates additional archived native windows without re-rendering frames or
inventing outcomes. It rejects obsolete retained surface anchors, duplicate
windows and imagined evidence, imports only exact action-start offer sets, and
records source and output hashes. Consolidation creates zero physical trials.

The v33 native continuations each completed 36 action windows, then stopped
with `Minecraft real-frame timeout` (80.261 and 84.049 seconds). Neither goal
was achieved. Both server logs report roughly 2.3 seconds of lag around the
failure, but the existing record cannot establish the timeout's root cause or
recover the unfinished action's missing window. V34 adds action intents,
timeout timing/health/chunk diagnostics and explicitly incomplete raw windows.
Incomplete windows do not enter the learner. All 95 integration checks pass;
the stall itself still requires native diagnosis.

The checkpoint-09 world archive helper mistakenly looked for `world` rather
than the configured `world-v5-physical-control`. Its v30/v32 archives contain
properties and logs, not full world snapshots. Those historical world states
are unavailable after continuation. Their complete measured events and learned
checkpoints remain valid; they must not be presented as exact restartable world
snapshots. Earlier natural/v29 snapshots and newly captured v33 snapshots have
verified level metadata and region files. `scripts/archive-stopped-world.py`
now reads the configured name and verifies both before and after archiving.

V35 normalizes numerical goal progress by the initial measured goal gap, or an
explicit calibration in the observable's units. Shifting the coordinate origin
does not change the progress signal. Approaching a distant narrow region now
remains distinguishable before reaching its boundary. Minecraft's physiological
preferences specify their existing 20-unit body scale; this supplies no remedy
or action effect. Older stored progress scores are rebased on an actual frame,
and that software change does not count as physical progress. Both new metric
checks fail against the preceding implementation and pass after the change;
all 98 integration checks pass.

The v34 online B continuation completed 767 additional physical windows over
1,795.376 seconds, reaching 1,677 cumulative learned windows. Its exit goal
remained pending. It did not reproduce the preceding frame timeout; this does
not establish that the earlier stall's cause has been found or repaired.

The v35 C transfer began with 4,322 previously recorded native windows and
frozen dynamics/affordances. Its initially unsatisfied goal was verified after
241 executed windows and 404.489 seconds. The independent saved-world audit
finds seven removed spruce blocks, including a two-high passage through all
three barrier layers. Saved player position is [5.7, 64, -5.577069283621096],
past the -5.2 target, with seven collected planks. All 241 action journals
match their raw windows; the learning digest is unchanged. Goal confirmation
used six distinct actual observations, sequences 7749 through 7754.

This is a bounded goal-reaching result, not evidence of a complete multistage
plan: all eleven breaking attempts came from curiosity. The run contains 97
single-step hypotheses, 144 curiosity actions and zero supported plans. The
last four moves followed single-step hypotheses after exploratory digging had
opened the passage. C uses the same developer-known enclosure family with a
different geometry combination; the learning bank includes prior failures in
that family.

The v35 erased-experience control also reached the initially unsatisfied C
goal: 350 physical windows, 362.157 seconds, twelve removed barrier cells,
zero learned writes and zero hypotheses or supported plans. Its saved player
position and all 350 action windows verify independently. The experienced arm
used 31.1% fewer actions in this single pair, but took 11.7% more elapsed time.
The comparison does not establish reliable transfer, planning competence, or
a time-efficiency benefit. Both successes depended on exploratory opening.

The v36 deletion experiment removed the projected motion-uncertainty bonus.
It failed the existing attention-selection check (background selected instead
of foreground), so the deletion was reverted. The failure log and patch are
retained; this experiment is not included in the working prototype.

V37 preserves the actual central RGB sample alongside its coarse surface
hypothesis. In native C event 235, the contacted sample is brown while its
large group's average is nearly gray; event 91 shows the reverse mismatch.
The existing group average erased this distinction from the experience input.
The added channels carry only recorded RGB and are predicted from actual
before/after windows. No material label, action consequence or segmentation
rule is supplied. A controlled test with identical grouped objects and
different local samples fails on v35 and passes after the change, including
learning different bodily outcomes and preserving unknown absent samples.
The integrated gate passes 99 checks. Native benefit remains to be tested.

`scripts/audit-stopped-minecraft-enclosure.mjs` reads stopped-world region and
player files independently of the learner. It checks barrier changes, saved
position, journal/window agreement, frozen digests and the provenance of
planning versus exploration. It never supplies world metadata to a policy.

`scripts/profile-recorded-planning.mjs` measures prediction/search costs on one
archived action-start frame without changing learned state. Its imagined
alternatives are diagnostic outputs, not additional physical task evidence.

V37's new natural-world run was checkpointed after 240 decisions and 211
executed windows in 512.669 seconds. It visited 55 retained places, drowned
once and selected one explicit restart. The external goal had not yet been
submitted. This was a diagnostic pause, not a completed long-duration trial.

The run exposed a body-channel ownership bug in the installed Mineflayer
plugin: every entity's `air_supply` metadata could update `bot.oxygenLevel`.
The body had treated that aggregate as its own breathing sensation. An isolated
native apparatus reproduces the error: independent player Air is 300, yet the
old sensor reports 9 after a neighboring entity's air changes. V38 receives
only packets for its own entity and invalidates the cached reading on respawn.
The same apparatus now retains oxygen 20 while the SDK aggregate changes to 9;
after restart it leaves oxygen unknown until a new owned sample arrives.

Earlier native oxygen samples without ownership provenance are unverified;
their true ownership cannot be recovered from the saved frame values. Raw
re-encoding therefore masks that channel without inventing a replacement.
Medium V11 rejects new native windows with unowned oxygen and direct restoration
of affected older models. Position, RGBD, health, independent death records and
physical outcomes remain separate evidence. The V37 re-encoding used
the old channel and is not a repaired model; V38 rebuilt from the original
windows with explicit masking provenance. Both long-running execution connections
were later lost before a complete output was produced. Their partial logs are
retained and neither is a completed repaired experience bank. The gate passed 101 checks, including
foreign entity packets, body replacement, missing readings and legacy-model
rejection. These sensor checks do not establish learned survival.

V39 anchors a recalled visual hypothesis to the before-image of the same
measured response. Previously a remembered no-effect interaction could still
replace today's gaze geometry and color with its unrelated historical
after-image. In the native C event-235 replay, the selected witness is an
unchanged scene; using its absolute after-image introduces changes that that
action never produced. The probe now transfers its measured before/after
change and leaves unanchorable fields unknown. It cannot invent an object in
an empty gaze merely by recalling an unchanged visible surface. This remains
an unaccepted hypothesis. The new control fails on v38 and the 102-check gate
passes with the correction. Native task benefit remains to be established.

V40 renders dropped items from their actual stack appearance using the same
installed item textures as the visible hotbar. Missing stack metadata or
visual assets remain unknown. The learner receives anonymous colored surface
hypotheses, never item identities or collection instructions. A native control
with the old renderer measures zero item pixels. The repaired renderer measures
six, preserves occlusion, and forms an anonymous percept. One ordinary forward
movement collects the item; visible count changes from zero to one and the
server inventory independently confirms it. This scripted apparatus is not
autonomous pickup or planning evidence. All 103 integration checks pass.

`scripts/migrate-stopped-native-session.mjs` prepares a separately identified
checkpoint from a stopped world and a complete re-encoding of the same physical
history. It verifies counts and retained event identities, preserves world
memory/user goals/counters, and invalidates feedback based on the damaged
channel. It does not overwrite the original checkpoint or add physical trials.
The evaluator's `--continue ORIGINAL --migrated-session NEW_CHECKPOINT` checks
the original checkpoint hash before resuming the existing world. A user goal
that depends on an unverified oxygen baseline is rejected rather than repaired
with an invented historical value.

V42 adds resumable offline re-encoding after those execution failures. Each
checkpoint preserves temporal perception correspondence, cached boundary frame,
attention visits, model, affordances and exact source cursor. It verifies the
encoder, compiled model hashes, original processed event hashes and action-offer
journals before resuming. Checkpoints are written atomically every 64 windows
and at source boundaries. A control using 16 original native windows, interrupted
after eight, produces a byte-identical complete session to uninterrupted
re-encoding. This adds no physical trials. All 104 integration checks pass.
The intended 4,533-window reconstruction was deliberately checkpointed at
2,553 windows to prioritize experiments using 1,031 windows acquired directly
with corrected sensing. The legacy bank remains incomplete and recoverable;
it is not used as a completed transfer model.

V43 removes a goal-distance plateau found in the corrected cold natural-world
run. At archived event 776, the current coordinate is farther from the target
than at task submission. Hard clipping had scored every nearby approach as 1,
so even a two-second search reported no progress. A bounded monotonic distance
now preserves approach after setbacks. On the same model and actual frame,
the 100 ms probe can propose a two-step approach; strict planning still finds
no supported approach. This is a read-only diagnostic, not physical success.
Old task metrics are rebased on a fresh actual frame without crediting the
software change as progress. The gate passes 105 checks, including numeric
goal directions, intervals, relative goals and uncertain setback bounds.

The V40 cold natural-world run stopped after 1,040 decisions and 1,031 learned
windows in 1,320.166 seconds. It retained 383 places and verified one internal
investigation, but had no supported plans and did not complete the external
goal. It drowned once at shutdown. Owned oxygen samples show the actual decline
and two measured increases during actions. A retrospective read-only search on
the final frame finds an oxygen-increasing hypothesis at 100 ms but misses it
at the normal 50 ms probe budget. Fixed action ordering can repeatedly omit
the same suffix of candidates.

V44 rotates the search's first candidate with the existing saved exploration
counter. This adds no action effects, urgency remedies or task-specific order.
A deterministic compute-budget control fails on V43 and passes after the change;
searching never writes extra experience. The complete 106-check gate passes.
An earlier run had one time-sensitive ten-stage failure; focused and full
rechecks pass, so native real-time reliability still requires separate evidence.

The stopped-state fork helper verifies an actual archived world and saved model
before copying both for matched native continuations. The copies have identical
world-file hashes and session bytes and count as zero new physical trials.
The evaluator now records the hashes of its actual imported compiled files and
harness separately from the possibly newer source checkout.

Both stopped-state native continuations completed the pending coordinate goal
with frozen experience. V40 required six hypothesis actions after respawning
at z=-8.5; V44 respawned at z=9.5 and used 17 supported actions, 28 hypothesis
actions and 25 curiosity actions for the task. Each goal was confirmed on six
actual frames. Random respawn positions confound speed comparisons. Neither
run supplied a supported multi-step prerequisite chain for the external task.

V45 asks episodic recall for the channels a goal is querying. It first prefers
rows that actually measured those channels, then uses contextual proximity;
all effects still come from one complete measured row. It never searches by
the desired outcome, and these analogies remain unaccepted hypotheses. On the
actual final cold-run frame, a measured upward-movement oxygen increase had
been hidden by a closer episode without any oxygen measurement. The query now
recalls that increase and also recalls worsening outcomes for other actions.
Counterexamples ensure it cannot choose a favorable but less relevant episode.
The unchanged-model replay and all 108 integration checks pass.

A new unfamiliar natural world is initialized with no agent actions. Verified
copies preserve the same living initial position. One copy retains the 1,031
owned-body-signal learned windows; the other explicitly erases dynamics and affordances
while retaining the same physical and sampling counters. The ablation keeps
the original checkpoint and world hashes for audit. Their native transfer
tests both failed within 512 decisions: retained experience executed 502
windows in 727.139 seconds, erased experience 510 in 436.048 seconds. Both
learning digests stayed unchanged and neither trial recorded a death. These
data do not establish a transfer benefit. The learning-enabled copy was
diagnostically paused after 829 decisions / 809 new windows / 1,589.263
seconds with the goal still pending. It recorded 35 deaths: 31 killed by
zombies, two by skeletons, one by a creeper and one by a spider. All three
started alive in copies of the same stopped natural world and position.

### Optical geometry and foveal capacity (V46–V47)

A native apparatus proved that the old collision-based retina omitted water:
adding an exposed pool changed zero pixels with an unchanged observer. Empty
collision shapes also omitted lava and crossed plant models. These missing
pixels cannot be reconstructed from the old recorded RGBD frames.

The renderer now intersects the installed visual models and samples actual
texture alpha, separately from interaction outlines. Fluid surfaces use the
installed renderer's surface-height convention and exclude internal fluid
faces. The new native pool changes 106 pixels; behind an opaque wall the
same change affects zero pixels. Unit apparatuses cover submerged rays,
negative Y, cutout plants, stairs, multipart fences and entity occlusion.
Engine identities remain private to rendering and action binding. A visible
fluid interface cannot inherit the interaction target underneath it.

The more detailed textures exposed a second failure: retaining only the 32
largest image groups discarded a three-pixel object at the actual gaze.
Perception now preserves the gaze group before applying its bounded capacity
cut. The unchanged native pickup apparatus failed before this correction and
passed afterward: six item pixels, an anonymous percept, one ordinary contact
movement, and independently confirmed inventory count 0 → 1. This is a
scripted sensor/contact check, not autonomous acquisition evidence.

The optics remain an engineered 25 × 19 RGBD sensor, with deterministic
asset variants, approximate entity silhouettes and no native lighting,
underwater fog, animation or complete GUI. Extended block models and
waterlogged composite geometry are not comprehensively validated. This is
not full Minecraft client vision. New natural-world experience is required
to evaluate the changed sensory representation.

### Natural-world outcome, computation and passive time (V47–V50)

With no initial experience, V47 submitted the external position goal after
256 actions and verified it at decision 546, at 512.093 seconds. Independent
server position output matches the verified position. Its 284 task actions
comprised 46 supported choices, 150 hypothesis choices and 88 curiosity
choices. The supported two/three-step plans repeated a movement; they do not
establish different causal prerequisite stages. The run continued past the
success and failed survival: its first death occurred at about 16 minutes,
and it was paused at 1,177 decisions / 1,023 actual windows / 1,256.418
seconds with 14 deaths. The complete world and failed continuation are kept.

In the earlier unfamiliar online run, 15,783 of 29,789 intervals between
recorded action endpoints lay outside action windows. Its endpoint data show
substantial health loss in these gaps. V47's inventory increase from zero to
one also appears between a break window and the following action, not inside
any recorded action window. Missing intermediate frames cannot be invented.

V48 removes repeated body-input/attention calculations without changing their
scores. On 16 original native scenes with a frozen model, the complete drive
vectors and choices are identical. First scoring totals drop from 2,115.576
to 901.579 ms; repeated exploration queries drop from 1,517.060 to 153.774 ms.
These are query benchmarks, not end-to-end live speed claims. A separate
128-window prequential replay has identical compared/matched forecasts.

V49 collects actual passive frames only after setup, splits them at motor
boundaries, and learns them in chronological order before the following
action. Passive samples carry their own provenance and measured duration;
they are never counted as executed actions. Frozen sessions log exposure
without updating learned state. The native apparatus captured induced idle
health loss confirmed independently as health 18, five passive windows and
one active window, with no duplicated physical intervals. The apparatus is
scripted; this proves a data path, not an autonomous response to damage.
The current planner still needs to use passive evolution as part of its
future reasoning; collecting these samples alone does not establish coping.

The native evaluator now also accepts `--goal FILE` for structured terminal
conditions, including conjunctions. A goal file contains desired outcomes,
not a supplied order of actions or subgoal solution. Completion and causal
multi-stage execution must be audited separately.

## Remaining acceptance requirements

V50's natural continuation exposed a real-time failure after passive learning
was enabled: decision 1,359 took 112,056 ms. The run was diagnostically paused
at 183 new actions and 1,133 passive windows. Its saved world and original
windows are retained. The post-run audit matches the saved player and every
action journal; passive windows cover 9,863 of 9,915 inter-action intervals.
The remaining intervals are not reconstructed. There were no deaths in this
continuation, but the stalled controller is not a long-term autonomy success.

V51 refreshes all retained leaf outcomes, bounds and calibration immediately,
and induces new tree structures every 16 observations. Confidence uses the
latest 32 actual prequential errors in each region; earlier errors remain in
the original samples. All retained outcomes still bound predictions. A first
implementation failed the new-visible-surface composition test because early
errors from the obsolete partition kept the new region below the support
threshold. The recent-calibration change repairs that regression without
adding training or weakening its assertions. Two memory-erasure controls also
now erase the newly persisted tree structures. Exact resume between structural
updates and immediate rejection of contradictory outcomes are tested.

On the same 16 passive windows, update median fell from 445.712 to 15.297 ms
(total 6,852.964 to 604.046 ms). Supported comparisons fell from 649 to 604;
both sets were all matched. This cost-isolation replay skips intervening active
windows and does not claim full chronological equivalence. On a separate
128-window native action suffix, update median fell from 53.769 to 9.155 ms;
comparisons/matches changed from 7,427/7,019 to 7,421/7,010. These are replay
measurements, not live throughput or proof of general accuracy improvement.

The two V50 frozen unfamiliar-world trials both failed the conjunction of
carrying an item and reaching the distant region. Each ran 512 decisions:
the experienced agent executed 508 actions in 573.368 seconds, and the erased
agent 511 in 441.207 seconds. Neither produced a supported task plan or died.
Their learning digests stayed unchanged and saved-world positions match the
journals. These trials establish neither successful multi-stage execution nor
a beneficial transfer effect. The archives, failed goals and passive exposure
records are retained.

V51 then ran 240 actual native decisions in 360.515 seconds, with 239 completed
actions and one death. A new composition control revealed that clipping the
calibration history separately in each child changed the sample mass used for
split comparison. V52 conserves the full sample mass for split induction while
keeping recent calibration for prediction confidence. The failed V52 test,
diagnostic trace and V51 continuation are retained. The V52 passive replay
recovers all 649/649 baseline supported comparisons, with 17.084 ms median
update time; the active suffix yields 7,420/7,009 comparisons/matches with a
10.678 ms median. General accuracy equivalence is not claimed.

V52 exposes one explicit `passive(ticks=10)` native port in place of the two
redundant observe ports. It issues no motor command and returns exactly ten
actual intervals, even if callback delivery arrives in a batch. Extra observed
frames become separate passive evidence. Death interrupts the requested wait;
only the shorter measured passive interval is learned, and no completed wait
is invented. Legacy observe/wait experiences are not relabeled. The ordinary
motor-key lookup now connects this port to already recorded passive dynamics;
the learner contains no wait-for-pickup rule or action-effect alias.

The native V52 port apparatus passed: ten selected passive intervals, zero
counted motor calls, five spontaneous passive windows, one movement window,
independently confirmed idle damage, and no duplicate physical intervals.
These seven apparatus windows were not added to the autonomous agent. A
separate synthetic test composes two isolated motor effects with a passive
prerequisite, executes the three-step plan frozen, and loses the complete
solution when passive experience is erased. The test initially expected no
partial plan after erasure; that assertion was corrected because the first
measured action still makes legitimate partial progress. This establishes the
generic connection, not native multi-stage task success or long-term survival.

Long sessions must keep exploring and improving useful predictions with bounded
resources, retain earlier abilities, and recover from interruption. Native
tasks must require genuine prerequisites, with actual outcomes checked outside
the planner. Transfer tests need newly generated environments and task
combinations after the implementation and learning checkpoint are frozen.
Cold/erased-memory and impossible-goal controls must remain in the results.

The enclosure fixture is bounded and peaceful. Natural-world trials have not
yet established reliable survival and external multi-stage goals. Surface
hypotheses are not yet complete object models. Full client
vision, general inventory UI interaction, natural language task grounding and
long-term survival are not established. Finite successful episodes cannot
prove success for every future world or arbitrary task.

## Running

`npm run test:next-stage` builds and runs the active continuing prototype's
integration gate. The current gate contains 120 tests. It does not claim that
the historical distributed-model test suites have also passed.

`npm start -- --output NEW_DIRECTORY --actions 1024 --seconds 3600` runs a
continuing session against the configured server. `--restore` accepts either
an earlier medium or a session checkpoint, including gzip. `--same-world`
additionally restores pending coordinate goals and world memory when the world
really is unchanged. `--goal` accepts one structured goal or an array of goals.
Limits pause the session. Creating `PAUSE` inside its output directory requests
a checkpoint and stop after the current physical window.

`scripts/evaluate-minecraft-continuing.mjs` owns a separate native server and
records static setup, actual events, decisions, checkpoints and independent
read-only server queries. It supplies no runtime effects or action sequences.
`--continue PREVIOUS_OUTPUT --output NEW_OUTPUT` resumes a checkpointed native
world; `--restore` instead transfers experience into a newly initialized world.
`scripts/check-minecraft-dig-port.mjs` checks the actuator against a separate
native server and independent server outcomes. Its scripted port checks are
not part of the controller or a task-learning curriculum.
