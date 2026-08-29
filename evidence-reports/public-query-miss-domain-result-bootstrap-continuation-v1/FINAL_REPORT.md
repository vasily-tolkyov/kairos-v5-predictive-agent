# V5 公开查询未命中语义：局部通过，唯一初始化续验停止

本批落实计划 `6298053B51FB3BB34444347CC3CD95A07E84AA304D4B871F94D45A47CEE0DF7F`。没有继续扩修、第二次游戏运行、无身体真实模型探针、开门、Formal 或打包。

## 已实现与直接验证

- 生产仅修改 `src/cognitive-workspace.ts`、`src/analysis.ts` 的 read_context 说明。已知公开文档缺少普通字段返回 `status=field-not-found`，携带原类型、来源、时点、请求引用及路径，不造空候选、不补路径。真实 null/false/0/空字符串/空数组均为 `found`。未知引用、非法分页、特殊键、内部异常仍抛出。
- 测试修改 `test/cognitive-workspace.test.ts`、`test/public-document-path.test.ts`，新增 `test/public-query-miss.test.ts`。旧的“普通缺字段必抛错”断言按本轮新契约调整，历史证据不重标。
- 封存 g1-e16 的 `/data/candidates` 红测真实报 `context-public-field-missing`（exit 1）；修复后同文档 `/data/crosshair` 正常返回 found/null，原来源仍为 current-public-frame、7912、783.7。
- 一次编译 exit 0；明确选择的直接测试 **14/14，skipped=0，exit 0**。生产 Pi 配合合成传输验证同一响应中的未命中和真实 null 均进入下一模型请求，未加工具/动作；另一反例确认真正错误阻止后续身体调用。这不是新增真实模型资格。
- 证据冻结曾因人工填写的预期哈希多一个字符触发断言；保留 `FREEZE_ASSERTION_DIAGNOSTIC.json`，确认模式源码及实际64位哈希未变后完成冻结。没有因此修改生产或追加实机运行。

原始命令、选择模式和退出码在 `RED_COMMAND.json`、`BUILD_COMMAND.json`、`TARGETED_TEST_COMMAND.json`、`COMMAND_RESULTS.json`；控制台原文均保留。

## 唯一真实续验

使用既有 main --bootstrap-only，显式恢复 report-reference-contract-bootstrap-v1 的32条成功快照；不导入前批未保存增量，不恢复动作或旧世界。本次原始命令在 `BOOTSTRAP_COMMAND.json`，运行一次，343.410秒，exit 1。

| 实际记录 | 结果 |
| --- | --- |
| 模型请求 / 响应 | 9 / 9 |
| 身体动作 | 15：look 7、observe 6、move 2 |
| 新真实事件 / 缓冲入账 | 15 / 15 |
| 累计初始化缓冲 | 32 + 15 = 47 / 128 |
| 物理沉积 / 地图 / R2A | 0 / null / 尚未建立 |
| 原始连续帧 | 6481，序号1–6481，无连续性错误 |
| 事件采样位置 | 239，全部与原始帧哈希相符 |
| 重复事件 / 重复入账 / 无对应事件入账 | 0 / 0 / 0 |
| 公开读取 | 3 found，0 field-not-found，0未分类结果 |
| 成功保存的经验 | 仍为原32条；新15条只有原始记录与本次缓冲，没有成功增量快照 |
| 额外只读恢复 | 0：只有原32条启动副本，不重复恢复旧快照 |

本次实机没有触发字段未命中，**不能宣称已观察到模型收到未命中后自主改查**。局部契约证据与真实运行覆盖分别保留在 `TARGETED_TEST_RAW.log`、`PUBLIC_DOCUMENT_READS.json`、`READ_MISS_FOLLOW_UP.json`。

## 第一真实错误与停止边界

第8次请求成功确认 `g1-e11`（events.jsonl第869行）。第9次实际输入当前工作区的 `pendingAttentionRefs` 只有 `g1-e14`；模型却再次提交 `acknowledgeAttention=[g1-e11,g1-e14]`。生产在第1094行 set_intent 后报 `workspace-unknown-pending-attention`，仍保留待确认的 g1-e14；同响应后面的12个建议动作均未执行，错误后身体回执和入账均为0。

分类：**模型状态引用与既有工作区领域契约不一致**；不是本批普通字段未命中，也不是HTTP失败、物理恢复失败或已证明的通用模型能力结论。请求历史确实保留旧通知，具体诱因不在本批扩大诊断。公开原始请求/输出和最小定位见 `bootstrap-001/events.jsonl` 与 `STOPPING_FAILURE.json`，没有改确认语义、吞错、重试或重跑。

9次本地输入与服务usage分别记录，服务均多25词元；原因未在本批调查，也不是本次终止原因。没有bootstrap独立HTTP原流；SDK的responseModel可能回退到请求名，服务实际模型身份未独立取得。cost=0仅表示本地未配置计费，不表示API免费。

## 冻结与清理

- 36项直接源码冻结前后零失配，31项直接保护文件不变；两处生产改动和三处测试改动见 `SOURCE_FREEZE.json`。
- 原计划输入、旧证据直接使用的4个文件、旧证据清单本身及32条输入快照不变；未扫描历史全树。
- 自有main/server均已结束，25567/3000/3002/18080无监听，见 `CLEANUP_AUDIT.json`。
- Formal V3仍 `accessCount=0 / formalOpened=false`，未打开，未生成包。

关键SHA-256：

```text
直接源码身份 0E44124213E1F6AA47592B63273C7466B4354A8452A85B617004CDC446FB150D
SOURCE_MANIFEST D6CC679C8424E78427CAD4BAF01383F5CC550ACD6D7BA7742329BDD2B27F6AAA
原32条快照文件 F95CF73E862E2DC97C75BA63B781CC3B0476B1B85DF847D69E8889781993F4E8
events.jsonl DAC9E6EF2E658296F8CD9E85E7AAAD3CA0A60F6F3C1F9F642B399AEB6033CB42
frames.jsonl 7A9C8242F6B1B832B007BB9DFA312B12CB6D9811D363D135AE6ABA34BCB47FB7
Formal状态 1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF
PhysicalMedium 40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A
PredictionClone 7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC
恢复配置 AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E
恢复定律 85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922
```

独立只读入口：`FINAL_AUDIT.json`、`RAW_RUN_AUDIT.json`、`STOPPING_FAILURE.json`、原始bootstrap文件及两份manifest。`audit-run.mjs`为本次已执行的证据归约器，会写输出；封存后不要作为只读命令再次执行。最终证据清单哈希在顾问通知和项目执行日志中给出，避免清单自引用。
