# V5 物理证据内容、时点与读出边界：限定离线修复

结论：四项结果整理/绑定/读出修复已实现，新增 11 项反例从 0/11 转为 11/11。集中定向运行实际为 53/53、skipped=0。没有运行新的模型题、Minecraft、实机短闭环、真实初始化或 Formal；这不是整个 V5 或物理学习能力通过。

权威计划 SHA-256：`8276C1ED1CFCD8EEEFF9FC4255BB2BF1411F233D0502691AC9338189FA9FB978`。

## 根因、改动与直接证据

| 根因 | 修改接口/文件 | 直接验证及边界 |
| --- | --- | --- |
| 同属性仅保留末值，动作过程被截断 | `src/runtime.ts` 完整保留 `publicChanges` 及真实帧号/时间；`src/cognitive-workspace.ts` 保留完整材料和既有分页，预览给出 total/coveredRange/more | 只读回放旧 event-1：旧存储 8 条，新存储及分页均为原始 100 条；起跳 1281、上升 1281–1285、速度变号 1286、落地 1292 均可取回。顺序分页哈希与原始变化哈希同为 `EDEBA017EFAA7DC4AB89D654FDC7C1AFB91C4DF794BC90B9C27299C5C7635F46`。回放模型调用 0、缓冲 1、物理沉积 0。 |
| 证据被旧工作区帧或 await 后新帧错误标记 | `src/runtime.ts` 在查询捕获帧绑定结果；`src/analysis.ts` 仅取工具结果来源；工作区材料/分页保留 `activeSeconds` | 旧工作区 B=1/0.05s、捕获 A=2/0.10s、等待后 C=3/0.15s：空 recall、非空 recall、predict 均绑定 A。动作结束证据仍为 2/0.10s，随后公开帧 3/0.15s 单列。没有源时点的旧/夹具材料保持 null。 |
| 把动作总体支持误当作每条历史的当前适用度 | `src/memory.ts` 按同一查询中的 pageId+traceId 保留本条贡献，单列 `actionAggregateSupport`；工作区只公开允许的证据字段 | 同一精确动作 16 条候选、分页返回 2 条：本条 R3 分数分别 +3.6/-3.6，权重约 0.1249067464/0.0000932536；总体支持仍约 0.9，二者不混用。无当前关系时历史仍可查、总体支持 0；R1/R2 失效反例通过。这里使用明确标注的合成 R3/表示夹具，不是自然学得 R2A 的新验收。 |
| 已观察末核注释被再次读成未来变化 | `src/memory.ts` 的 `ReadoutBoundary` 区分原核索引与局部索引；`src/contracts.ts` 为读出增加 `originalKernelIndex` | 事实停留/返回已观察核不再给出未来变化；只允许随机轨迹命中未观察的后续核。离路仍未知，冲突标签仍为 indistinguishable-local-outcomes。真实生产调用使用原 Clone 24×180；修复前后起点/快照/调用参数及全部 24 条随机轨迹哈希相同。 |

实际修改 5 个生产源文件：`src/runtime.ts`、`src/analysis.ts`、`src/cognitive-workspace.ts`、`src/memory.ts`、`src/contracts.ts`。新增 `test/physical-evidence-readout.test.ts`。没有修改 Monitor、main、提示、输入 schema、配置、物理介质或恢复机制。

原始证据入口：`RED_TEST_RAW.log`、`TARGETED_TEST_RAW.log`。`REPAIR_RESULTS.json` 从这些日志提取指标并记录各诊断所在行，不用自述布尔值代替反例。完整 publicChanges 和随机轨迹逐样本哈希均在原始日志中。

## 命令及退出码

工作目录均为 `D:\Kairos_V5_Predictive_Agent`。完整参数、耗时和日志 SHA-256 在对应 `*_COMMAND.json`，不省略失败命令。

