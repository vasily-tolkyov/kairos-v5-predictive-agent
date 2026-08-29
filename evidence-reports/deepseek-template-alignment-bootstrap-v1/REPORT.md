# DeepSeek 计数模板对齐与一次自主初始化续验

日期：2026-08-28。工程：`D:\Kairos_V5_Predictive_Agent`。

## 结论

计数模板修复通过；真实自主初始化未完成。本轮只运行一次新的空经验 `--bootstrap-only`：20 次模型调用中，19 次成功响应的本地/服务输入计数全部精确相同，第 20 次触发原有 `analysis-request-timeout:120000ms`。17 个真实动作形成 17 条初始化缓冲事件，未达到 128 条，物理沉积为 0。没有重试、延长时限、提高预算或补动作。

停止分类：环境/调用时限阻断。已观察到的是客户端既有请求截止与 `Request was aborted`；服务端内部原因未独立取得，不能据此判定模型拒绝行动、上下文耗尽、HTTP 400 或物理理论失败。第 20 次本地输入 20,630，未取得完整服务用量；SDK 的零用量不能解释成服务实际输入为零。生产计时为 120,003.7659ms，不将它冒称为独立测得的服务端推理时长。

## 实际变更

- `src/analysis-provider.ts`：只更新官方 tokenizer revision 和 renderer SHA-256 常量。
- `kairos.config.json`：只将 `analysis.tokenizerRoot` 指向 `runtime/deepseek-tokenizer-0813-3c6b304`。
- `test/deepseek-template-alignment.test.ts`：新增 6 个直接反例/接线测试。
- 新官方计数资产单独保存；旧 `runtime/deepseek-tokenizer-b5968e9` 保留。词表和 LICENSE 复用相同字节，没有下载权重。

没有修改 analysis.ts、analysis-context.ts、Python 包装器、Pi、提示、工具、物理、表示、恢复、注意力、动作或保存策略。输入 24000、上下文 32768、输出 8192、high、120 秒、512 动作预算及初始化 128 均不变。没有添加“+79”生产补偿。

官方 renderer 来源：
https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813/raw/3c6b30435c8590933c489be0c5200691559e0576/encoding/encoding_dsv4.py

| 身份 | SHA-256 / revision |
| --- | --- |
| 官方 revision | `3c6b30435c8590933c489be0c5200691559e0576` |
| 新 renderer | `ABC0D26120250DDA0AE077DC64AA28836026E61E970854AAEB792445E6A0DDE6` |
| 共用 tokenizer.json | `8F9F37CA37FDC4F5FD36D5CF4D3B0E8392EDB4E894FD10CC0D70B4957C8633CF` |
| 共用 LICENSE | `F2C6C602815669D292889E5BE8C802F2ED950653B77999B1584E8E6AED25D040` |
| 旧 renderer（未改） | `BDBD57C132A1B3725042323D02B98B9D1DF28E5F388F134399555D041F5055E0` |

## 验证与原始命令

所有命令在工程根运行。命令、真实退出码、时长和原始日志分别保存在 `*_COMMAND.json` / `*_RAW.log`；未运行旧全量、旧模型题、短测、性能计时或合成 128 条拟合。

| 项目 | 命令/记录 | 结果 |
| --- | --- | --- |
| 修改前红测 | `RED_COMMAND.json`、`RED_RAW.log` | exit 1，旧 5286 不等于封存服务 5365，符合红测预期；模型调用 0 |
| 唯一构建 | `D:/nodejs/node.exe node_modules/typescript/bin/tsc -p tsconfig.json` | exit 0；3724.8105ms |
| 明确文件定向测试 | `D:/nodejs/node.exe --test --test-reporter=tap dist/test/deepseek-template-alignment.test.js` | exit 0；6/6，skipped=0；7671.8824ms |
| 唯一实机运行 | `D:/nodejs/node.exe dist/src/main.js --bootstrap-only --evidence-dir evidence/deepseek-template-alignment-bootstrap-v1/bootstrap-001` | exit 1；1018524.4747ms；原始请求超时 |

直接测试证明：

- 首请求恢复生产工具 schema 原字段顺序，规范请求 SHA 保持 `2E6004BF5CDBEF690DCD034B22496921DD7DF05660B9194094A13A6955AB9405`。旧计数 5286，新计数 5365，封存服务 5365；没有重发旧题。
- 直接官方 renderer 只添加一次 high 前缀；原系统、用户与工具均参与计数。5365 不是手加常数。
- 明确标记的合成边界输入：旧计数 23961、新计数 24040；既有 `budgetPayload` 移除一个完整旧交互组后为 4096，目标、必要证据及最新工具调用/返回配对保留。
- 必需材料自身 25098 时在模型调用前拒绝；不截断关键材料、不提高上限。
- Pi 的模拟 HTTP 用量测试验证 input + cacheRead + cacheWrite 仅计一次；此测试远端请求 0，不冒充真实模型验证。

