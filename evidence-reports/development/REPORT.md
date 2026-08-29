# Kairos V5 — implemented prototype; autonomous development gate NOT passed

## Outcome

New isolated project: `D:\Kairos_V5_Predictive_Agent`.

The thin five-boundary implementation builds and its 11 minimal tests pass. Minecraft Java 1.21.4, the exact frozen Qwen3-4B GGUF and llama.cpp, and 8K single-request Pi tooling were actually started in new V5 world directories. The in-app first-person view visibly showed the ground, slab obstacle, real button/copper-bulb circuit and iron door. The separate read-only dashboard showed the model-owned plan and the genuinely empty media.

**The real autonomy gate failed.** With explicit read-only tool semantics, Qwen produced one `set_intent` and 37 `observe` calls, but no `execute_chain`, `recall`, `predict`, or `finish`. Thirty-eight calls completed with valid tool output; request 39 was intentionally aborted for this failure review. Maximum measured input was 3,557 tokens, plus a 768-token output allowance, below 8,192. This was not a context-overflow or service-unavailable failure. The executor stopped the run; it is not a model-authored abstention or exhausted action budget.

This is evidence of a repeated-read behavioral failure **in this particular frozen backend/interface configuration**, not proof that 4B models universally cannot act. A prior version of the tool documentation also stalled; its wording confused the read-only snapshot tool with the same-named body primitive. Clarifying that boundary and exposing actual tool-call counts did not establish autonomy. No forced action, fallback planner, action course, or automatic model replacement was added. Backend selection or further analysis-interface direction requires review/user choice under the plan.

## Actual attempts, all retained

| Run directory under `evidence/` | Actual result |
|---|---|
| `v5-2026-08-27T11-21-04-984Z-5496d710` | Startup failed before services: whole-file hashing exceeded Node's 2 GiB buffer limit. Fixed to streaming SHA-256; no model calls or actions. |
| `v5-2026-08-27T11-21-50-435Z-da944024` | Frozen services launched; server console lookup lowercased the offline whitelist profile, rejecting the exact bot UUID. Fixed with exact case-sensitive Java offline profile; no model calls or actions. |
| `v5-2026-08-27T11-23-26-998Z-3648dab4` | 1,704 raw frames, no sequence gaps; 71 `observe`, one `set_intent`, 73 attempted model requests. Zero body actions/events/writes. Operator console interruption terminated the job; there is deliberately no fabricated `RUN_RESULT.json`. |
| `v5-2026-08-27T11-26-53-929Z-d4ee2a75` | 1,971 raw frames, no sequence gaps; 37 `observe`, one `set_intent`, 39 attempted requests. Zero body actions/events/writes. Local STOP caused recorded original `user-stop`, SDK request abortion, cleanup and `RUN_RESULT.json`. |

`LIVE_AUDIT.json` is recomputed from complete `events.jsonl` and `frames.jsonl`, including individual input token counts and original errors. It is not an acceptance certificate. `minecraft-server.log`, `llama-server.log`, `INSTALLATION_IDENTITIES.json`, `OWNED_SERVICES.json` and empty `experience-0000.json` are in the actual run directories. No chain of thought or full prompt transcript was saved.

## Implemented versus unverified

