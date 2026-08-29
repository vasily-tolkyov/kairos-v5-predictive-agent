# V5 公开文档路径修复与唯一续验

结论：本批路径契约的本地验证通过，并在实机完成7次正确分页读取；唯一初始化续验在第9次模型请求因不存在的公开字段停止。初始化未完成，不能称V5或物理预测能力通过。没有改码后重跑。

## 修改与直接验证

生产仅修改 `src/cognitive-workspace.ts`、`src/analysis.ts`：统一未分页公开文档根；证据路径为 `/data/...`，任务路径为 `/parentId`；读取直接返回 `selectedValue/page` 与原来源；展示、分页提示和读取共用文档构造。原生线转换算法、系统/模式提示、预算、模型、身体、Runtime、main和物理模块未改。

新增 `test/public-document-path.test.ts`；另外5个直接相关测试文件仅调整受影响的路径、返回形状、说明身份和生产Pi替身断言。完整差异见两个 `.diff`、`before/` 和 `SOURCE_FREEZE.json`。

- 原始红测 exit 1：封存 `g1-e2` 在旧根下触发 `context-public-field-missing`。独立逐调用记录中，两条旧调用均如此。没有重标旧失败。
- 一次 TypeScript 构建 exit 0。
- 明确文件与名称筛选的直接测试 exit 0：实际32/32、skipped=0。包含原始两页逐值比较、三处展示入口、完整分页、空值/来源/时点、私有字段与错误根拒绝、真实Pi的合成HTTP传输和封存event-1的100条过程变化回放。
- 未重跑历史全量、模型八题、协议生成探针、合成128初始化或物理校准。合成传输与固定物理夹具不充当真实模型或自然R2A资格。

命令与原始退出码：`RED_COMMAND.json` / `RED_RAW.log`、`BUILD_COMMAND.json` / `BUILD_RAW.log`、`DIRECT_TEST_COMMAND.json` / `DIRECT_TEST_RAW.log`。

## 唯一真实续验

命令（exit 1，454731.3921ms，唯一运行）：

```text
D:\nodejs\node.exe dist/src/main.js --bootstrap-only --experience-pointer D:/Kairos_V5_Predictive_Agent/evidence/report-reference-contract-bootstrap-v1/bootstrap-001/EXPERIENCE_LATEST.json --evidence-dir evidence/public-document-path-bootstrap-continuation-v1/bootstrap-001
```

从指定32条快照、体验时间388.1秒恢复；不恢复动作或旧世界，没有导入此前未保存增量。原始工具、请求、身体回执和事件在 `bootstrap-001/events.jsonl`，连续帧在 `bootstrap-001/frames.jsonl`。

| 实测项 | 结果 |
| --- | --- |
| 模型请求/响应 | 9 / 9 |
| 成功 `read_context` | 7；第8次读取失败，随后同响应中的另一读取未执行 |
| 实际动作 | 11：look 4、move 2、observe 5 |
| 真实新事件/缓冲入账 | 11 / 11，累计43/128 |
| 额外未执行尝试 | interact一次返回正常no-target；未冒充动作或经验 |
| 原始帧 | 8696，序号1–8696，连续性错误0 |
| 事件采样帧 | 191个记录位置逐项匹配原始帧，失配0 |
| 重复事件/重复入账 | 0 / 0 |
| 物理沉积/事件地图 | 0 / 尚未建立；自然R2A与随机预测贡献未建立 |
| 成功保存 | 仍为32条；新增11条未到每32条保存点，未保存 |

没有新的成功增量快照，因此没有重复旧32条的离线恢复。原始11条记录保留，但没有把它们伪装成成功快照。

## 准确停止边界

`events.jsonl` 第1319行是第9请求，第1428行是公开模型调用，第1430行开始读取 `g1-e16` 的 `/data/candidates`，随后原样抛错停止。该引用类型为 `public-observation`，来源 `current-public-frame`，原始data实际含 `activeSeconds/body/crosshair/objects/queryVocabulary/sequence`，不含 `candidates`。

本次输入中 `g1-e16` 使用既有精确压缩 `dataSameAs: g1-e13`，但独立保留自己的序号7912和时间783.7秒。并非声称本次请求展开了它的全部内容。原始 `g1-e16` 及当次显示、前一工具结果、失败调用均保存于 `STOPPING_FAILURE.json`。

分类：新工具引用/字段选择错误，运行时按契约拒绝。不是旧 `/data` 根偏移重现的证据，也不证明唯一诱因或模型普遍能力失败。第二条 `/data/crosshair` 未执行，不能算成功或第二次实际失败。保持首错停止线，不自动改路径或改问法。

## 观测与保护边界

- 9次服务输入均比本地计数多25；实际逐次用量见 `REQUEST_TOKEN_USAGE.json`，本批未补常数或改预算。此次停止不是输入预算或服务生成错误。
- requestedModel为 `deepseek-v4-pro`。bootstrap没有独立HTTP原流；SDK的responseModel可使用后备值，真实服务响应身份记为未独立取得。cost=0仅为本地未配置计费，不代表API免费。没有保存私密推理。
- 本批35个直接文件冻结前后零失配，其中27个不可变边界未变；不是重新扫描全工程。旧证据清单及本批直接使用的旧材料、原32条快照/指针哈希未变，未遍历旧证据树。
- 自有主进程及直接子进程已退出，25567/3000/3002/18080无监听；无需强杀。观察服务已关闭，不作为运行门。
- Formal V3仍为 `accessCount=0/formalOpened=false`；不开门、不打包。

关键SHA-256：

```text
35文件直接源码身份 F7A0790A6A3A1FA5CFE9F45F013A1616B65266B66212F3599B4101132212A931
SOURCE_MANIFEST字节 B4620E118846DD87486828B457AB8CB050FD03DFE7B1375C42C8A1D21BDA6FA1
逻辑工具schema 120531C44777D6121EC03C78E872D37E488AE40BBDB62D192A77C5AF46857C70
严格线schema 242D544FCAB5B782EEF2E8D285FE48D4979303F1D56C29DCF90B2C281281B6D8
32条快照文件 F95CF73E862E2DC97C75BA63B781CC3B0476B1B85DF847D69E8889781993F4E8
32条快照规范内容 F9B01F71435B23C8736A1DE09DF184B77CF6A2224660E30CD7C99EE0BF9601EC
Formal状态文件 1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF
PhysicalMedium 40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A
PredictionClone 7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC
core/config AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E
```

证据总清单为 `EVIDENCE_MANIFEST.sha256`；其文件哈希另在回传与项目执行日志中给出，避免自引用。原始失败、成功和未完成项均保留，等待独立只读审查。
