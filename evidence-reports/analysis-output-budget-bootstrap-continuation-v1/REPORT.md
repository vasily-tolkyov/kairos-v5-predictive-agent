# 分析生成预算与一次初始化续验

## 结论

预算接线及直接测试通过；唯一实机续验因第13次分析请求返回 `402: Insufficient Balance` 停止，退出码1。没有重试、自动续写、换模型或第二次游戏运行。

13次实际请求均发送 `max_tokens=32768`，本地输入整理目标仍为24000，应用总预算65536，DeepSeek V4 Pro/high及120秒连续无有效生成进展规则不变。这两个新上限是本次授权的应用配置，不是官方默认值，也不是成功保证。

前12次响应正常返回工具调用；最大实际生成5671词元。因此本轮**没有**观察到“超过旧8192后正常完成”的真实请求，不能据此宣称扩额已解决所有截断问题。第13次余额错误不是输出截断、输入超限或无进展超时。

## 实际修改与验证

生产仅修改 `kairos.config.json` 的输出/总预算和 `src/services.ts` 的两个对应断言；`src/analysis.ts` 未修改。三个直接测试文件为：新增 `test/analysis-output-budget-continuation.test.ts`；调整 `test/deepseek-backend.test.ts`、`test/native-wire-budget.test.ts` 中受影响的预算断言。

| 命令阶段 | 真实退出码 | 结果 |
|---|---:|---|
| 旧配置红测 | 1 | 实际发送8192，目标32768断言失败；不是夹具异常 |
| `D:\nodejs\node.exe node_modules/typescript/bin/tsc -p tsconfig.json` | 0 | 一次必要构建 |
| 三文件、指定名称的直接测试 | 0 | 7/7，fail=0，skipped=0 |
| 唯一 `--bootstrap-only` | 1 | 第13次请求402余额不足 |
| 本次原始记录整理 | 0 | 帧、事件、回执及用量核对 |
| 新64条保存点唯一只读恢复 | 0 | 恢复前后规范快照哈希相同，原文件未变 |

完整参数和日志见本目录 `*_COMMAND.json`、`*_RAW.log`、`VALIDATION_RESULTS.json`。本地用量9000的测试是合成传输反例，不是实际模型生成。没有执行旧全量、八题、合成128拟合、额外协议探针、开门或Formal。

唯一实机命令：

```powershell
D:\nodejs\node.exe dist/src/main.js --bootstrap-only --experience-pointer D:/Kairos_V5_Predictive_Agent/evidence/report-reference-contract-bootstrap-v1/bootstrap-001/EXPERIENCE_LATEST.json --evidence-dir evidence/analysis-output-budget-bootstrap-continuation-v1/bootstrap-001
```

## 原始用量

| 请求 | 本地输入 | SDK用量还原的服务输入 | 生成词元 | SDK reasoning词元 | 结果 |
|---:|---:|---:|---:|---:|---|
| 1 | 7535 | 7560 | 261 | 217 | tool_calls |
| 2 | 7830 | 7855 | 804 | 653 | tool_calls |
| 3 | 10376 | 10401 | 1656 | 1390 | tool_calls |
| 4 | 13288 | 13313 | 789 | 587 | tool_calls |
| 5 | 15194 | 15219 | 1668 | 1347 | tool_calls |
| 6 | 17943 | 17968 | 604 | 506 | tool_calls |
| 7 | 19037 | 19062 | 1426 | 1283 | tool_calls |
| 8 | 21558 | 21583 | 2171 | 2073 | tool_calls |
| 9 | 23565 | 23590 | 4276 | 3988 | tool_calls |
| 10 | 23422 | 23447 | 1998 | 1789 | tool_calls |
| 11 | 21331 | 21356 | 1724 | 1542 | tool_calls |
| 12 | 23087 | 23112 | 5671 | 5218 | tool_calls |
| 13 | 19960 | 未取得；SDK错误记录为0 | 未取得；SDK记录为0 | 未取得 | 402 Insufficient Balance |

