# Native continuation, 2026-09-13

Source: GitHub main `9334c27c4b147fa2d8457686ed94cf70fa6198cc`, containing the recovered original `ea097eb` snapshot. All 382 original source files were verified against their saved hashes. The missing historical 121-test scheduling patch has not been recovered. The repair here is new.

## Controller and apparatus

`implemented`: while a measured maintenance need and a pending external task coexist, the session alternates completed service opportunities. Refused actions and unavailable offers consume opportunities too. This prevents an unresolved body need from excluding external tasks indefinitely. The initial category remains maintenance. Task FIFO and the existing ordering of body needs remain unchanged. Same-world snapshots preserve the category; transfer clears prior task ownership. The state contains no action effects, motor identities or solutions.

`validated`: a deterministic regression failed against the original controller. Four added tests cover service fairness, both permutations of learned physical effects, frozen model/affordance digests, six distinct later actual confirmations, FIFO, repeated-frame rejection, same-world equivalence, transfer and legacy checkpoints. The focused gate passed 5/5 and the integrated gate passed 124/124. The first full attempt was 123/124: the existing ten-causal-stage test returned `unknown`. It recurred in the renderer gate (124/125). That synthetic composition test now uses a deterministic 512-expansion budget and no wall deadline; a zero-wall-budget check separately requires `unknown`, zero actions and unchanged learned state. All ten stages, ablation, later actual confirmations and restart assertions remain. `runGoal` forwards the already supported planning time option. Native defaults stay 100 ms supported / 50 ms exploratory. The current integrated gate passes 125/125; all failed logs remain.

Windows apparatus fixes use POSIX tar member names, handle CRLF tar listings, read the archive report as UTF-8, and import absolute build paths through file URLs. The recorded planning profiler additionally accepts an exact goal ID instead of silently selecting the historical coordinate goal. It rejects missing or conflicting identities and records the selected definition, source model hash and script hash. Its profiling operation performs no learning or physical actions.

## R1: actual V51 same-world continuation

The V51 release ZIP matched SHA256 `b91a9dff21de09e5fc0fd9c1d168dad8d29d9535c2d7a77ad0a5c2f61b6361ce`. Its session matched `80c5707a74816434968924c80b11324d6ee567d763cb50eed9fb4400059b0d17`. Restoring the session preserved 1600 decisions, 1445 executed actions and 3149 writes. The run began in a separately prepared copy of the stopped world at exactly the saved position, with an empty hotbar.

The actor used an immutable copy of 587 compiled and harness files. Its freeze manifest SHA256 is `a6ec5fcb217a11498b14edd4a4caf88d12207556e137dcbafacbf8d78e91dfb6`. No reset, teleport, setup command or externally selected action was introduced. A newly named terminal goal required `position.z < -16.10145494124189` and `gripCount > 0`; it supplied no action or subgoal sequence.

| Measure | R1 observed result |
| --- | ---: |
| New decisions | 128 |
| Completed physical action windows | 124 |
| Separate passive windows | 307 |
| New learning writes | 431 |
| External task / maintenance decisions | 92 / 36 |
| Reported elapsed seconds, including overhead | 277.572 |
| Server-confirmed deaths | 16 |
| Supported task plans / multistep task plans | 0 / 0 |
| New terminal goal | pending |
| Sampled Node RSS range, MB | 730.289–1334.797 |

`validated`: every audited active/passive window matches its saved hash and endpoints. The saved final player position agrees with the final observation. The stopped-world archive SHA256 is `0a799bd4bc5c39a67de546f4dbfd0774756fee98010af4a83f1e36ad29a684e0`.

`rejected` for this trial: survival and causal multistage success. All recorded frames had `gripCount = 0`. Crossing the coordinate threshold alone did not complete the conjunction. Sixteen deaths and controller-selected respawns are not survival. Hypothetical plans are not accepted predictions or verified causal execution.

## Recorded prediction diagnostic

