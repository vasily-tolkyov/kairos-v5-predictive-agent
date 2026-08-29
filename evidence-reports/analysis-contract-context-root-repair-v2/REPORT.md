# Kairos V5 分析接口与上下文修复 V2：开发结果

日期：2026-08-28（Asia/Shanghai）。本轮停止于三个关键真实模型问题，未进入剩余五题或 Minecraft。

## 结论分层

- **implemented / validated（限定范围）**：检索替身调用生产纯匹配函数；公开主体、属性及类型约定；公开证据摘要与显式分页；六模式索引与测试初始模式；短测入口绑定本轮八题结果；移除预测热路径整核心哈希。
- **rejected（当前测试配置）**：三个关键 Qwen 问题 0/3；两次不同失败类别的短输入对照 0/2。当前模型在类型化查询、上下文引用及任务边界上仍不能可靠完成要求。
- **未验证**：剩余五项职责/连续性、完整六模式模型能力、新世界短闭环、真实物理检索的行为贡献。工具夹具不是物理能力证据。
- **未运行**：Minecraft、128 初始化、旧资格集、旧完整回归、Formal V3、训练、打包。

这里没有证明“参数量是唯一根因”，也没有添加纠错重试、强制行动或外围替代规划。注意力产生端问题保持另列、未修改。

## 工程改动与证据

| 根因/合同 | 实现 | 验证 |
| --- | --- | --- |
| 测试忽略查询，而生产精确匹配 | `memory.matches` 仅导出；夹具使用相同函数筛选并分页 | 旧 22 次查询中 17 次非空均不匹配；新错误查询返回空；正确主体/属性/类型的定向正例通过 |
| 当前对象别名混同历史主体 | 公开 `self`、`historyQuerySubject`、`queryVocabulary`；别名只用于当前动作 | 自身、第二属性、同类型两个历史主体的匹配测试 |
| 原始物理内部数据挤占分析输入 | 模型只看公开变化、历史条件、当前适用度和未知项；内部坐标/痕迹/哈希留本地；明确分页 | 内部字段隔离、分页不丢公开条件、原始数据哈希不变 |
| `read_context` 被摘要替换或显示字段无法读取 | 显式读取保留；任务公开表示共用同一函数；原始目标引用可读取 | 首次真实调用暴露 `objectiveReference` 缺口；针对红测失败后修复并绿测 |
| 六模式测试被路由覆盖污染 | 不变提示列出六模式；测试可单独指定初始模式，生产仍 orient | 测试钩子与模式覆盖维度分开；本轮仅前三题和两次对照实际运行 |
| 身体正常无目标与程序错误混淆 | 夹具区分 no-target、out-of-reach、已执行但无效果；未知别名仍报错 | 无目标/范围/无效果、通知后停止未执行链测试 |
| 预测前后整状态哈希造成热路径负担 | 删除 runtime 的整核心热路径哈希调用；只读性由相关测试检查 | runtime 零整核心哈希调用、原随机克隆只读测试 |
| 短测绑定旧 003 与整个源码身份 | 检查本轮问题、配置、提示、模式和八题实际结果 | `verifyShortLoopGate` 当前明确拒绝：`short-loop-current-eight-questions-not-solved` |

修改共 13 个文件，逐文件前后哈希见 `FINAL_AUDIT.json`：

- `src/analysis-actions.ts`、`src/analysis-context.ts`、`src/analysis-harness.ts`、`src/analysis.ts`
- `src/cognitive-workspace.ts`、`src/main.ts`、`src/memory.ts`、`src/runtime.ts`
- `test/analysis-contract-v2.test.ts`、`test/analysis-harness.test.ts`、`test/analysis.test.ts`、`test/cognitive-workspace.test.ts`、`test/runtime-context.test.ts`

使用约定：检索自身使用 `subject: self`；历史对象使用公开类型或历史角色，而不是当前 `oN` 别名。`value` 保持原 JSON 类型；`increase/decrease` 仅用于数值。没有匹配就返回空，不替模型改查询。分页必须使用对应证据引用及真实字段；错误字段保留错误并退出，不代为猜测。

## 实际命令与工程结果

工作目录均为 `D:\Kairos_V5_Predictive_Agent`，Node 为 `D:\nodejs\node.exe`。完整命令/退出码索引见 `COMMANDS.json`，原始控制台日志同目录保存。