前12次本地/服务输入差均为25，本轮不追查或补偿。第13次错误对象中的全零usage不证明服务实际消费为零，不纳入计数对齐结论。每请求原参数、身份、用量和耗时分别保存在 `bootstrap-001/events.jsonl`、`REQUEST_TOKEN_USAGE.json`、`OUTPUT_BUDGET_RESULTS.json`。

本次只有Pi公开记录，没有独立原始HTTP流；`responseModel`可能回退为请求模型名，实际响应模型身份未独立取得。SDK `cost=0` 表示未配置本地价格，绝不是API免费。私密思考正文和密钥不保存。

## 真实经验与保存边界

- 起点：原成功保存32条、体验时间388.1秒，只恢复经验，不恢复动作或旧世界。
- 本次49个真实已执行身体回执：observe26、look19、move3、interact1；49条主动真实事件和49次缓冲入账；被动完整事件0。另有3个正常 `no-target` 返回，未执行，不计入49次。
- 连续原始帧10253（1—10253）；49事件所含599个采样位置逐项与原始帧一致，失配0、事件重复0、重复入账0、未入账完整事件0。
- 停止时累计81/128，缓冲81，物理沉积0，地图null；128初始化未完成，自然R2A及随机预测能力未建立。
- 最新成功保存64条（原32+本次32），体验时间672.4000000000001秒；其余17条没有进入成功保存快照，不能当作可恢复增量。
- 仅对新64条做了一次现有只读恢复，恢复后仍ready=false、buffer64、writes0、map=null；没有模型、身体或观察调用。
- 本次read_context实际4次均found；没有实机miss后续行为覆盖。确认3条新通知，重复确认0次，finish0次；不补称这些历史缺口已被本轮覆盖。

实际保存入口：

[EXPERIENCE_LATEST.json](D:/Kairos_V5_Predictive_Agent/evidence/analysis-output-budget-bootstrap-continuation-v1/bootstrap-001/EXPERIENCE_LATEST.json)

原始链路入口：`bootstrap-001/frames.jsonl`、`bootstrap-001/events.jsonl`、`bootstrap-001/WORKSPACE_LATEST.json`、`bootstrap-001/RUN_RESULT.json`。独立整理详见 `RAW_RUN_AUDIT.json`；只读恢复详见 `READONLY_RESTORE.json`。

## 身份与停止边界

- 冻结38项直接源码身份：`AE7B268F92664C5FC62C866517E18F63B8028BF98C3C3FC91B2BA836835E4C0E`；5项变更，33项直接保护文件不变，收尾失配0。此为直接范围身份，不冒称全工程重扫。
- 配置文件SHA256：`46C32B042D96B3F820A5C2BDDF83F2BEEF8F91E9B6348726CC041E17C0D68CEB`。
- 新保存指针SHA256：`50983ED08AA846F3D56955ED57AA4B2DA37631CFBB6821FC1C39285485EAC63C`。
- 64条快照文件SHA256：`D2135C6E2FBA9FF5FACDB3258037272C3DDE8C2EB5BE991D66EB95C3461D395E`。
- 64条规范快照SHA256（恢复前后相同）：`F3AEA9A67AF375BCCAF95C0AC2D240F57462EBAAF45F30D28C4AFEE8BF1F8F5D`。
- Formal V3 SHA256：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`；保持accessCount=0/formalOpened=false。
- 权威物理介质、恢复律、PredictionClone、Runtime、身体、提示、工具、输入预算、模型配置其余字段未改。具体哈希在 `FINAL_BOUNDARY_AUDIT.json` 与 `INTERFACE_IDENTITIES.json`。
- 主进程8876、测试服36396已退出；25567/3000/3002/18080无监听，未手工杀掉无关进程。未修改外部API账户或续费。

失败分类：**环境/外部服务账户余额阻断**。本轮没有证据将它归为模型语义、物理理论或预算接线失败。局部工程通过不等于实机初始化或完整V5通过；不生成包，封存后通知顾问独立只读审查。本目录清单SHA256由封存后计算，记录在项目日志及回调消息，避免清单自引用。
