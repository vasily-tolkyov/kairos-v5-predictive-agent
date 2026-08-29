# 同一 Qwen3-4B 原生思考配置：有界开发结果

2026-08-28，单任务执行。本轮结论：**配置接通，原三题通过 2/3；第二题存在真实语义失败，因此停止。** 未运行剩余五题、Minecraft 短闭环、128 初始化或旧 Formal。

执行依据：`D:\Kairos project\.kairos\logs\2026-08-28-v5-qwen4b-reasoning-profile-bounded-plan.md`，SHA-256 `846C8B28A7FF10A1D6919E61C9A3A4825859EE1E9312B705C1948C419A0A16EB`。

## 改动与边界

复用原 Services、AnalysisCore、Pi Agent、上下文预算函数和测试驱动。没有第二套智能体、强制工具、查询类型转换、替代规划、自动重试或更强模型。

- `kairos.config.json`：唯一预注册的新配置。
- `src/services.ts`：将实际配置用于服务启动参数，并复用同一采样字段生成函数。
- `src/analysis.ts`：SDK reasoning 声明、原生思考开关、采样、生成上限透传；只记录公开输出、用量、终止原因、耗时和是否解析到独立推理字段。
- `src/analysis-context.ts`：分词使用实际请求的聊天模板参数；预算取实际 context / max_tokens；保留 6500 输入上限和原上下文组织。
- `src/analysis-harness.ts`：复用 V2 的八题、公开帧、夹具、评分；新结果目录；前三题各一次，失败不再加对照；区分配置、长度、时间、服务和任务失败。
- `src/main.ts`：既有 `--short` 指向当前结果目录与配置，仍须八题通过。
- `test/reasoning-profile.test.ts`：新增配置/分词/推理隐私/输入与输出上限/超时/不重试测试。
- 三个旧测试文件仅适配显式配置及预算函数参数：`test/analysis.test.ts`、`test/cognitive-workspace.test.ts`、`test/runtime-context.test.ts`。

构建后的本地 SDK 核对还发现：HTTP SDK 在响应头到达后清除自身 timeout，不能覆盖后续 SSE。已在同一 streamFn 增加同值的整流 AbortSignal；它只落实既定 120000ms，不增加续写、重试或预算。这是配置接线修正，不是模型决策策略。

未修改七个工具的提示/模式/参数语义、任务与匹配逻辑、公开材料内容、物理/表示/恢复/随机机制、PredictionClone 或注意力产生端。

## 实际配置与接通证据

| 项目 | 本轮固定值 |
| --- | --- |
| 模型 / Pi | 同一 Qwen3-4B Q4_K_M / 0.84.2 |
| 原生思考 | 服务 `--reasoning on`，请求 `chat_template_kwargs.enable_thinking=true` |
| 解析 | `--reasoning-format deepseek`；SDK `qwen-chat-template` |
| 采样 | temperature 0.6、top_p 0.95、top_k 20、min_p 0、presence_penalty 1.5 |
| 固定种子 / 并发 | 1262836050 / 1 |
| 上下文 / 输入上限 | 16384 / 6500 |
| 总生成上限 / 总流超时 | 4096 / 120000ms |

`FROZEN_INPUTS.json` 在模型生成前固定源码、配置、提示、工具和案例；`questions-001/OWNED_SERVICES.json` 保存真实启动命令及自有 PID。Pi 的本地 thinking level 只作为布尔开启信号，不发送额外推理强度预算，也未改 Codex 设置。

全部 9 个实际请求具有相同采样配置、4096 生成上限和 enable_thinking=true。首个预检输入 **5082**，服务返回 input + cacheRead **5082**，两者相同，见 `FIRST_REQUEST_TOKEN_COMPARISON.json`。未反复校准。

SDK 在 9/9 响应中解析到独立 reasoning 内容；正文不落盘，也没有被重放到下一请求。服务/SDK 的 `usage.reasoning` 字段仍报告 0，不能据此声称推理词元实际为 0；本轮没有可靠的推理/最终文本分项，只保留总生成量。原始推理没有进入 RAW、工作区或检查点。

## 工程验证

工作目录 `D:\Kairos_V5_Predictive_Agent`，Node `D:\nodejs\node.exe`。

- 配置实现后的 TypeScript 构建退出 0。
- 直接相关测试 8/8，退出 0，`TARGETED_TESTS.log`。
- 补齐 SSE 全流截止后的构建退出 0；仅复验 SDK 透传与新增截止测试 2/2，退出 0，`STREAM_DEADLINE_TESTS.log`。
- 共 9 个不同的相关测试通过，不是旧 35 项或旧全量回归。没有运行旧资格矩阵或物理校准。
- 真实资格命令 `D:\nodejs\node.exe dist/src/analysis-harness.js` **退出 1**：三个诊断正常完成，但模型任务门未全过。

命令、退出码和日志哈希见 `COMMANDS.json`。成功编译 stdout 为空，没有伪造不存在的构建日志。测试中使用的是标记过的合成推理片段，用来证明过滤行为，不是保存真实思维链。

## 三题原始结果及人工语义核对

