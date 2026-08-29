# Kairos V5：动作边界观察顺序修复结果

日期：2026-08-28。工程：`D:/Kairos_V5_Predictive_Agent`。

结论：**本轮限定的窗口结清修复及一次“自主提问→真实动作→入账→模型核对/报告”短链路完成。不是整个物理原型通过。** 没有重跑实机或模型题，没有初始化 128 条经验。

## 实际修改

- `src/attention/monitor.ts`：新增真实截止帧 `sealThrough`；与周期窗口共用原处理函数；保留真实基线和尾帧。
- `src/runtime.ts`：动作末帧、recall/predict 固定截止和正常结束前结清产生端，再复用原队列入账。无变化被动切片不生经验；实际无效果动作仍学习。
- `src/main.ts`：short 使用显式 `--evidence-dir`，复用时间戳/随机世界 ID，不能覆盖已存在目录。
- `test/action-boundary-observation-order.test.ts`：9 个真实产生端反例，含上轮封存 760 帧的离线重放。

其余 55 个基线文件未变；30 项直接保护边界未变。没有修改模型、提示、工具、schema、config、身体、物理/表示/恢复/Clone 或注意力评分规则。

## 命令、退出码与范围

以下工作目录均为 `D:/Kairos_V5_Predictive_Agent`；完整参数、耗时及日志哈希见相应 `*_COMMAND.json`。

| 命令 | 次数 / 退出码 | 结果 |
| --- | --- | --- |
| 新测试单独转译后，`node --test dist/test/action-boundary-observation-order.test.js`，使用修改前生产编译文件 | 1 / 1（预期） | 9/9 红测失败；原始帧实际再现时间倒退 |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | 1 / 0 | 构建通过，3.630 秒 |
| `node --test dist/test/action-boundary-observation-order.test.js dist/test/runtime-observation-order.test.js dist/test/runtime-context.test.js dist/test/attention.test.js` | 1 / 0 | 20/20，0.902 秒；无模型/游戏 |
| `node dist/src/main.js --short --evidence-dir evidence/action-boundary-observation-order-minimal-repair-v1/short-loop-001` | **1 / 0** | 新世界短闭环，243.987 秒；不得为择优重跑 |

原七项资格、第一题顾问审定和上轮两项增量补证只读复用。没有声称在本轮源码重新运行旧八题、上轮两题或全量测试。

## 一次实机的实际链路

Minecraft Java **1.21.4**，新世界 `v5-2026-08-28T00-21-45-631Z-e5d98590`。可写根为 `D:/Kairos_V5_Predictive_Agent/runtime/v5-2026-08-28T00-21-45-631Z-e5d98590`，没有加载旧经验。short 沿用无 Viewer/仪表盘的路径，没有私人世界连接。

1. 模型读取公开身体/对象，自主提出“原地跳跃是否离地”的小问题。
2. 模型提出 jump(forward=false,ticks=3) 后 observe(ticks=2)。**实际只执行 jump 一次**：帧 1280–1298，真实回执 completed。
3. 监视器在动作真实末帧 1298 结清；真实可见性变化产生 unknown-change，后续 observe 因通知中断，驱动没有补做。
4. `event-1` 按原帧入账一次，真实结束时间 64.9 秒；初始化缓冲 1，核心沉积写入 0。
5. 模型读取实际结果 g1-e5 和通知 g1-e3，随后自己查询历史；收到 `physical-initialization-not-ready`，没有把空检索当作物理支持。
6. 模型更新任务结论并调用 finish；正常保存和关闭。没有错误、重试、预算强停或自动替模型完成任务。

原始帧 **4512**（1–4512），缺口 **0**，入账事件内嵌帧与同序号原始帧失配 **0**，重复变化归属 **0**。实际动作 **1**，成功入账 **1**，物理沉积 **0**，事件地图仍 null。模型请求 **7/20**，入账 **1/64**，未触发 128 初始化。逐条请求、工具返回、回执、原始帧及最终工作区均在 `short-loop-001`，计算结果在 `REAL_SHORT_AUDIT.json`。

实际输入词元：`5215, 7053, 10201, 11744, 13956, 17829, 21283`，均小于固定上限 24000。后端请求名 deepseek-v4-pro，Pi/配置不变；SDK 未独立暴露真实服务端 model，记录为**未独立取得**，不把回退的请求名当身份确认。cost=0 是本地未配置计费，不代表 API 免费；未持久化思维链正文或密钥。

## 未扩大通过结论 / 留给顾问的原始边界

- 原始动作帧**实际包含上升及正 velocityY**；现有 publicChanges 摘要按属性仅保留末次变化。模型报告“上升瞬间未捕获、窗口从下落到落地”只能表示它读到的摘要不含该部分，**不能当作原始采集事实**。本轮没有改旧摘要或模型提示。
- 模型将可见性变化描述为移动带来的渲染切换；本次没有隔离因果干预，不能把该解释认证为已验证因果关系。
- g1-e3 通知被读取但仍 pending，未由模型确认清除；未增加自动清空规则。
- 既有 AnalysisCore 的通用 evidenceResult 以工作区 latestObservationRef 标记序号；本次 recall 的 g1-e8/g1-e9 元数据为 2050，而 Runtime 在实际查询时结清的原始截止为 3330（166.5 秒）。没有改分析接口；**不得用这个旧元数据字段代替真实查询截止证据**。实际截止顺序有生产监视日志和定向调用参数验证。
- 没有运行成熟 R1/R2/R2A、随机预测支持、有效预测意外、多步开门或 128 条自主初始化。本次没有新的物理理论/环境故障；上述摘要/元数据/通知问题保留为范围外接口与表述限制，未盲目扩修。

## 身份和关停

- 最终源码（59 项）：`0C5554D4B692EB52194E2571FB321A9CAAB352D67032FEFBEF8FF9BC832E3765`。
- 提示：`C17130ADF9EB3B298CDA818DE012E26B777FF9F535AF05A49A780A724EBF346C`；工具 schema：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`。
- 最终快照文件 `experience-0001.json`：`7EC830B1E862700E3C42F5356ED3E090AE41358CAFD7B34949467F30EF41365B`；规范内容：`2987D9B137EE7295F90EBC2CACFCEBE2797AAE432100CDC10942424B67AB95A3`。
- Formal V3 仍 **accessCount=0 / formalOpened=false**；原状态 SHA-256：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。
- 原证据清单及直接复用输入未变；核心保护与源码差异见 FINAL_AUDIT.json。旧失败记录没有覆盖或重标。
- 自有服务端 PID 36228 已退出；25566/25567/18080/3000/3002 监听均为 0，见 SHUTDOWN_AUDIT.json。没有新包、Formal、训练或后台循环。

本轮证据清单和摘要分别为 EVIDENCE_MANIFEST.sha256、EVIDENCE_MANIFEST_SHA256.txt。停止执行，提交顾问独立只读审查。