| Requirement | Implementation / validation | Status |
|---|---|---|
| Old physics retained | Byte-identical R1/R2/R2A closure; medium, potential recovery, config and Clone hashes independently match old files | validated for checked source identities |
| Event representation | Concrete public values, event-local subject identity, relative change and elapsed event progress; one distance-fitted 3D map | synthetic unit validation; real calibration NOT reached |
| Physical history / random future separation | Active physical trace recall; future output only from actual walk visits and local kernel annotations; off-road/colliding readouts remain unknown | minimal unit validation, not real Minecraft predictive capability |
| Learning and restoration | Empty initialization, synthetic128 once, own V5 snapshot byte-exact restore; R1/R2 erase loses recall and R2A erase loses support | unit-only; synthetic data never loaded by production |
| Model-owned planning/actions | Ordinary Pi tool loop, model-owned intent, no automatic subgoals/reviewer/fallback; body faults and HTTP errors terminate without retry | unit tests pass; real model failed to choose any body action |
| Real perception and display | Ray-filtered public physicsTick frames, loopback first-person and three-media dashboard | actual capture/display observed; no real body motion demonstrated |
| Attention / interruption | Full-window subject changes, current-focus physical query, timing audit, no-output stays unknown, real callback to Pi steering | synthetic production-component test; real supported surprise NOT established |
| Snapshot cadence / stop | Every32 real events and normal goal finish; experience only, no action replay; local operator stop cleans owned processes | empty startup snapshot and stop observed; nonempty live cadence NOT reached |
|128 autonomous real events | None fabricated, none imported | failed: 0/128 |
| Obstacle→button→door / changed-condition demos | Static real redstone fixture and goal entry points exist | NOT run; blocked by initialization |

The action catalogue remains body primitives rather than a result-rule table. Public world coordinates never enter a fixed/invertible R1 transform. The event map is not calibrated from old data. Runtime no-effect learning is implemented but not falsely credited with any actual event in these runs.

Remaining unverified limitations include real-event embedding collision/separation, stable production R2A formation under autonomous exploration, unfamiliar public features after map freeze, causal recall generalization, real stochastic forecast readout, body primitive/event timing across actual actions, and supported attention interruption. In particular, passing a synthetic128 test does not establish that arbitrary real Minecraft changes fit the frozen 3D map.

## Commands and exits

Working directory for all commands: `D:\Kairos_V5_Predictive_Agent`.

- `npm install --ignore-scripts --cache D:\kairos-v5-npm-cache --no-audit --no-fund` — 0.
- `npm install --package-lock-only --ignore-scripts --cache D:\kairos-v5-npm-cache --no-audit --no-fund` — 0 (final direct TypeBox dependency identity).
- `npm run build` — 0; `final-build.log`.
- `npm test` — 0, **11/11**, `final-tests.log`. Earlier narrow tests are not old full-regression claims.
- `node --test dist/test/file-hash.test.js` — 0, stream-hash fix.
- `node --test dist/test/offline-profile.test.js` — 0, exact offline UUID fix.
- `node --test dist/test/analysis.test.js` — 0, no retry/fallback and original body error propagation.
- `node dist/src/main.js` — four invocations, exits 1,1,operator interruption,1 respectively. Separate console logs preserve them; no attempt is passed off as successful exploration.
- `npm run verify` — 0; checks only four protected files and the canonical Formal access file from the old project, plus new-source and new-evidence metadata.

Frozen model: `7485FE6F11AF29433BC51CAB58009521F205840F5B4AE3A32FA7F92E8534FDF5`.
llama.cpp: `5A3CBD5613C45EF2D53D3AFC6734FD9E67229C0066C2415626DDC7C18901D36C`.
Current source, prompt, schema, dependency lock, empty knowledge, protected files and Formal SHA-256 are in `IDENTITIES.json` / `SOURCE_MANIFEST.sha256`. Old Formal remains **accessCount=0, formalOpened=false**, file SHA-256 `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`.

The small post-run attention audit fix keeps `predictionDeviationKnown=false` when a forecast object has no supported output. The before-event candidate signature was also restricted to the actual first public frame, so a subject first discovered later cannot enter earlier candidate retrieval. Direct regressions passed; no additional live run is claimed for those changes (all live writes were zero). Earlier run prompt/schema hashes remain their own original values. Old files were not migrated or rehashed to new expectations.

No training, old264 import, formal world, Candidate or Authoritative package. The 512 action budget remained unused. Server, bot, Viewer/dashboard and model processes were stopped; follow-up listener check for 25566/25567/3000/3002/18080 returned none. Future viewing requires a fresh explicit run; do not mistake the cached page for a live experiment.