| 原题（各一次） | 请求数 | 输入词元逐次 | 结果 |
| --- | ---: | --- | --- |
| 当前事实与历史 | 3 | 5082 / 5130 / 5583 | **通过**。observe 后确认当前为4；正确查询数值型 `self.selectedSlot → 7`，返回匹配历史；明确当前目标未达成。没有动作。 |
| 铜灯条件 | 3 | 5086 / 5287 / 5432 | **失败**。主体/属性改对，但把布尔值写成字符串 `"true"`；工具返回空，最后却声称“历史记录显示……曾被设置为true”。 |
| 只推演 | 3 | 5078 / 5380 / 5570 | **通过当前接口题**。正确以数值6查询历史，预测 select-hotbar(slot=6)，引用历史与预测后结束；实际动作调用0。 |

第二题不是单纯评分正则不命中：RAW 可直接核对到 `candidates=[]`、`total=0`，之后只读取了查询自身，最终结论却声称有历史支持。它还在未读取其余对象页时断言当前帧没有该对象位置/状态；完整公共观察实际包含 o8 copper_bulb，带 `lit=false/powered=false`。应保留“尚未读取/尚不能核实”，不能把未读页判作不存在。

第三题的 support=0.8、24个样本等是**原封闭接口夹具**的内容，不是真实 R1/R2/R2A 预测实验；模型也明确提到测试环境。其通过不能证明真实物理能力或目标达成。

最终统计（从逐请求文件生成 `RAW_RESULT_INDEX.json`）：

- 9 次生成请求，三题各3次；输入 **5078–5583**。
- 总报告输出 **5418** token，单次最大 **808**，没有达到4096长度上限。
- 单次最大耗时 **20275.7505ms**；无120秒超时，所有终止原因为 tool_calls。
- 无配置不通、HTTP/格式退出、长度不足或时间不足；剩余失败属于**当前配置下的模型语义/接口使用**。
- 夹具动作尝试/执行均0；真实 Minecraft 动作与 writer 均0。
- 没有追加短输入、改种子、改参数、重跑题目或扩大资格集。余五题和实机短闭环均未运行。

相较旧配置，本组三题从 0/3 到 2/3，仅说明这套预先固定的整体配置有局部改善。不能将改善单独归因于“思考开关”，也不能将剩余失败归结为参数量唯一不足。完整分析职责仍未通过。

## 身份与只读边界

- 基线源码：`98AD8D980CAA5BCB7B58E435205BA7D7F5002690931FEC268458A9F1C5C7F6B8`。
- 本轮源码（53文件）：`1F1592EB5B77FC04D27BA6D31A04069C769533EA098767ED0074A5D372E74F1C`；生成前后完全相同。
- 配置 canonical SHA-256：`7C03755F1111AB2C3C2F07DE0600177746FF633C4C44BEB1867C8F3693182E8D`。
- 提示（不变）：`65231BB55ADDCAE9F517F930C0861FA22BFE2D8055513ECD5518DD2D5FA8D459`。
- 工具模式（不变）：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`。
- 案例（不变）：`44FB24E9D42ED9C75F9CFF253F825CC007E608916B77D57EBA24B607A5835FA2`。
- GGUF（原启动核验一次，无额外大文件扫描）：`7485FE6F11AF29433BC51CAB58009521F205840F5B4AE3A32FA7F92E8534FDF5`。
- llama（不变）：`5A3CBD5613C45EF2D53D3AFC6734FD9E67229C0066C2415626DDC7C18901D36C`。

| 物理保护项 | 不变 SHA-256 |
| --- | --- |
| physical-medium.ts | 40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A |
| potential-page.ts | 85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922 |
| prediction-clone.ts | 7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC |
| core/config.ts | AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E |

旧 V2 证据清单文件仍为 `A42C6D77D2E3A0827DB699260444E1F7CB2E44CB8C8DF08A14B7BADADDBAB958`；旧协议文件未变，未重扫整个历史树或改写任何旧结果。

Formal V3 仍为 **accessCount=0 / formalOpened=false**，状态 SHA-256 `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。没有初始化、训练、候选包或旧场景访问。

本任务分析 PID 21576 已退出。系统查询中 18080/25567/25566/3000/3002 无监听；没有启动 Minecraft/Viewer，没有操作其他服务。实际检查时点见 `FINAL_AUDIT.json.shutdown`。

## 独立审查入口与剩余边界

先读 `RAW_RESULT_INDEX.json`、`FIRST_REQUEST_TOKEN_COMPARISON.json`、`FINAL_AUDIT.json` 和 `questions-001/SUMMARY.json`。每题 `RAW.jsonl` 与 `RESULT.events` 已逐结构比较相等；可独立核对公开请求/输出、查询实际返回及结束报告。源码清单和新证据清单在本目录。

不需要启动模型即可重新调用已有 `scoreCase` 审查，自动分数只是辅助；请重点核对铜灯空检索后的无依据陈述。不得为了更好分数重新运行本组。

本轮按停止线回传顾问，由顾问考虑下一步模型评估。没有自行换模型或堆外围策略。真实128初始化、R2A条件形成、随机预测贡献、注意力产生端与真实多步任务仍须以后独立验证。
