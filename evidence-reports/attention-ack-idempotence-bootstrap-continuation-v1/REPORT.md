# 注意力确认幂等修复与唯一初始化续验

结论：限定接口修复通过本地反例与生产Pi传输夹具；唯一实机续验在第13响应达到8192生成词元上限后退出。初始化未完成，不是V5整体通过。未修改配置、重试或再次启动游戏。

## 实际变更与本地证据

- `src/cognitive-workspace.ts`：对本目标已知attention先去重、校验证据与类型，再沿用原单次状态赋值；返回本次新增 `acknowledgedAttention` 与此前确认 `alreadyAcknowledgedAttention`。未提及通知保留。未知/非attention/损坏引用与内部异常继续抛出。
- `src/analysis.ts`：仅set_intent工具说明新增一句确认语义；逻辑schema、严格线格式、系统/模式提示不变。
- `test/attention-ack-idempotence.test.ts`：新增5项直接测试，包括原第8/9响应、重复/混合引用、状态原子性、损坏证据，以及真实生产Pi配合本地合成HTTP端口的动作透传/失败停止。夹具没有真实模型、身体或物理写入。

|命令/证据|真实退出码|结果|
|---|---:|---|
|`RED_COMMAND.json` / `RED_RAW.log`|1|旧生产代码在原第9响应准确抛 `workspace-unknown-pending-attention`|
|`BUILD_COMMAND.json` / `BUILD_RAW.log`|0|一次TypeScript构建|
|`TARGETED_TEST_COMMAND.json` / `TARGETED_TEST_RAW.log`|0|10/10，skipped=0；没有旧全量/八题/合成128/校准|
|`BOOTSTRAP_COMMAND.json` / `BOOTSTRAP_RAW.log`|1|唯一实机运行，827398ms；第13响应输出截断|
|`RAW_AUDIT_COMMAND.json` / `RAW_AUDIT_CONSOLE.log`|0|仅归约本次已完成原始记录，不产生模型/身体调用|

所有确切参数见对应COMMAND文件。最小测试集合为新确认测试、public-query-miss直接反例、原attention材料保持与原身体异常传播。证据收尾最初误按TAP解析测试尾部，已依据实际Node spec日志改正为10/10；原命令和日志未改、测试未重跑。

## 唯一真实续验

实际命令（cwd `D:/Kairos_V5_Predictive_Agent`）：

```text
D:\nodejs\node.exe dist/src/main.js --bootstrap-only --experience-pointer D:/Kairos_V5_Predictive_Agent/evidence/report-reference-contract-bootstrap-v1/bootstrap-001/EXPERIENCE_LATEST.json --evidence-dir evidence/attention-ack-idempotence-bootstrap-continuation-v1/bootstrap-001
```

从指定成功保存32条、388.1秒恢复到新世界；不恢复动作，不导入任何未保存增量。保持128初始化目标、512既有动作预算和每32条新事件保存机制。动作均为本次模型选择，无课程或人为重复确认。

- 13请求、13响应；12次返回工具，末次无工具/公开文本并以length结束。
- 18个实际动作：look=6、move=4、observe=8；另一次interact返回 `executed=false/status=no-target`，未形成动作事件或写入。未执行动作建议不计入18。
- 18条完整真实事件及18次缓冲入账；事件/提交重复=0、未提交事件=0。16040帧（1–16040）连续；18事件的258个采样帧逐个与原始帧规范哈希相同，间断/失配=0，事件对应身体回执18/18。
- 本轮累计缓冲50/128；物理沉积0、地图null，未形成自然R2A/随机读出能力证据。
- 实机3次新增确认（g1-e7、g1-e12、g1-e16），返回和按原始通知/确认时序重建的pending集合一致；最终pending为空。重复确认0次，不能声称本轮实机覆盖幂等分支；该分支只由本地封存案例和Pi夹具验证。确认不证明因果解释正确。
- read_context实机8次found、0次field-not-found；真实miss后续行为仍未观察。模型主动recall/predict/finish工具调用均0（另有既有启动查询及事实预测监视，不混同）。

`ATTENTION_ACK_RESULTS.json`从原始attention-context和成功model-intent按序重建，不仅计返回字段。`PUBLIC_ACTION_RESULTS.json`保留各条公开动作状态；`RAW_RUN_AUDIT.json`保留全部事件与原始帧对应关系。

## 第一真实错误与保存边界

`bootstrap-001/events.jsonl` 第2162行是第13请求；第2577行是length响应，第2578行记录原始致命错误 `analysis-output-truncated:length`。完整记录见 `FIRST_FAILURE.json`。

- 本地输入21563；服务用量输入21588（含缓存）；输出8192，SDK报告reasoning=8192，总用量29780。
- 本地准备4727.704ms、生成136798.895ms；`requestDeadlineExceeded=false`。有持续生成进展，不是120秒无进展超时、HTTP拒绝、上下文总量耗尽或通知确认异常。
- 分类：当前固定配置下的模型生成长度上限阻断。无足够公开输出裁定这一请求的语义判断，更不据此宣称物理理论错误或一般模型能力失败。不调整上限或提示再试。
- 13次服务输入均比本地计数多25；原计数资产/预算未改，此差异不是本次length停止的触发错误，原因未在本批调查或补偿。
- SDK responseModel可能回退请求名；独立服务返回身份未取得。仅记录requestedModel=deepseek-v4-pro与SDK字段，不冒称独立HTTP取证；cost=0是未配置本地计费，不代表API免费。私密思维正文未保存。

仍只有原32条成功快照副本；18条新缓冲未到保存节点，未补存、未恢复。`RESTORE_DECISION.json`明确额外只读恢复次数0。可继续使用的输入仍是原report-reference目录EXPERIENCE_LATEST，不把未保存50条当作持久经验。

## 身份与只读边界

- 37项直接源码身份：`7ACA2A32B0A20395E8592FF78D9640F93CE1CAAFB489D6B2F4162EE4A6EDFD4C`；运行前后逐文件0失配，34项未改保护文件保持一致。
- 原32条快照文件SHA：`F95CF73E862E2DC97C75BA63B781CC3B0476B1B85DF847D69E8889781993F4E8`；规范内容SHA：`F9B01F71435B23C8736A1DE09DF184B77CF6A2224660E30CD7C99EE0BF9601EC`。本次启动副本相同。
- 物理介质：`40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`；PredictionClone：`7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`；core config：`AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`；恢复页：`85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922`。
- Formal V3仍0/false，文件SHA：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。未开门、未访问Formal、未打包。
- 仅核对前批清单、4项直接引用旧证据、指定32条与本批直接文件；旧证据均未改，没有历史全树扫描。完整数值见 `FINAL_BOUNDARY_AUDIT.json`、`INTERFACE_IDENTITIES.json`。
- 主进程33816、服务端18264均退出；25567/3000/3002/18080监听为空，使用既有finally清理，没有强制杀进程或重启。只读Viewer已随本轮关闭。

独立只读审查入口：本报告、原始 `bootstrap-001/events.jsonl` / `frames.jsonl` / `RUN_RESULT.json` / `WORKSPACE_LATEST.json`，以及红绿日志、归约JSON与 `SOURCE_MANIFEST.sha256` / `EVIDENCE_MANIFEST.sha256`。后者不包含自身；核对清单即可，无需重启游戏或重跑测试/审计写出器。
