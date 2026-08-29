# V5 报告材料引用与一次自主初始化

结论：报告引用契约的本地修复通过；唯一一次真实初始化在既有身体接口的 `dig-timeout` 处停止，未完成128条初始化。没有重试、换模式、补存失败增量或再次开局，也没有运行开门、旧Formal或打包。

## 实际修改与红绿证据

唯一生产修改为 `src/analysis.ts`：finish使用现有 `workspace.readPublic` 解析报告参考材料，并返回精简的 `referenceSources`。任务保持model-note，原始目标保持user-goal，工具材料保留自身种类、source及原观察时点；不复制正文或自动完成任务。不存在或跨目标引用仍报错。任务内部evidenceRefs仍只接受不可变工具证据。

另外仅补充read_context按对象属性/数组元素分页的说明。原工具参数结构、原生null/keep/unit、系统及六模式提示均未改变。两处派生模式测试的固定哈希随明示说明变更更新。测试修改：`test/analysis.test.ts`、`test/analysis-strict-wire.test.ts`、`test/strict-context-hints.test.ts`。

- `RED_RESULTS.json`：封存第三次finish参数在旧生产工具入口真实报 `context-reference-not-in-current-goal:t0`，同时readPublic确实返回model-note；无模型/身体调用。
- `DIRECT_TEST_RAW.log`：新增五项分别覆盖t0、用户目标和工具来源/原时点、未知引用、任务内部证据限制、null及真实分页范围。全部通过，读/结束没有工作区事实修改或新增物理调用。
- `SCHEMA_DESCRIPTION_AUDIT.json`：移除description后的逻辑和派生模式结构逐项相同。旧诊断失败分数、读取覆盖和报告原文未改写。

四个指定文件初跑为39/40、skipped=0；唯一失败是旧测试要求抛出的Error必须保持对象身份，与已存在的脱敏出口冲突。测试改为严格核对原消息与原堆栈，仍检查仅一次调用、一次动作；仅该项重验1/1通过。不是重新跑40项后的单次40/40。

本地过程中的错误全部保留：首次构建因把run返回类型新增字段写成必需而拒绝两个旧测试替身；恢复原公开类型后构建通过，未改其他生产文件。单文件重发射曾因缺少package上下文输出CJS而加载失败；改用与项目一致的ES模块发射后，唯一失败断言复验通过。没有因此重跑全套或实机。

## 命令与退出码

工作目录均为 `D:\Kairos_V5_Predictive_Agent`，Node为 `D:\nodejs\node.exe`。

| 原始记录 | 命令范围 | 退出码 |
|---|---|---:|
| RED_COMMAND / RED_RAW | 本地封存finish参数红测 | 1（预期红测） |
| BUILD_COMMAND / BUILD_RAW | tsc -p tsconfig.json | 2 |
| BUILD_TYPE_REPAIR_COMMAND | 仅修返回类型后的构建 | 0 |
| DIRECT_TEST_COMMAND / DIRECT_TEST_RAW | analysis、analysis-strict-wire、strict-context-hints、native-wire-budget四文件 | 1（39/40） |
| FAILED_ASSERTION_RETEST_COMMAND | 单一失败项，首次单文件发射加载错误 | 1 |
| FAILED_ASSERTION_ESM_RETEST_COMMAND | 同一项ES模块重验 | 0（1/1） |
| BOOTSTRAP_COMMAND / BOOTSTRAP_RAW | main.js --bootstrap-only --evidence-dir evidence/report-reference-contract-bootstrap-v1/bootstrap-001 | 1 |
| RAW_AUDIT_COMMAND / RAW_AUDIT | 本批原始帧、回执、入账只读核对 | 0 |
| READONLY_RESTORE_COMMAND / READONLY_RESTORE_RAW | 唯一一次非空快照只读恢复 | 0 |

没有新的无身体真实模型探针。相关测试使用合成传输，不冒充真实模型或物理学习；未运行旧八题、旧全量、合成128或性能校准。

## 唯一一次实机结果

运行ID：`v5-2026-08-28T05-50-52-051Z-34adbd50`。从空经验开始，Minecraft 1.21.4本机新世界；总耗时650346.3635ms（含启动和清理）。原目标、512动作预算、128事件初始化、每32事件保存均不变。所有动作由模型选择。

