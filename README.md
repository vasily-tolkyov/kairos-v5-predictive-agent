# Kairos V5 · predictive agent development

This isolated version is **not** an old Formal V3 run, Candidate, or claim of open-world general intelligence.

> 私有研究快照（2026-08-29）：这里保存Kairos V5的源码、测试、架构说明和精简审计报告。当前已经建立感知、动作、事件记忆、物理经验核心、注意力与分析工具循环的工程骨架；128条真实事件冷启动尚未完成，因此R1/R2/R2A尚未在V5中形成可用于成熟预测的生产地图。详见[中文架构说明](docs/ARCHITECTURE_ZH.md)和[当前状态](docs/CURRENT_STATUS.md)。

```powershell
npm ci
npm run build
# Start a new, empty, disposable run; only autonomous initialization, no door goals:
npm start -- --bootstrap-only --evidence-dir D:\Kairos_V5_Predictive_Agent\evidence\my-new-bootstrap
# A later, explicitly selected compatible experience source (never resumes actions):
npm start -- --experience-pointer D:\Kairos_V5_Predictive_Agent\evidence\my-new-bootstrap\EXPERIENCE_LATEST.json --evidence-dir D:\Kairos_V5_Predictive_Agent\evidence\my-new-run
```

`kairos.config.json` records the machine-specific development configuration: the designated `deepseek-v4-pro` backend at `https://api.deepseek.com/beta`, Pi 0.84.2, 65536 context, 24000 input-token limit and 32768 output-token limit, native thinking, no retries. Local Java, Minecraft, Python, tokenizer and credential-source paths must be configured on another machine before a live run. No credential, model weight, Minecraft world or runtime state is included in this repository. The configured model name is not a claim about independently verified remote weights or API pricing.

Installed Java 21 and Minecraft 1.21.4 files are read only. Each start creates a **new** disposable V5 server directory. Memory is empty by default; only an explicit absolute `--experience-pointer` loads a compatible `V5PublicRelativeLayoutV1` snapshot through the existing worker restore. There is no source scan, automatic legacy migration or empty-memory fallback on failure. Sources remain read-only; all new evidence must be outside the source directory. Old actions, workspace, short aliases and attention windows never resume. The experienced clock starts at the saved activeSeconds plus actual new physics ticks; offline wall time adds no age. The server binds `127.0.0.1:25567`. All writable run outputs are under `runtime/` and a new `evidence/` directory on D:.

First-person viewer: http://127.0.0.1:3000/ . Read-only goal/attention/physical-media dashboard: http://127.0.0.1:3002/ . Neither viewer is a runtime gate. Close the window freely. Ctrl+C stops the run and cleans up only its own processes. No action is resumed or replayed after a crash.

## Ownership

- `src/core`: byte-preserved physical medium, exponential recovery, stochastic clone, R2/R2A implementation extracted from V4. No old learned parameters or experiences.
- `src/events.ts`, `distance-embedding.ts`, `memory.ts`: concrete public event features, one new distance-fitted three-dimensional R1 map, active physical history recall and local random-visit readout. World coordinates are not R1 coordinates.
- `src/analysis.ts`: the ordinary Pi tool loop: `observe`, `recall`, `predict`, `execute_chain`, `set_intent`, `read_context`, and `finish`. Modes/tasks are model-selected. No code execution, world administration, or model writer exposed to the language model. No fixed subgoal or action-selection policy.
- `src/body.ts`: visible ray-filtered public input and basic actions. Only the currently observed target can be operated. A real no-effect window is an experience; an unexecuted instruction or exception is not.
- `src/attention`: original scoring controller with full real observation windows, current-focus physical forecasts and real interruption/wake delivery.
- `src/runtime.ts`: thin sequencing and observation learning. One compute Worker owns physical state. It is not another agent.

The first 128 complete **new real events** are buffered and fit the representation once, then deposited once in experienced-time order. Active attempts are model-selected; passive captured observations are counted separately. Cold-start absence of prediction is normal. Snapshots every 32 new events and normal goal completion preserve experience, not an action chain. A program error keeps the last successful save; unsaved increments may be lost and a partly failed initialization is never published as a successful map. A new unsupported feature or representational collision is exposed, never repaired with a historical answer or world-coordinate shortcut. `recall` is explicitly historical; `predict` never returns a historical path as its answer.

`--bootstrap-only` uses the same exploration goal and Pi loop but does not proceed to door/changed-condition goals. Without this flag, the existing later goals remain available; a ready restored memory is not initialized again. `--short` is a separate bounded development entry and cannot be combined with `--bootstrap-only`. Source context IDs use only visible local block layout/type/state and quarter-block relative positions. They exclude absolute regions, time, session and body dynamics; differing visible views are not proof of independent rooms or mechanisms.

The static demo fixture is a real button → copper bulb latch → comparator → wire → iron-door circuit with a low obstacle. This setup is not exposed as a rule or action sequence to the model. Fixture code does not respond to bot actions. Ordinary world failure is returned to the model; model/protocol/program/service errors terminate with the original error, no retries or fallback policy.

Unit fixtures are synthetic, temporary and never copied into production memory. Production explanatory knowledge is empty. Raw evidence omits model chain-of-thought and full prompt history.

## Current evidence boundary (2026-08-29)

The production path has executed real Minecraft actions and preserved successful experience snapshots through 64 events. Later unsaved increments and failed attempts are retained only in the original local evidence, not in this repository. The required 128-event representation fit has not completed, so V5 still has zero production physical deposits and no fitted R1 map or naturally established R2A graph. The latest bounded local Qwen3-8B trial completed one question and failed a second tool-semantics task; it is not a full model qualification. Compact source reports are under `evidence-reports/`.

Obstacle/button/door completion, changed-condition behavior, naturally applicable R2A and prediction-supported attention remain unverified goals. A local `STOP` file at the path printed by `V5_READY` requests cleanup; it is not exposed to the model. An interrupted console/job can lose the final summary; raw logs remain on the originating development machine.
