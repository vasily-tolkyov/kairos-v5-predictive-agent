# 连续状态首个原生接入试验：预登记

状态：**未启动，整合软件门禁和新 actor 固定身份待完成。** 当前原始任务对照仍在运行；本次只写登记，不构建、测试、查询模型或运行实机。机器可执行约束见 [preregistered.json](preregistered.json)。

这是一组和平模式的仪器与接入开发试验，检查真实物理帧、按键边沿、实时状态 z 与长期参数 θ 的分离。它不验收工作包 B/C，也不把写入、运行进程、短时动作增多或日志完整性称为长期自主学习或开放多阶段能力。

## 固定起点和条件

复用 R4/R5 相同的原始 `evidence/pr3-local-native-smoke` 停止状态；分别解包到两个全新目录，禁止使用已运行过的 `*-start/runtime`。本次登记只读取旧小型来源文件中的已记录摘要；当前实验结束后，启动前仍须实际核对源文件和新副本。

| 固定对象 | SHA-256 |
| --- | --- |
| 原始 `session.json.gz` | `4459dfca985506fd01a17e9c1d5513244879758bb6082dec390157514ebbb907` |
| 原始 `stopped-world.tar.gz` | `8d7fb3423ef8778f7f49374e5d07ecfa52646f626a68ad2bcb938e9ca228ccb1` |
| 原始世界文件树 | `22cd8aa4e5766d0312ae64edc0a04f317d362db6715fa8212cd472936f4c3563` |
| R4/R5 恢复后的原学习摘要 | `3566f66c62c83bdfcf6a54e7c8c9e4a4bb5a2e178e621a91e2d0ef6560edd8f5` |
| `evidence/pr3-local-timing-goal.json` | `c60111bb15631ce4dd24c3cc7c792db9838b784d44762d546d9603320ec727bc` |

来源是 [R4 登记](../work-package-a-frame-alignment-2026-09-13/preregistered.json)、[R5 登记](../work-package-a-predrain-2026-09-13/preregistered.json)、原始世界归档的 `.provenance.json` 和 `evidence/pr3-local-predrain-start/fork-provenance.json`。目标文件的真实谓词为自身 `position.2 < -5.5`；世界种子 `129604783`、模型种子 `317`、端口 `25638`、Peaceful、32 次**新决策**、180 秒、`goal-after=0`。没有 `--task-only`，没有额外动作预算。超时与准备帧过期全部保留。

固定顺序为 online（`learn:true`）然后 frozen（`learn:false`），每组只启动一次。frozen 使用同一**原始**世界和原始 session，不接用 online 的终点参数。两组在同一冻结 actor 下完成。若新版本增加空的连续组件导致序列化摘要变化，应在启动前单独记录新版本的恢复摘要，说明旧参数没有被重新解释或训练，并核对两组完全相同；不能假称新摘要必然等于旧 actor 的摘要。旧记录没有物理时钟的部分保持未知，不能获得新时序证书。

首组停止并保存审计后才能进入配对组。首组若完整但执行少或无支持，按负结果继续原登记；若完整性失败，应保留并查明，修改后的 actor 属于需要重新登记的新候选，不能冒充同一配对。两组轨迹会因塑性和时序变化而不同，所以最终 z 不同不等于对 z 的因果消融成功。

## 软件门禁、冻结和具体命令

以下命令是**之后的执行配方，目前未执行**。路径均从该工作树根目录出发。只有主任务明确解除当前并行 CPU 禁令，且整合代码停止修改后，才运行完整软件门禁。专项通过不能替代完整集成；所有失败输出与修正后的通过输出分别保留。当前 `test:next-stage` 包含身体、流交付、interval、live、session、continuous readout 和独立审计夹具等现行集成测试。

```powershell
Set-Location -LiteralPath 'D:/Kairos project/.kairos/worktrees/pr3-native-20260913'
npm run test:next-stage
```

通过后，由主任务固定完整源码提交，再执行以下冻结。`freeze-native-actor.py` 复制并逐文件核对已构建的 `dist` 和 `scripts`；它**不运行测试，也不证明工作树干净**。因此先保存源码提交、工作树状态、完整门禁退出码/日志、依赖与源码身份，再创建 `launch-pins.json`，记录登记原字节 SHA、冻结清单 SHA、加载起点摘要以及所有启动检查。不得只记录 HEAD 而省略未提交代码；不得使用还在修改的 checkout 直接运行 evaluator。