- 初始根因红测：6 项，1 通过、5 失败，退出 1（`RED_TESTS.log`）。
- 首次相关绿测：33/33，退出 0（`TARGETED_TESTS.log`）。
- 短输入对照上下文相关测试：20/20，退出 0（`COMPARISON_CONTEXT_TESTS.log`）。
- 真实调用暴露的任务字段红测：0/1，退出 1（`READ_CONTEXT_REFERENCE_RED.log`）；对应分析/上下文绿测 21/21，退出 0（`READ_CONTEXT_REFERENCE_GREEN.log`）。
- 去重后共 **35 个直接相关测试**有通过证据；这不是声称最后一次跑了一个 35 项全量套件。
- 另有 **2/2** 原物理只读/随机读出测试通过，退出 0（`READONLY_PHYSICAL_TESTS.log`）。未执行 128 经验初始化测试。
- 构建最终退出 0。期间一次 TypeScript 回调签名错误退出 2，原输出保留在 `BUILD_FINAL.log`，修复为显式 lambda；后续成功构建 stdout 为空。不能把这个文件名误读为最终构建失败。

## 真实 Qwen：三个关键问题及两次有限对照

保持 Qwen3-4B / 8192 上下文 / 6500 输入上限 / 768 输出上限 / temperature 0 / seed 1262836050 / Pi 0.84.2。没有切换模型或参数。

| 问题 | 请求数 | 输入词元 | 实際结果 |
| --- | ---: | ---: | --- |
| 当前事实 vs 历史 | 11 | 5086–6396 | 当前槽位 4 与目标 7 的区分读对；但查询 `self.selectedSlot unchanged 4` 无匹配后仍声称历史未变化，最终自由文本结束而未 `finish`。不能把自动评分中的 false 当作“把当前 4 读成 7”的证据。 |
| 精确查询条件 | 3 | 5090–5405 | 将 lit 查在 self，且布尔值写成字符串 `"true"`；正确返回空。之后对历史证据读 `/page/objects`，字段不存在而退出。 |
| 只做方案、不行动 | 6 | 5082–6411 | 将数值 6 写成字符串 `"6"`，历史为空；调用无支持的零角度 look 预测；随后实际调用夹具 execute_chain 执行零角度 look，违反只分析要求。并非执行了槽位切换，也不是 Minecraft 动作。 |
| 当前事实题：短输入对照 | 1 | 4928 | 对任务 t0 读取观察词汇路径，引用对象错误，退出。 |
| 精确查询题：短输入对照 | 2 | 4977–5170 | 使用 copper_bulb，但 lit 布尔值仍写成字符串且使用数值 increase；随后对历史证据读取观察词汇路径，退出。 |

三题 **0/3**，两种失败类别的对照 **0/2**。对照只削减无关对象/已完成旧交互；原目标、必要事实、工具、匹配函数和模型配置保持不变。

另有一次实现错误尝试 `questions-001`：1 请求、5082 输入词元，读取已显示的 `/objectiveReference` 却被程序拒绝。它只算实现失败，不算模型能力失败。修复后才产生 `questions-002`。

合计 **24 次真实生成请求**，每次原始请求、结构化工具输出、最终文本、耗时和词元保存在各案例 `RAW.jsonl` / `RESULT.json`；没有保存思维链。输入范围 **4928–6411**，均未超过 6500。

修复后的 4 次真实模型 recall 均因填写条件不正确而返回空，非空错误结果为 0。因此只能说**匹配契约已一致**，不能说本轮 Qwen 已证明成功取回匹配物理经验。

第一题/第二题完成后，原 driver 对字段错误采用笼统 `program-or-service-error` 分类并退出。保留其 `SUMMARY.json`，没有修改成通过。随后只用同一已实现 `runCase` 接续尚未运行的第三题及两次获准对照；没有重跑前两题选优。最终合并结果以 **`questions-002/CONTINUATION_SUMMARY.json`** 为准，接续调用约束在 `continuation-service/INVOCATION.json`。

## 输入预算与权限边界