The original V51 model was evaluated on the 124 new action windows before observing their outcomes. A frozen replay was compared with sequential predict-then-learn replay. The latter includes the 11 explicitly selected passive actions among those 124 executed windows, but omits the 307 separately recorded passive-event updates; it is not an exact reconstruction of the live learning stream.

| Measure | Retained frozen | Retained sequential replay |
| --- | ---: | ---: |
| Windows with all three supported position coordinates | 23 | 22 |
| Windows with all three supported coordinates correct | 8 | 8 |
| Windows with all three hypothetical coordinates correct | 13 | 21 |

These are offline diagnostics with zero new physical actions. The increased hypothetical accuracy is limited evidence of adaptation to this stream, not proof of learning benefit on a new task, reliable supported prediction, or long-term competence. Neither comparison replaces matched erased-memory native controls.

## Ongoing work and evidence location

R2 is stopped and independently audited. It completed 387 new decisions, 371 physical action windows, 1147 separate passive windows and 1518 writes in 812.314 seconds, with 44 server-confirmed deaths. It had two supported single-step task plans, no supported multistep plans, and no new task success. It was gracefully paused after identifying a sensor omission. Its stopped-world archive SHA256 is `a766b9fb1bcfce597bbca53fcf3927d5ab219f02a6b0d86520816a171d4c26fa`.

`validated` apparatus repair: the installed viewer catalog omitted a default texture for zombie villagers and villagers despite containing their base images. The renderer now falls back only to an existing, decoded exact base image. Existing 73 colors remain unchanged; 15 additional entity images are supported. In the isolated native red/green calibration, the old actor saw zero zombie-villager pixels and offered no attack. The corrected actor saw 65 pixels, offered the anonymous physical attack, and correctly lost both pixels and attack availability behind a wall. One apparatus-selected attack reduced independently queried server health from 20 to 19.06. This is a sensor/actuator calibration with zero autonomous learning trials, not learned combat skill; its windows were not added to the model.

The user requested peaceful mode before increasing scenario complexity. The new evaluator explicitly selects and records difficulty, queries the engine before the learner connects, and the stopped-run audit checks saved `level.dat`. `peaceful-natural-initial` initialized natural seed `129604783` at `[-3.5,74,-2.5]`, with empty hotbar, zero controller actions and unchanged 5098 learning writes. The engine reply and saved difficulty byte 0 both confirm peaceful survival mode. Its stopped archive SHA256 is `9d841f5841b36b020fa62c76e9bf5e73a8525b42e458e05600f6910bdff30a22`.

Four initial copies have identical world-tree hash `e9eab215b68c7e0dbdb2399217ef799cceb37a5e84f0da4a323910298044416b`. Erasing one copy removed only learned dynamics and affordances (5098 to zero writes), preserving world files and sampling counter 1801. The actual Windows erasure operation completed. The actor freeze manifest is `b21ebc8753c2886d37bf1f4d605a1d360ccd0cb41638e37847974e99d3bdbb8c` (`execution-builds/peaceful-r3`, 585 files).

Matched retained-frozen and erased-frozen trials use terminal `z < -14.5` and budgets of 192 decisions / 480 seconds. These are locomotion/transfer tests. Sustained online learning and an impossible negative-health control follow. A causal multistage claim additionally requires distinct independently checked prerequisite changes and supported predicted-step traces; a conjunction, repeated movement or curiosity-only success is insufficient. Peaceful rules also exclude claims of hostile survival and hunger management. No peaceful capability result is claimed at this checkpoint.

Local evidence is under `D:/Kairos project/.kairos/worktrees/native-continuation-20260913/evidence`. Command manifests, failed and successful test logs, immutable execution copies, original journals/windows, sessions and world archives are retained there. `native-v51-r1-audit.json` is the independent stopped-run audit. Source and compact reports are kept in Git; large raw evidence will be packaged separately with hashes after the experiments finish.

The body still uses engineered 25×19 RGBD, approximate entity/fluid optics, owned physiology and visible hotbar signals. It does not establish full client vision, general inventory UI interaction, language grounding, reliable long-term survival or unrestricted open-world competence.