```powershell
python scripts/freeze-native-actor.py evidence/execution-builds/pr3-local-r6-continuous
python scripts/fork-stopped-native-checkpoint.py evidence/pr3-local-native-smoke evidence/pr3-local-native-smoke/stopped-world.tar.gz evidence/pr3-local-continuous-start
python scripts/fork-stopped-native-checkpoint.py evidence/pr3-local-native-smoke evidence/pr3-local-native-smoke/stopped-world.tar.gz evidence/pr3-local-continuous-frozen-start
```

两个新 `fork-provenance.json` 的 session、archive、worldTree 摘要都须等于上表。冻结目录和输出目录必须尚不存在；出现冲突要保留并记录原因，不覆盖旧目录。不在 native 运行期间重新构建、冻结、离线重放或启动其他 CPU 实验。

首组完整命令：

```powershell
node evidence/execution-builds/pr3-local-r6-continuous/scripts/evaluate-minecraft-continuing.mjs --java D:/Kairos-Minecraft/runtime/jdk-21/bin/java.exe --server D:/Kairos-Minecraft/server/1.21.4/server.jar --continue evidence/pr3-local-continuous-start --expected-session-sha256 4459dfca985506fd01a17e9c1d5513244879758bb6082dec390157514ebbb907 --output evidence/pr3-local-continuous --seed 317 --environment natural --world-seed 129604783 --difficulty peaceful --goal evidence/pr3-local-timing-goal.json --goal-after 0 --steps 32 --seconds 180 --port 25638
```

首组停止、归档并审计后，在完整性允许的情况下运行固定配对命令：

```powershell
node evidence/execution-builds/pr3-local-r6-continuous/scripts/evaluate-minecraft-continuing.mjs --java D:/Kairos-Minecraft/runtime/jdk-21/bin/java.exe --server D:/Kairos-Minecraft/server/1.21.4/server.jar --continue evidence/pr3-local-continuous-frozen-start --expected-session-sha256 4459dfca985506fd01a17e9c1d5513244879758bb6082dec390157514ebbb907 --output evidence/pr3-local-continuous-frozen --seed 317 --environment natural --world-seed 129604783 --difficulty peaceful --goal evidence/pr3-local-timing-goal.json --goal-after 0 --steps 32 --seconds 180 --port 25638 --frozen
```

每个命令的完整参数、实际开始/结束时间、退出码和原始 stdout/stderr 要保存到独立日志。32 次决策是上限，过期、无 offer、观察停滞、故障或 180 秒先到均保持真实结果，不重复发车，不延长预算。现有等待只是请求 50ms 的软件计时器；实际超限单列，不写成硬实时保证。

## 停止后的归档与证据核验

以下以 online 为例。frozen 停止后将 `$run` 改为 `evidence/pr3-local-continuous-frozen`，逐项使用新的输出文件名。脚本只在停止记录存在后运行，不能对进行中的世界打包。

```powershell
$run = 'evidence/pr3-local-continuous'
$actor = 'evidence/execution-builds/pr3-local-r6-continuous'
python "$actor/scripts/archive-stopped-world.py" $run "$run/stopped-world.tar.gz"
node "$actor/scripts/audit-native-continuing.mjs" $run "$run/stopped-audit.json"
node "$actor/scripts/audit-native-capture-boundary.mjs" $run "$run/capture-audit.json"
node "$actor/scripts/audit-native-worker-freshness.mjs" $run "$run/freshness-audit.json"
node "$actor/scripts/audit-native-frame-state.mjs" $run "$run/frame-state-audit.json"
node "$actor/scripts/audit-native-learning-coverage.mjs" $run "$run/learning-coverage.json"
```

新 frame-state 审计只使用 Node 内置模块和原始记录，不导入 actor、不查询读出、不增加 θ 写入。coverage 命令不传可选 actor 参数，保持默认纯记录核验。freshness 审计有冻结 actor 的事件验证依赖，须与完全独立的 frame/capture 核验分开说明。旧 R5 无 `RealFrameClockV1` 和 `decision.live`，新审计预期给 `unsupported`，不能把它当 B 通过；其非零退出码保留为“缺少此类仪器”的负对照。

必须保存并逐项登记字节数/SHA：