- 模型请求/响应：16/16。没有finish调用，因此本批实机没有额外证明新报告引用被模型实际使用；该项证据来自本地生产Pi测试。
- 原始公开帧：12596帧，序号1–12596；连续性错误0。40条事件的每一帧均与独立帧日志一致，差异0。
- 完成身体回执40条：look 13、observe 19、move 3、select-hotbar 4、interact 1。真实事件40、缓冲入账40、被动入账0；重复事件/重复入账0、回执串线0。
- 物理沉积writes=0，事件地图null，自然R2A/随机预测能力未建立。40条真实事件不等于完成初始化。
- 第16次模型公开调用为 `execute_chain([break(o44), observe(3)])`。线格式成功解码为合法逻辑参数。既有body执行break时，`bot.dig`未在200个真实刻的既有截止前完成，抛出 `dig-timeout`（`src/body.ts:159-160`）。没有此次break的完成回执/经验，也没有执行后续observe。未把该失败尝试计入40个完成动作。
- 这是身体执行阶段的超时停止，不是HTTP拒绝、词元超预算、finish引用失败或模型拒绝行动。工具/目标限制、服务端或依赖行为为何未能及时完成，尚未在本批判定；未扩修身体或开展新试验。详见 `FIRST_REAL_FAILURE.json`、`DIG_TIMEOUT_CONTEXT.json`。

原始链路在 `bootstrap-001/frames.jsonl`、`events.jsonl`、`minecraft-server.log`；`RAW_RUN_AUDIT.json`含逐事件原始行号、帧范围、哈希、回执和学习收据，不只保留汇总。

## 成功保存与恢复

程序正常周期保存了 `experience-0032.json`：32条缓冲事件，0沉积，地图和R2A均未形成。其余8条已入账事件仅留在本次原始记录中，没有收尾补存。首次错误后的动作和世界不恢复、不重放。

- 快照文件SHA-256：`f95cf73e862e2dc97c75ba63b781cc3b0476b1b85df847d69e8889781993f4e8`
- 指针中的规范内容SHA-256：`f9b01f71435b23c8736a1de09df184b77cf6a2224660e30cd7c99ee0bf9601ec`
- 唯一一次现有restoreExperience→snapshot只读恢复，规范内容哈希完全相同；原文件未变，模型/身体/observe调用均为0。恢复状态ready=false、bufferedEvents=32、writes=0、mapSha256=null，详见 `READONLY_RESTORE.json`。

## 身份、观测边界与未完成项

- 31个直接文件身份：`1ba5bce3b4e9e5c84a9d6e83eaf6cfd896dd79ed41cd709a52544107bf229940`；这是明确直接清单，不冒称重新扫描全仓库。
- SOURCE_MANIFEST文件SHA-256：`49faf561e6e1cefa6b7cf5918651baed3149a17ecabbbe694047345ec3700854`。实机冻结后变化0，27个直接保护文件变化0。
- 新逻辑模式：`9efdf6d0e359c18496549ad6ccc6101ed480092020f47ea82f5f1e380bc19746`；新派生模式：`f54885eaff546312a07d6dc84821bde582bac49d2e6a7bc8a8ececf67650dcc0`。线算法仍KairosNativeValueStrictWireV3。
- PhysicalMedium、PredictionClone、config、potential-page及其他直接边界哈希见FINAL_AUDIT，均与基线相同。旧证据清单文件仍为 `c1722479a1011a5b6ee7d06f76edfb0bdb2e3e59166af02f2bfe1b217bbffdad`；未重扫或写入旧证据树。
- Formal V3保持accessCount=0、formalOpened=false，状态文件SHA-256仍为 `1a28b87a23ae08b6f597708becef14f5e2b61bbe76ad2ee779141e8e6b7a88df`。
- 16次本地/服务计数均相差25，逐请求数据见REQUEST_TOKEN_USAGE；服务输入累计307272、输出33928。不补常数、不改预算。请求模型为deepseek-v4-pro/high，独立响应model未取得；SDK字段可能后备为请求名，本批没有独立bootstrap HTTP原流。SDK cost=0只表示本地未配置计费，不表示API免费。
- 只关闭自有进程；主进程36524和服务端20348均已退出，25567/3000/3002/18080无监听。只读观看入口也已关闭，见SERVICE_CLEANUP。

已验证的是本地报告引用边界、40条真实事件和32条缓冲快照可恢复。未完成的是128条自主初始化、事件地图形成、自然R2A条件和随机预测贡献，不能宣布V5或完整物理原型通过。后续需要顾问根据已保留的身体超时证据决定范围，本任务不继续扩修。

本目录EVIDENCE_MANIFEST及其独立复算记录给出最终证据身份；后者不纳入自身清单，避免循环哈希。
