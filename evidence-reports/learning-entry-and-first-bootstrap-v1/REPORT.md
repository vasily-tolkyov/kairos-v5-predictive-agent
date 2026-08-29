# V5 学习入口与首轮自主初始化：本轮结果

2026-08-28。工程接线与直接相关回归通过；唯一一次实机初始化未完成，按原错误语义退出，未重跑、调参或补动作。本轮不是完整原型验收。

## 实际变更

- `src/public-context.ts`：事件前已可见方块的类型、公开状态、0.25 量化相对位置生成 `V5PublicRelativeLayoutV1`。不使用绝对区域、会话、时间或身体动态状态；不伪造缺失字段。
- `src/body.ts`、`src/attention/monitor.ts`：保存体验时间加新会话真实物理刻；主动/被动事件使用会话范围 ID。刚验收的观察结清顺序不变。
- `src/runtime.ts`：接入现有 Worker restore；显式指针与语义/哈希不符立即报错，源目录只读。恢复缓冲与地图计数，不恢复动作、工作记忆或待预测窗口；每 32 条新事件保存。异常仅保留最后成功保存点。
- `src/main.ts`：薄入口 `--experience-pointer`、`--bootstrap-only`。默认空经验，先恢复后接新帧；本轮不进入开门/条件改变目标。
- `test/learning-entry.test.ts`、`README.md`：相关恢复、来源分组、隔离回归与实际使用说明。完整逐文件身份见 `DIRECT_CHANGE_AND_PROTECTION.json`。

## 本轮实际命令与退出码

工作目录均为 `D:\Kairos_V5_Predictive_Agent`。

| 命令 | 结果 |
| --- | --- |
| `D:\nodejs\node.exe node_modules/typescript/bin/tsc -p tsconfig.json` | 0；构建一次 |
| `D:\nodejs\node.exe --test --test-reporter=tap dist/test/learning-entry.test.js dist/test/attention.test.js` | 0；9/9，skipped=0；无旧全量/128 合成拟合 |
| `D:\nodejs\node.exe dist/src/main.js --bootstrap-only --evidence-dir D:\Kairos_V5_Predictive_Agent\evidence\learning-entry-and-first-bootstrap-v1\bootstrap-001` | 1；唯一实机运行，237781.4339 ms |

命令、原始输出及日志哈希分别保存在 `BUILD_*`、`TARGETED_*`、`LIVE_*`。收尾离线审计最初两次命令包装错误（Worker 继承 `--input-type`、随后默认 import 转换遗漏）也保留了原命令和错误日志；仅修正离线命令包装，最终 `OFFLINE_AUDIT_COMMAND.json` 退出 0。这不是额外游戏运行、模型请求或物理拟合。

## 唯一实机运行的事实

- 全新 Minecraft Java 1.21.4 可删除开发世界；无恢复指针、无旧经验。13 个模型请求，15 次工具执行：read_context 10、observe 2、set_intent 1、execute_chain 2。
- 11 个真实成功 look 动作/11 条主动完整事件；被动事件 0。模型自行决定动作，其中 yaw +45° 8 次、pitch +45° 2 次、pitch −90° 1 次。没有脚本课程或固定配额。
- 4,319 个原始帧（1–4319；体验时间 0.05–215.95 秒），连续性错误 0；11 个事件的逐帧数据与全量原始帧相符，重复事件 ID 0。
- 11/128 条事件进入初始化缓冲，真实物理沉积 0，地图拟合 0。R1/R2 无沉积核，R2A 尚未建立；不能据此判断表征覆盖、自然稳定因素或规则能力。
- 实际变化为自身 yaw/pitch 与对象可见性。11 个事件出现 10 个公开布局分组，来自同一世界中的不同可见视野，**不是 10 个独立房间/场景**。
- 219 次焦点预测全为空，原因为 `physical-initialization-not-ready`。原日志另有 218 条时序记录、44 条 late；本批未改注意力产生端，不能宣称支持性预测或注意力时序验收通过。

## 停止原因：精确证据边界

13 次响应中，服务端输入用量 `input + cacheRead + cacheWrite` 均比本地计数多 79。第 13 次本地 23999 ≤ 24000，服务端实际 24078 > 24000；模型正常返回 `tool_calls/read_context`，输出 65。既有 `src/analysis.ts` 的 `service-actual-token-budget-exceeded` 在该工具执行前终止。

这是已证实的**输入预算计数/集成边界问题**；不是 HTTP 400、不是 32768 上下文耗尽（该次总用量 24143）、不是模型拒绝行动，也不是物理理论失败。79 差额的内部来源本轮不继续查改，未加常数、换模型、改预算或重跑。

逐请求本地/服务端计数、时延、公开输出、事件行号和动作收据见 `FINAL_AUDIT.json` 与 `bootstrap-001/events.jsonl`。累计服务用量 totalTokens=169097。请求模型为 `deepseek-v4-pro`；SDK 日志字段可能回退到请求模型名，**独立服务端实际身份未取得**。Pi cost=0 是未配置的本地计费值，不表示 API 免费。未持久化思维链正文。

## 保存与恢复的限制

失败发生于第 32 条保存点之前。最后成功指针仍指向 `experience-0000.json`：保存事件 0、缓冲 0、activeSeconds=0、地图为空。11 条增量只在完整原始事件记录中，未成为成功的可续接经验快照；没有在异常后补保存或伪造地图。

本轮仅用这一**真实保存的空快照**离线恢复一次，按原始第 33 帧/1.65 秒重放启动 recall，与实际启动结果逐字节一致；固定查询前后核心哈希不变，源指针/快照字节不变。固定种子预测仍诚实为空，未产生随机样本。非空恢复由小合成夹具验证，不能冒充本轮 11 条经验已保存、跨实机恢复或 R2A 学习成功。

## 身份与清理

- 最终源码：`A07B70800B014AAB0663F7DDB205329445E4C2C3BEAA7563BFF2FB9BB8EDA39E`（62 项），与测试及实机前冻结身份一致。
- 系统提示：`C17130ADF9EB3B298CDA818DE012E26B777FF9F535AF05A49A780A724EBF346C`；工具 schema：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`。逐模式实际提示哈希另在请求记录中。
- 33 项直接保护边界无变化，包括 physical-medium `40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`、potential-page `85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922`、PredictionClone `7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`、core config `AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`。
- 最后快照规范内容 SHA：`8D08EFEE61B671D1023C7CB97A410E939D470D36B434EBD5A23FACE3FBB298C9`；文件 SHA（含序列化换行）：`13C8279031035A2D2C44FD95ABE19D5DE9DD0B24E9A9C7D1A08FD433DB1EE27F`。
- 原始帧文件：`55EC8E0C06DE1DE63ADE6809934983E35030454C518C8A00D59A9E5CB74818A8`；事件文件：`0D7ACC6E4F5D80DE87E0F1BC621DACA59C79C49E0820A81751B2AA85C7B7D53C`。
- 旧 Formal V3 仍为 0/false；状态文件 SHA `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`，未改动或访问案例。
- 自有 main/server 已退出；127.0.0.1 的 25567/3000/3002 监听均为 0（`CLEANUP_RAW.log`）。观看入口已关闭。未运行新模型题、旧校准、Formal、开门演示或打包。

结论：**学习入口 implemented/targeted-validated；首轮自主初始化未完成；完整物理能力仍未验证。** 保留全部成功与失败原始记录，回传顾问后停止。`EVIDENCE_MANIFEST.sha256` 覆盖本目录除其自身以外的证据文件，未扫描历史全树。