`questions-002/6814_MATERIAL_REPLAY.json` 使用旧实际材料、完整最后工具交互及真实 llama 分词：原报 6814，当前 **6057**。本次只有模板/分词调用，生成调用 0；六个证据引用和存储数据保持，未用伪 token 估计或改上限。

实际发生：夹具动作尝试 1、执行 1（零角度 look，无目标状态变化）；**真实 Minecraft 动作 0、真实 writer 0**。不把夹具 `executed` 算物理成功。导入的旧公开帧只作封闭接口测试材料，不加载生产模型，不沉积旧经验。

错误字段、模型不提交 finish、只分析却调用动作均原样保留；没有加自动纠错或运行时替代决策以凑门。剩余五题、六模式全部真实职责能力及新世界短闭环仍未验证。

## 身份、旧证据与安全关停

- 开始源码身份（51 文件）：`62D509AC73D487A5843C57C79689C51328AF5E5DEE220C2644033466DA30D920`。
- 最终源码身份（52 文件）：`98AD8D980CAA5BCB7B58E435205BA7D7F5002690931FEC268458A9F1C5C7F6B8`。
- 使用现有 `AnalysisHarnessSourceIdentityV1`：src/test 的 ts/mjs + package.json/package-lock.json/kairos.config.json，规范化相对路径、固定排序、逐文件 SHA-256、canonical JSON 聚合。不是旧 verify.ts 的另一种文件集合。
- 提示身份：`65231BB55ADDCAE9F517F930C0861FA22BFE2D8055513ECD5518DD2D5FA8D459`。
- 工具模式身份：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`。
- 冻结 GGUF：`7485FE6F11AF29433BC51CAB58009521F205840F5B4AE3A32FA7F92E8534FDF5`。
- llama：`5A3CBD5613C45EF2D53D3AFC6734FD9E67229C0066C2415626DDC7C18901D36C`。三次启动均真实核验，见 OWNED_SERVICES；收尾不重复散列大文件。
- memory.ts 当前内容仅移除新增 `export `后，整文件字节哈希精确回到基线 `2AF514062DF0694C42AFE2CEB3F65E4F58543C87B96FC09E61C9CD63AF07C045`，没有改变匹配函数体或物理过程。

| 受保护文件 | 未变 SHA-256 |
| --- | --- |
| physical-medium.ts | 40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A |
| potential-page.ts | 85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922 |
| prediction-clone.ts | 7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC |
| core/config.ts | AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E |

旧 `analysis-harness-v1/EVIDENCE_MANIFEST.sha256` 文件仍为 `6D86609B67C7F0DD63248DF5C33EB9F6FCB378F70A8847490F9CDCA09A3A8560`；本轮只核对这个已冻结清单文件并只读重评相关查询，未重新扫描整个历史树。旧报告中源码 JSON 清单身份与平面清单文件哈希混用的问题不予回写，本报告使用上述明确算法。

Formal V3 **0 / false**，状态文件 SHA-256 仍为 `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。未打开任何旧正式场景。

收尾系统查询显示 18080/25567/25566/3000/3002 无监听，三个本任务分析 PID 均已退出；从未启动 Minecraft 服务端或 Viewer。原始系统查询结果及时间见 `FINAL_AUDIT.json.shutdown`。

## 独立只读审查入口

先读 `RAW_RESULT_INDEX.json`、`FINAL_AUDIT.json` 和 `questions-002/CONTINUATION_SUMMARY.json`，再对照各 `RESULT.json` / `RAW.jsonl`；这些是接口夹具上的真实 Qwen 输出，不是完整原型验收。

无需重新启动模型，即可在工程目录运行：

```powershell
& 'D:\nodejs\node.exe' --input-type=module -e 'import {readFile} from "node:fs/promises"; import {CASES,scoreCase} from "./dist/src/analysis-harness.js"; for (const c of CASES.slice(0,3)) { const r=JSON.parse(await readFile("evidence/analysis-contract-context-root-repair-v2/questions-002/"+c.id+"/RESULT.json","utf8")); console.log(c.id,scoreCase(c,r)); }'
```

只读评分不代替人工核对自由文本含义。不要运行普通 npm start；本轮停止条件已触发，新实机短测不获准。

本报告不把普通工程测试通过等同于模型任务通过，不将模型/接口使用失败上升为物理理论矛盾；当前问题交顾问独立只读审查后决定下一步。
