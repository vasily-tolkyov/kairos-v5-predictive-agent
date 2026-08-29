# Kairos V5 — DeepSeek 后端最小接线结果

## 结论

**接线已完成并通过相关离线测试；八题没有获得全部通过结论；未运行 Minecraft 短闭环。**

- 保留同一 Pi 0.84.2、提示、工具 schema、原八题、封存公开夹具和物理实现。生产侧只改提供方、协议、预算、私密内容过滤及严格参数边界。
- 八题均完成明确报告，无案例级运行异常。原自动分数 **6/8**；首题经顾问独立审定后 **7/8**。首题原 RAW/RESULT/SCORE 和原 SUMMARY 均未修改，也未重新生成首题答案。
- 最后题仅 `uncertaintyWhenNeeded=false`。通知送达、读取确认、原目标保留、实际返回核对与无重复动作均通过。任务笔记写“与槽位目标无关”，最终报告写“与选中槽位无关”；前者可以是目标相关性判断，后者有因果范围歧义。保留原评分，交顾问裁定，不推断为注意力未接通或普遍因果推理失败。
- 共 **60 次真实 API 生成**：首个未完成协议尝试 4 次，完成八题 56 次。两个续跑入口预检错误各为 0 请求。没有语义失败后的重跑、短输入对照或新解题提示。
- 夹具动作 6 次；**Minecraft 真实动作、预测核心写入、128 初始化、Formal 访问均为 0**。夹具结果不证明真实物理能力或真实注意力产生端。

## 原始逐题结果

| 原题 | 请求 | 耗时秒 | 原自动评分 | 目前结论 |
|---|---:|---:|---|---|
| current-versus-history | 9 | 56.38 | false | 独立审定通过；否定目标“7”被正则误识为当前值 |
| exact-query-conditions | 4 | 59.67 | true | 通过；布尔 true 精确检索，明确历史与当前适用度区别 |
| plan-without-action | 11 | 187.17 | true | 通过；只研究历史/预测与局限，无动作 |
| act-check-body-result | 5 | 39.23 | true | 通过；尝试完成但无效果，不宣称目标达成 |
| explore-test-question | 7 | 119.71 | true | 通过；自提问题、试探、核对并保留夹具/预测限制 |
| review-new-fact | 7 | 129.20 | true | 通过；旧值4保留为历史，当前值更新为3 |
| continuity-read-early-evidence | 9 | 156.08 | true | 通过；全部历史分页、早期证据回读、条件差异 |
| continuity-notice-and-task | 4 | 61.12 | false | 唯一未过项是不确定性评分；表述边界待独立裁定 |

逐题原文、请求、工具参数与结果位于 `questions-002/<题名>/{RAW.jsonl,RESULT.json,SCORE.json,FIXTURE_TIMELINE.json}`。`FINAL_QUESTION_RESULTS.json` 是派生索引，不代替原记录。首题审定来自 `D:/Kairos project/.kairos/logs/2026-08-28-v5-deepseek-current-fact-score-adjudication.md`，SHA-256 为 `12A6DB0B9E87D8477D1D3E5D7C7FF0A9AD35622DEE5B85D768DD28DB6ADDE0D2`。

末题的通知实际内容、任务笔记、最终报告和各项检查分开保存在 `LAST_CASE_EVIDENCE_BOUNDARY.json`。不修改原评分正则或原始分数。

## 提供方、预算与观测边界

请求目标是 `https://api.deepseek.com` 的 `deepseek-v4-pro`，原生 thinking 开启，reasoning_effort=high；上下文32768、输入上限24000、总生成8192、单请求120秒、重试0。没有发送 Qwen 采样参数或强制 tool_choice。

实际记录的最大本地官方渲染输入为 **21548**，服务 usage 输入为 **21627**，最大生成 **4723**，最大单请求耗时 **54.492秒**，均未越固定预算。60次生成的服务 usage 合计：输入595321（含缓存），输出56070，其中 reasoning token46041；reasoning 是输出子项，不再重复加总。逐请求数据见 `REQUEST_USAGE_AUDIT.json`。首请求本地5190、服务5269，相差79；没有为了凑相等追加请求或改变模板。

**服务端实际 model 身份未独立取得。** 现有日志字段由 `message.responseModel ?? model.id` 生成，不能排除只是请求模型名的后备值。远端权重无本地 SHA。Pi 自定义模型的 cost=0 只是本地未配置计费，**不是 API 免费或真实账单**。见 `MODEL_IDENTITY_OBSERVATION_BOUNDARY.json`。

仅从指定 CC Switch SQLite 提供方行只读取得密钥；密钥只用于内存和官方请求头。原生思考仅在当前会话内回传，不进入日志、工作记忆或磁盘。合成标记测试验证了传输与不落盘；真实 RAW 的私密结构字段扫描为0。官方 tokenizer/renderer 固定 revision、下载 URL 和文件 SHA 均见 `TOKENIZER_ASSETS.json`。协议依据为 [DeepSeek 官方思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)，分词文件来自[固定官方仓库版本](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/tree/b5968e9190ef611bbf34a7229255be88a0e937c1)。

## 修改与验证

