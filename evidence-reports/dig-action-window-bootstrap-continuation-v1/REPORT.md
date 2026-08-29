# 挖掘窗口修复与一次有状态初始化续验

## 结论

`implemented / locally validated`：仅修改 `src/body.ts`，新建 `test/dig-action-window.test.ts`。旧生产分支真实复现 `dig-timeout`；新直接测试 **8/8** 通过。

`real continuation failed`：唯一实机运行成功加载原32条缓冲后，在第二次分析请求的 `read_context` 报 `context-public-field-missing`。本场 **0动作、0新增事件、0沉积、0挖掘**，累计仍 **32/128**。已按首次真实错误停止；没有扩大修改或重跑。本轮没有新增实机挖掘证据，不能称128初始化或V5通过。

## 本批直接修复

- 对开始时已绑定的原准星目标调用 `dig(target, 'ignore')`，不自动转向、换目标或换工具。
- 200个真实刻仍为一次尝试窗口；到期主动停止，沿用稳定3刻及宽限2刻观察，返回已执行尝试和 `terminationReason=observation-limit`，不宣称方块破坏成功。
- 只接纳本次停止对同一目标发出的 `diggingAborted` 与明确 `Digging aborted` 取消；普通拒绝、提前中止、帧/连接故障及内部错误仍原样抛出。
- 正常结束/异常结束撤销旧等待的计时器及监听器。真实事件仍由原生产分支构造并交给原Runtime；body不直接写物理核心。
- 少量 `dig-attempt-start` / `dig-attempt` 记录只含真实序号、原目标、准星和终止原因。

已安装Mineflayer在默认dig路径先lookAt、再启动挖掘计时。旧200刻/9984ms与普通依赖计算10000ms不等同；没有旧原始挖掘包，未断言服务器拒绝或唯一底层原因。Mineflayer正常完成包含客户端先行改图，其Promise不是独立服务器确认。本轮未新增服务器确认机制，也未伪造方块消失。

## 最小验证及真实退出码

| 执行 | 结果 |
| --- | --- |
| 新文件首项测试，旧生产body，单文件转译后运行 | exit 1，目标红测 `dig-timeout`；1项失败 |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | exit 2，仅新测试使用的 `Promise.withResolvers` 不属于冻结ES2023库 |
| 测试辅助改为普通Promise；只重编译该测试入口及直接依赖 | exit 0，未再次运行全工程构建 |
| `node --test dist/test/dig-action-window.test.js` | exit 0，8/8，skipped=0 |
| 下述唯一bootstrap续验 | exit 1，`context-public-field-missing` |
| 复用上批只读原始记录归约脚本，调整恢复计数及dig诊断 | exit 0 |

完整参数、耗时及原始输出分别保存在 `*_COMMAND.json` 与 `*_RAW.log` / `RAW_AUDIT.log`。初次构建错误没有隐藏；没有重跑旧测试、模型题、协议探针、合成128、物理校准或可视化。

```text
D:\nodejs\node.exe dist/src/main.js --bootstrap-only --experience-pointer D:/Kairos_V5_Predictive_Agent/evidence/report-reference-contract-bootstrap-v1/bootstrap-001/EXPERIENCE_LATEST.json --evidence-dir evidence/dig-action-window-bootstrap-continuation-v1/bootstrap-001
```

## 唯一实机原始结果

- 运行时间：2026-08-28 06:29:49.621Z—06:30:43.412Z，53.788秒；新世界/会话 `v5-2026-08-28T06-29-50-793Z-c0019854`。
- 真实帧544条，序号1—544连续，重复/乱序/缺口0；体验时点从388.15秒续接，末帧415.3秒，全部满足恢复时点加真实刻序号计算。无墙钟补时、插值或跨会话轨迹拼接。
- 实际分析请求2、响应2；第1次调用只读 `observe`。第2次提出两个 `read_context`，首个执行即错误，第二个未执行。
- 原始 `events.jsonl` 第60行给出 `g1-e2` 的合法分页提示 `/objects`、`/queryVocabulary/selfProperties`；第86行公开模型参数使用 `/data/objects`、`/data/queryVocabulary/selfProperties`；第88—89行首个执行失败。该证据的数据根没有 `data` 字段。详见 `FIRST_REAL_FAILURE.json`，未扩大成模型整体能力或物理理论结论。
- 新动作0、BodyResult0、新事件0、重复入账0、物理沉积0；原缓冲32条保持，地图null、R2A未建立。没有新的物理事件可用于证明挖掘修复实机有效。
- 本地/服务输入分别7339/7364与8204/8229，均差25；输出831与422。未改计数/预算或补常数。此次没有独立HTTP原流；公开参数来自生产Pi记录。服务实际model未独立取得，SDK字段可能回退为请求名。SDK cost=0不表示API免费。
- 没有finish调用：前批报告引用修复继续只保留既有本地验证边界。

## 经验、身份与封存

新目录只在启动时写出同一份恢复32条快照，无新成功增量；因此没有追加只读恢复。原输入指针和快照未变，未导入未保存8条，也未恢复旧动作、旧世界或旧工作记忆。

- 原/新启动快照字节SHA-256：`F95CF73E862E2DC97C75BA63B781CC3B0476B1B85DF847D69E8889781993F4E8`
- 快照规范内容SHA-256：`F9B01F71435B23C8736A1DE09DF184B77CF6A2224660E30CD7C99EE0BF9601EC`
- 本批32个显式直接文件身份（不是全仓源码身份）：`C691C95CC82BADF013AB909087D6D32DAC18AB1B6854EDC67BBB184A5421496B`
- body SHA-256：`3EED66FE79568AA2C11697E5175ECD65813FE6EF0AFD4B889E239DF8C6C9D5B9`
- 测试SHA-256：`07D33405FFD9184279B68806B592ED3CE4467A3C781A53ADB101F07D75BA16A7`
- 30个直接受保护文件零变化，测试/实机前后冻结清单零失配；分析、上下文、工具、配置、Runtime/main、表示及物理机制未改。
- 物理介质：`40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`
- PredictionClone：`7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`
- config：`AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`
- 恢复律文件：`85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922`
- 旧证据manifest字节保持 `6B414EE17FA91493DEEB8AC9CBF8538C2392197A88E6C4F6F47C4433671294FE`；本轮只复核该清单及直接复用输入，不声称重扫旧整树。
- 旧Formal仍 **0/false**，状态文件SHA-256：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。未开门、未打包。
- 已核对自有进程29036/10244退出，25567/3000/3002/18080监听均为0。只读观察窗口随本场服务关闭。

全部新原始材料由本目录 `EVIDENCE_MANIFEST.sha256` 封存，机器复核结果在 `MANIFEST_VERIFICATION.json`。本批精确停止类别：分析工具公开字段路径使用不匹配；更深诱因留待顾问只读裁定，不在挖掘修复范围内追加处理。