| 证据 | 核对内容 |
| --- | --- |
| 登记、`launch-pins.json`、完整软件日志、源码提交、`freeze-manifest.json` | 精确执行来源、未发生边跑边改、软件反例与失败记录 |
| 两份 `fork-provenance.json`、原始 session/world/goal、实际加载 `checkpointInput` | 相同源字节、世界树、选择/任务状态与加载模型；无起点偷换 |
| `results.json`、`protocol.json`、`requested-goals.json`、`initial-observation.json` | 起止状态、累计与新增统计、固定预算、目标和和平服务器确认 |
| `events/*.json.gz`、`passive-events/*.json.gz` | 每个原始真实窗口、完整共享边界、实际 physics/terminal 钟；不得用拟合子行制造独立样本 |
| `decisions.jsonl`、`physical-actions.jsonl`、`action-intents.jsonl`、`body-diagnostics.jsonl`、原始 `journal` 与 `journal-counts.json` | 所有执行/拒绝分母，准备帧绑定，press/release/unknown 记录，`decision.live` 水位及 gap/缺 trace |
| `session.json.gz` 与初/末学习摘要 | frozen θ/affordances 字节不变；online 写入单列；live 的真实帧同化与 θ 分开；停止/恢复的 epoch、h 和当前可见性重置 |
| `server-evidence`、`server-audit-queries.jsonl`、停止世界归档及 provenance | 独立观察目标与身体结果，真实 Peaceful、世界/玩家终点、死亡与停止一致性 |
| 六类审计 JSON、所有非零退出日志、资源/时延报告、配对汇总 | 拒绝、未测项、缺失/溢出、setup anchor 和 checkpoint tail 不能消失 |

没有某种 journal 的零计数运行，只有最终计数明确为零时才允许其文件不存在。任何异常都保留，不能靠补写伪日志通过。`serializedPayloadBytes` 是传输 JSON 载荷计量；它不等于内存/RSS 上限。

## 本片可支持的结论与仍欠缺的门禁

首片要求连续 physics frame 的 tick 差为 1，terminal 感觉样本 tick 差为 0，单调钟不回退。释放发生在该帧采集之后：最后 held 帧不能改记 off，后续 off 必须有实际释放来源；未测/脉冲控制保持 unknown。receipt、边沿和采样字段冲突直接失败。动态行的实际 dt 不能从 `activeSeconds`、请求 ticks 或最终返回时长倒推。

完整性结论同时看原始区间覆盖、每个决策的 `acceptedFrames/lastSequence/deliveredThroughOrder`、丢队和缺 trace。缺 trace、overflow、无法取得边界或部分运行均不能通过“完整连续覆盖”子结论。cached 初始锚点可进入真实 z 同化，却不能计作新学习窗口；末次 checkpoint/关闭时未归档的尾帧不冒充已学经验。未实际发生的死亡/held 场景只写“原生未覆盖”，软件夹具另列。

frozen 必须在真实帧持续到达时推进 z，同时学习摘要和写入数不变；online 只允许已验证完整原窗口更新 θ。若 online 无新写入或支持仍为零，就报告负结果，不能主动注入训练或改变预算。当前日志能交叉核对水位与计数，但未保存完整传输 order→frame 映射，也没有逐个 live 激活的独立重放；不能仅凭 `decision.live` 证明所有 z 数学计算或每次预测的精确状态绑定。软件反例和源码检查是另外一层证据，强原生结论须补相应事前绑定记录。

[连续状态设计](../continuous-state-design-2026-09-13.md) 的下列工作仍是必要门禁，而不是本片可省略的要求：

- B 的实际 on/off 相邻间隔读出及独立窗口校准；动作发出前从真实初态产生私有 rollout 时间轴，区分 teacher-forced 一步误差与真实多步预演。实际中帧、最终稳定时长不得回填开始输入。
- 保持现有动作返回语义，分别认证释放时刻、可能稳定/返回时长与保守末态包络。返回时长未知时撤销完整末态支持，不能拿释放位置替代下一次决策开始位置。
- 有真实可见线索和后来不同后果的遮挡/历史试验，以及完整状态、清除历史、仅末帧、擦除 motor 时间的匹配消融；固定编码激活本身不证明记忆或保持修复。
- C 的同世界 frozen/erased/online、有不同可感知机制的 A→B→A 保持；陌生真实前提的因果组合、依赖前序实测结果及后续多帧目标确认，不能提供路线/阶段脚本给模型。
- 单独预登记的 1/8/24 小时持续学习、资源有界、知识保持和开放多阶段实机验收。32 次开发决策不能替代这些结果。

本登记**不改变**[原始和平重新获取与任务对照协议](../peaceful-reacquisition-2026-09-13/preregistered.json)：原始世界的 256 决策/1800 秒获取，以及固定 erased-frozen → retained-online → retained-frozen 的 192 决策/480 秒任务对照仍各自完成和报告。这里采用的 smoke 起点与 `z < -5.5` 目标不替换原始世界 `z < -14.5` 目标，也不向其预算追加动作。