修改：`kairos.config.json`、`src/analysis.ts`、`src/analysis-context.ts`、`src/services.ts`、`src/analysis-harness.ts`、`src/main.ts`、`test/reasoning-profile.test.ts`。

新增：`src/analysis-provider.ts`（指定提供方只读凭据/官方分词薄调用/私密过滤）、`src/deepseek-token-count.py`（stdin内存材料→官方 renderer/tokenizer→计数）、`test/deepseek-backend.test.ts`。

现有 beforeToolCall 检查原始与 SDK 验证后的参数；字符串 slot 被 SDK 转为数字时拒绝，合法数值不改，recall 布尔/字符串不互转。没有新规划器、动作替代策略或物理写入路径。

- 构建两次均退出0：初次接线，以及下述真实协议错误的最小修复。
- 首次直接测试 **8/8**；空原生字段修复后仅重验相关 **2/2**。合计9个不同测试，10次测试执行。未跑旧全量测试、可视化或旧资格集。
- 第一真实尝试在第4次返回后，本地错误地要求每轮思考非空而拒绝下一请求。修复为保留服务原有空字段及此前非空字段，不伪造思考；原失败保存在 `questions-001` 和 `PROTOCOL_REPAIR.md`。
- 首三题驱动退出1（原评分假阴性）。仅在新的独立审定授权后，调用既有 runCase 继续尚未运行五题。续跑入口两个发请求前的记账错误及零调用证据保存在 `CONTINUATION_PREFLIGHT_FAILURES.md`，不隐藏为模型重跑。有效续跑退出1（末题唯一评分失败）。
- `COMMAND_RESULTS.json` 保存实际命令、退出码和日志路径；原始日志均保留。`CONTINUE_UNRUN_CASES.mjs` 只是既有导出 runCase 的一次性调用记录，不是第二个智能体/评分器；已有案例目录存在时拒绝再运行。

## 实机为何未运行

八题目前未全部通过；此外，按顾问补充要求做了只读前提核对：

1. attention.capture 被动事件先排队，recall/predict 先推进介质时间，execute 才 flush；已排队的0.10事件在推进到0.15后可能触发 `event-arrived-after-time-was-advanced-past-it`。本轮未重现实机或修改该旧队列实现。
2. `--short` 只限20个模型请求，不能约束每次 execute_chain 的动作数或被动事件数；PhysicalMemory 在128事件时会自动初始化。因此现入口不能保证本轮“禁止128初始化”。

证据见 `SHORT_PREFLIGHT_READ_ONLY.json`，原始复现由顾问提供，已明确标注 `reproducedByThisTask=false`。本轮不修物理/队列、不绕过短测入口、不用普通 npm start 代替。真实回忆、随机预测、R2A适用度、注意力产生端、多步实机能力都未在本轮获得验证。六模式用到了既有测试初始模式，不能宣称自主模式路由全部被证明。

## 身份与封存

最终源码56项，聚合 SHA-256：`FC87A79821521A4BC2246166675AC92411D426AC65A03E657087A8F9ED63DE69`。完成首三题、续跑前后与最终源码相同；提示/schema/案例及依赖锁不变。

- 提示：`65231BB55ADDCAE9F517F930C0861FA22BFE2D8055513ECD5518DD2D5FA8D459`
- 工具 schema：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`
- 八题：`44FB24E9D42ED9C75F9CFF253F825CC007E608916B77D57EBA24B607A5835FA2`
- 旧 Qwen 证据清单：`5BD208272C5975834976CBDFBD2DDFC5ED27A9C01636BA57DF47F60DD4458CEF`，未改。
- 旧 Formal V3：`accessCount=0, formalOpened=false`，状态文件 SHA `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`，未改。

`READ_ONLY_BOUNDARY_AUDIT.json` 核对28项物理/运行边界文件，失配0；含 PhysicalMedium、PotentialPage、PredictionClone、核心配置、memory/runtime 等。未扫描历史证据全树。端口18080、25566、25567、3000、3002结束时无监听；本轮未启动游戏、viewer 或本地模型服务。

`SOURCE_MANIFEST.sha256` 与 `FINAL_SOURCE_IDENTITY.json` 提供逐文件源码；`EVIDENCE_MANIFEST.sha256` 覆盖本轮所有封存证据（不包含清单自身）。不生成任何包。顾问可离线重算 SHA 与 scoreCase；不要重跑真实模型来选择更好结果。

只读复评分命令（工作目录为 `D:\Kairos_V5_Predictive_Agent`，不会读取凭据或调用模型）：

```powershell
& 'D:\nodejs\node.exe' --input-type=module -e "import{readFile}from'node:fs/promises';import{CASES,scoreCase,RUN_ROOT}from'./dist/src/analysis-harness.js';for(const s of CASES){const r=JSON.parse(await readFile(RUN_ROOT+'/'+s.id+'/RESULT.json','utf8'));console.log(JSON.stringify({id:s.id,...scoreCase(s,r)}));}"
```

该命令应保持原自动6/8，不包含首题的独立语义审定。需要复验接线时，只运行本地合成HTTP测试，不重跑真实资格：

```powershell
& 'D:\nodejs\node.exe' --test --test-name-pattern 'DeepSeek:|real Pi adapter' dist/test/deepseek-backend.test.js dist/test/reasoning-profile.test.js
```