## 唯一实机原始结果

`RUN_AUDIT.json` 从 `bootstrap-001/events.jsonl` 和 `frames.jsonl` 逐条计算，含 20 条计数行及 17 条事件的原始帧匹配记录。原始失败保存在 `RUN_RESULT.json` 和 `LIVE_RAW.log`。

| 指标 | 实际值 |
| --- | --- |
| 请求 / 成功响应 / 截止失败 | 20 / 19 / 1 |
| 已完整返回且计数精确相同 | 19/19；差额全部 0 |
| 首次实机本地 / 服务输入 | 5365 / 5365 |
| 本地及已报告服务最大输入 | 23968，均未超过 24000 |
| 实际使用既有裁剪的请求 | 12；最多移除 20 个旧交互组 |
| 自主真实动作 | 17：wait 1、move 3、look 13 |
| 已执行但未完成的身体回执 | 0 |
| 主动 / 被动入账事件 | 17 / 0 |
| 重复事件 ID / 重复入账 | 0 / 0 |
| 原始连续帧 | 19996，序号 1–19996 |
| 帧连续性 / 时间递增错误 | 0 / 0 |
| 17 条事件与原始帧逐帧哈希失配 | 0 |
| 初始化 | 17/128，未完成 |
| 物理沉积 / 事件地图 | 0 / 尚未建立 |

模型自行观察、读取结果、更新任务并选择动作；没有人工课程或脚本补足样本。真实 unknown-change 通知可能中断未执行的动作链，不把通知自述当作已获得物理预测支持。本轮没有检验成熟的 R2A 因素/关系、开门能力或完整原型能力。

## 最后成功保存与恢复边界

唯一成功快照仍是 `bootstrap-001/experience-0000.json`：事件 0、写入 0、时间 0、地图 null。17 条新事件原始记录保留，但因未到每 32 条的既有保存点，不在成功快照中；没有在出错后补存、重建或导入这些增量。

- 快照规范内容 SHA：`8D08EFEE61B671D1023C7CB97A410E939D470D36B434EBD5A23FACE3FBB298C9`。
- 快照文件字节 SHA：`13C8279031035A2D2C44FD95ABE19D5DE9DD0B24E9A9C7D1A08FD433DB1EE27F`。
- 指针文件 SHA：`925C58CC90ABE4851BF7835F36ED27DCB19EC7FC483738E6C89C794BD64A5DB9`。
- 指针与快照规范内容哈希一致。没有产生非空成功快照，按计划不重复已验证过的空快照离线恢复。

本次从空经验开始，未导入上一批 11 条原始增量或旧经验；动作恢复为 false。

## 身份、边界与关停

最终源码 63 项身份：`B71DF74A776FF9EE4A6B844076D7BA36CF27F50A9C0E7CD7CAF74120E68124DE`，与测试/实机前冻结清单逐项相同。38 项直接保护边界、3 项旧计数资产均零失配。前置证据只复核原清单文件身份，没有重复扫描历史证据树；详见 `FINAL_IDENTITY_AUDIT.json`。

| 保护项 | SHA-256 |
| --- | --- |
| PhysicalMedium3D | `40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A` |
| 恢复律 potential-page | `85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922` |
| PredictionClone | `7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC` |
| 物理 config | `AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E` |

旧 Formal V3 仍为 accessCount=0 / formalOpened=false，状态文件 SHA `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`，未运行或打开案例。没有包、训练追加或后续演示。

自有进程 29892/5460 已退出；25567/3000/3002 无监听，见 `SAFETY_EXIT_AUDIT.json`。观察入口已随本次失败正常清理，不再运行。

身份观测边界：requestedModel=`deepseek-v4-pro`；`responseModel` 存在请求名回退，服务端实际返回模型身份未独立取得，远端权重也未冻结。Pi 的 cost=0 只是未配置本地计费，不代表 API 免费。日志不保存原始思维链；原生私密续传内容未落盘，因此不宣称能够由公开请求日志完整重建每一次线上原生请求。

新证据清单 `EVIDENCE_MANIFEST.sha256` 独立列出文件字节 SHA；清单自身哈希在本轮项目日志与顾问回传消息中给出，避免循环哈希。