| 命令记录 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `RED_TEST_COMMAND.json`：新增测试对修改前编译产物运行 | 1 | 11 tests，0 pass，11 fail；旧编译身份在 `RED_COMPILED_IDENTITIES.json` |
| `BUILD_COMMAND.json`：`node node_modules/typescript/bin/tsc -p tsconfig.json` | 2 | 仅新增测试的数值联合类型缩窄和 literal 类型报错；生产代码已经正常 emit。原日志保留，不能写成该命令退出 0 |
| `TEST_TYPEFIX_COMMAND.json`：修正测试类型后，仅该测试及导入源码类型检查，并 emit 该测试 | 0 | 局部类型修复通过，未再跑完整构建 |
| `TARGETED_TEST_COMMAND.json`：8 个直接相关测试文件的集中运行 | 0 | 实际 53/53，skipped=0；包括新增 11 项及窗口结清/顺序回归 |

只读核对后若需要独立重复新增反例，可运行已编译的单文件：

```powershell
Set-Location -LiteralPath 'D:\Kairos_V5_Predictive_Agent'
& 'D:\nodejs\node.exe' --test --test-reporter=tap 'dist/test/physical-evidence-readout.test.js'
```

本任务没有为收尾再执行此命令。

## 必须披露的执行偏差

集中命令的排除过滤没有生效。`TARGETED_TEST_COMMAND.json` 中的 `explicitlyExcluded` 是当时意图，不能作为实际排除成功证据。原 TAP 的第 33 项确实执行了旧 `memory.test` 的 128 条离线合成事件校准（2300.8562ms）；另有两个原拟排除的纯内存测试执行。实际是 53/53、skipped=0，不能减去这些测试后声称它们没有运行。

这是测试命令/实验执行偏差，已主动披露并在 `EXECUTION_DEVIATION.json` 单列。不是 128 条真实 Minecraft 初始化；没有游戏进程、模型调用或生产经验状态写入。合成测试中确有内存沉积，不能把整轮测试的内存沉积数声称为零。原命令、原日志保持原样，不重跑覆盖。

收尾汇总另有三次局部脚本错误（括号、TAP 的 `\#` 转义、把分页长度 2 误当 total=16），均在写入派生结果前退出；修正后只读取已有日志生成结果，没有重新执行测试或更改原始记录。

## 保护边界与身份

`DIRECT_BOUNDARY_AUDIT.json` 逐文件核对 33 项直接保护边界、6 个明确复用的历史文件，失配均为 0；没有扫描历史全树。当前源码清单 60 项，5 项修改、1 项新增、0 删除。

- 起始源码身份：`0C5554D4B692EB52194E2571FB321A9CAAB352D67032FEFBEF8FF9BC832E3765`
- 最终源码身份：`21E52400352559F9CB34EB2460BA8C0CE417CC273D7D28BFCBBA53CA994D0E8F`
- 物理介质：`40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`
- 恢复势页：`85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922`
- PredictionClone：`7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`
- 核心 config：`AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`
- 提示身份：`C17130ADF9EB3B298CDA818DE012E26B777FF9F535AF05A49A780A724EBF346C`
- 输入 schema：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`
- Formal V3 状态文件：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`，仍为 `accessCount=0`、`formalOpened=false`。

真实 Clone 前后调用材料哈希均为 `8B0363753EE45D733EB2C21B462D1B20D8AEB4873BB5AF1C0DB60994944306C5`；夹具记忆查询前后哈希均为 `AAFBDA67DA52569332DA8DD5346B00C02DCC73E0099FD4DF2C4B3998C8C5F7DB`。

## 尚未证明与停止范围

本轮验证的是生产结果整理、查询时点、逐历史贡献和事实未来读出边界。没有重新验证模型任务能力、实机学习、自然形成的多因素适用度、整体注意力准备或完整原型能力；不把旧模型/实机资格算成本源码的新运行。历史未存储的绝对帧号保持未知。没有生成包或开启 Formal。

证据清单为本目录 `EVIDENCE_MANIFEST.sha256`；源码逐文件清单为 `SOURCE_MANIFEST.sha256`。完成后向顾问任务发送一次最终身份及此入口，等待独立只读审查。
