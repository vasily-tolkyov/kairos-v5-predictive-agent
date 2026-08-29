# V5 证据表述与真实观察顺序：未完成实机闭环

结论：一次构建和20项直接相关测试通过；两项新DeepSeek接口补证各5请求，经执行者完整工具记录语义复核通过。唯一实机短测出现Runtime时序错误，已停止，不再尝试，**整体不通过**。

## 实际改动与验证

- `src/analysis.ts`：仅加一段通用证据边界提示。工具schema、模式提示、模型配置未变。
- `src/runtime.ts`：查询前入账已完成事件；按真实变化区间去重；主被动共用入账/计数/保存；处理跨界尾段；正常结束前排空；短测总事件hook。
- `src/analysis-harness.ts`：复用现有夹具与runCase，新增两项参数化反例；short引用旧七项、顾问第一题审定与本轮两项增量结果。
- `src/main.ts`：新独立短测目录，20请求/64事件边界，错误保留已提交快照。
- `test/runtime-observation-order.test.ts`、`test/evidence-boundary.test.ts`：新定向反证。

命令均在 `D:\Kairos_V5_Predictive_Agent` 执行；原始日志和命令/耗时/退出码JSON在本目录。

| 命令 | 实际结果 |
| --- | --- |
| 修改前Runtime定向红测（`RUNTIME_RED_COMMAND.json`） | 0/8，退出1，包含真实PhysicalMemory时间错误 |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | 一次，退出0 |
| `node --test dist/test/runtime-context.test.js dist/test/runtime-observation-order.test.js dist/test/evidence-boundary.test.js dist/test/analysis-harness.test.js dist/test/file-hash.test.js` | 20/20，退出0 |
| `node evidence/evidence-boundary-observation-order-short-loop-v1/RUN_NEW_CASE.mjs 0` | 5请求，退出0 |
| 同上参数`1` | 5请求，退出0 |
| `node dist/src/main.js --short` | 唯一一次，退出1；禁止为挑选成功结果重跑 |
| `node evidence/evidence-boundary-observation-order-short-loop-v1/REPLAY_LATE_WINDOW_FAILURE.mjs` | 离线最小复现，预期退出1；无模型/游戏调用 |

## 两项新增模型补证

第一项：槽位1→5，通知food18→17。模型读取并确认通知，以“只报告共现，不归因于select-hotbar”限制结论；1次夹具动作，无重放。

第二项：尝试槽位2→8，实际仍2，随后health18→16。模型明确动作执行不等于目标达成，仅陈述共现与非生产者证明，没有把health当作失败原因，也没有断言绝对无关；1次夹具动作，无重放。**限制：没有字面写出“原因未知”，task.unknowns为空；通知虽读入并写进结论，pendingAttention仍未确认清除。** 执行者判定保留了因果不确定性，不宣称该字段已清除；供顾问另行核验。两项均为工具接口证据，不是实际物理能力。

新案例原始材料见 `questions/*/{RAW.jsonl,RESULT.json,SCORE.json,SEMANTIC_REVIEW.json}`。原七项保留旧提示身份，旧末题不改分，不声称新提示下重跑了旧八项。

## 唯一实机结果

- Minecraft Java 1.21.4，新独立开发世界；Viewer/仪表盘未启动，未打开旧Formal。
- 1次模型请求。模型自主提出“原地跳跃是否改变onGround和velocityY”，选择jump→observe。
- 2个真实身体回执（1次空间跳跃、1次观察）；1条事件成功进入初始化缓冲；R1/R2/R2A沉积写入0，未初始化，eventMap=null。
- 760帧，序号1–760；连续性缺口0；入账/排队事件中的帧与原始frames.jsonl逐字段匹配，失配0。
- 第一个事件到37.65秒已提交，随后完成的被动窗口切出36.75秒结束的较早前段，触发时间倒退保护。具体序列见 `ROOT_CAUSE.md`、`REAL_SHORT_AUDIT.json` 和 `short-loop-001/events.jsonl`。
- 模型没有获得后续结果核对机会，没有finish；因此不能把身体执行或一条缓冲事件称为闭环成功。
- 实机后只做了原始记录离线复现，未重启模型/世界、未调参、未改码再跑。

## 身份、清理与边界

- 源码58项：`37568A58E6ECD9FFF6C50232DBC8136A4E169F757DDE4A6D1708F7CB1BB70D9D`；模型实验前后源码不变。
- 新提示：`C17130ADF9EB3B298CDA818DE012E26B777FF9F535AF05A49A780A724EBF346C`。
- 工具schema仍为：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`。
- 唯一已提交缓冲检查点规范内容SHA：`6A5FF8BC42EAC35F1CE1D0EEDC2C9AC629F54B3C24B2EEA7B5DDF4EBEDBE5938`；文件SHA：`FF6D1F9664032F85BE3756FA9A2266CBD4E68472B040051BBA4C717128A113AD`。
- 31项保护边界（物理核心、表示、memory、attention产生端、body等）哈希无变化，指定旧证据身份无变化；没有全树历史扫描。
- Formal V3仍0/false，文件SHA：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。
- 所有本轮自有服务已退出；25566/25567/18080/3000/3002无监听，见`SHUTDOWN_AUDIT.json`。不训练，不打包。
- 请求模型为官方`deepseek-v4-pro`；SDK未独立暴露实际响应model，日志后备值不能作为服务端身份确认。SDK cost=0仅表示本地未配置计价，不代表API免费。11次本轮请求的实际用量分别保存在`REQUEST_USAGE.json`，不保存原始思维链或密钥。

剩余阻断分类：**实现/Runtime事件入账顺序**。既有历史适用度、场景身份、受控实验与注意力产生端时序问题仍属后续范围。本轮不证明成熟预测/R2A或开放世界能力，等待顾问独立只读审查。
