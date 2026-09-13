# 继续任务检查点：运行环境断开

本记录来自用户“继续任务”之后的实际工作。**候选尚未通过完整门禁，未发布候选源码，未新增原生实验。** 当前可获取的已验证源码仍为 `85175eeb00227ff5dd6e46676bbc8e1c543c0ab8`，其后证据提交为 `7918e5f8e9f8ce24577fd2c2375d6172a00cde34`。本检查点只增加恢复说明，不把工作区候选冒充远端已验证版本。

## 已完成与实测结果

| 项目 | 实际结果 |
|---|---|
| 初始化采集修复 | worker 同一次同步操作启动被动采集并返回初始帧，主线程采用回包中的帧；不会以更晚的缓存替换它。新增3项检查，单独集成阶段187/187通过。 |
| 原生旧证据边界复核 | 初始31到最后归档160应有129个间隔，实际128；唯一缺口31→32，无重复间隔和共享帧内容冲突。最终观测165，另有5个未归档的检查点/关闭尾部间隔，明确不算作已归档经验。 |
| 单窗口多对象泄漏反例 | 旧实现1个合成窗口×9对象产生8条所谓预更新校准并支持对象字段；1窗口×8对象不支持。精确回放已有ticks2被动窗口，5个窗口×2对象也已获得red支持。没有新增实测。 |
| 窗口校准候选 | 所有对象使用窗口更新前的self/object模型，保留每行拟合数据；支持按来源窗口计数。每窗口取最大归一化误差和最大原单位残差，拒绝重复窗口产生后验校准。 |
| 运动后备 | 新增最多32个来源窗口的校准记录；不得用同窗口多平面凑校准次数，也不得覆盖当前对象响应的refuted标记。 |
| 新增反例红绿 | 最初7项在旧实现0/7；额外motion-refuted反例曾9通过/1失败；最终10项新增检查连同既有相关检查共36/36通过。原失败、编译错误及诊断均保留。 |
| 最后完整集成门禁 | **197项：196通过、1失败；0取消/跳过**。Node24.19.0、TypeScript5.9.3，约59.312秒。失败见下文；既有断言、预算与目标未修改。 |
| 旧原生模型离线迁移 | 原session SHA-256 `6b449087f25f89d274dffd74422b7cdc754a7237f751cb261caf954810417894`；12个context circuits的原样本/误差、网络参数、事件和ledger、写入数保留，查询及重复事件无写入。此项只检查medium，不是原生重启或保持验收。 |
| 新原生实验 | **0次启动、0新增动作**。8决策/120秒和平检查已预登记，但尚未冻结执行副本或启动。 |

## 唯一完整门禁回归

既有 `open-world.test.ts` 的 `ten causal stages are composed from isolated experience with changing action availability` 在session前5步的断言返回 `no-offers`，预期 `executed`。原先的直接plan及runGoal十步组成检查已通过。诊断将失败定位至session第4次决策，原128节点预算耗尽；不是放宽超时可以解决的问题。

旧/新actor使用同一320个合成窗口对照。针对ticks7/self的signal0=true域，共10个实际窗口，旧实现首次遇到true类别时提前把它加入候选类别，错误地给一条本应为2的预更新误差记0，使准确率从真实7/10变成8/10。网络readout权重及协方差一致。新实现撤销该域支持是正确行为，**不得为了门禁恢复虚假的8/10或降低支持门槛**。

下一步调查：搜索身份仍包括未支持字段的占位值，可能对等价未知状态重复展开。候选方向是保留字段存在性，仅规范化未支持的值；实际观测、预测输出和支持证书不变。但**此搜索修复尚未写入、尚未验证**。先证明仅占位值不同的想象帧在medium预测与affordances后续可用性上确实等价，再增加通用重复状态回归；不能仅修改hash掩盖后续行为差异，也不能改变既有128/512节点预算或原生100/50ms预算。

## 候选状态与兼容范围

工作区：`/workspace/scratch/5d0f85e4c822/kairos`，分支`codex/evidence-domain-timing`。断开前本地HEAD是`7918e5f8e9f8ce24577fd2c2375d6172a00cde34`，有未提交候选。发布本检查点后远端HEAD会前进；恢复时先核对差异并保留未提交文件，不能hard reset。

候选修改：
- `src/adapters/minecraft/action-start.ts`、`src/adapters/minecraft/experience.ts`、`src/body.ts`：原子初始采集。
- `scripts/minecraft-body-connection.mjs`、`scripts/evaluate-minecraft-continuing.mjs`：worker方法与初始化调用。
- `src/contextual-readout.ts`、`src/experience-medium.ts`：窗口级校准。
- `test/worker-action-start.test.ts`新增3项，`test/window-calibration.test.ts`新增10项；门禁列表增加新测试文件。
- `scripts/audit-native-capture-boundary.mjs`与`scripts/audit-legacy-window-calibration.mjs`为新独立审计。

候选使用`ContextualReadout3`；旧1/2快照可读，原参数、targets和errors保留，但不伪造历史window ID，旧行不提供新的独立窗口校准。新真实窗口能重新支持保留的拟合，测试验证了8个后续窗口重新取得支持。主层`KairosExperienceMediumV11`及事件ledger保留。不能声称旧预测支持或旧任务能力无损。

窗口ID只随既有有界context行保存；motion另有最多32条记录。每次学习暂存受影响的两个动作网络，不复制整个长期模型。本轮未验收这些开销的原生最坏延迟或长期资源界限。全局plane后备在所有陌生情境、缺失/区间条件下的完整适用域也仍未完成验收。

## 工作区恢复入口

`docs/work-package-a-continuation-2026-09-13/`：
- `initial-capture-gate-187.log`
- `integrated-gate.log`与`integrated-candidate1-failure.log`
- `baseline-capture-failure.json`与命令记录
- `native-preregistered.json`：8决策、120秒、peaceful、world129604783、seed317、port25638，一次启动；所有拒绝保留。
- `diagnosis/legacy-migration-candidate1.json`
- `original-access-recheck.json`及已复制的诊断/失败日志

`evidence/continuation-support-diagnosis/`：
- `diagnose-ten-stage.mjs`、`ten-stage-diagnosis.json`（约32MB）、`ten-stage-reproduction.log`
- `diagnose-support.mjs`、`diagnose-object-window-counts.mjs`及冻结旧actor的JSON输出
- `window-calibration-*-build.log`、`window-calibration-*-focused.log`、baseline/red日志
- `REPAIR.zh-CN.md`与`repair-handoff.json`；它们记录专项检查完成时状态，必须结合本次完整门禁失败阅读。

`evidence/continuation-helpers/freeze-and-launch.py`是未执行的冻结/单次启动辅助脚本，最终门禁通过后才能使用。两份旧行为诊断脚本包含“旧泄漏应存在”的断言，不可把它们当作新实现验收；误用于候选的一次失败调用也已保存，未生成结果JSON。

## 断开与未解除的阻塞

工具明确返回：`409 Conflict, environment_offline: Environment is not connected`。主任务与诊断任务各重复最小检查后均无法执行；后续搜索修复写入没有发生。主任务尝试创建`diagnosis/replay-fixed.mjs`时也写入失败，该文件状态必须在环境恢复后核对。不能凭本说明制造丢失日志或假称代码已持久化；当前候选源码与大部分原始新增证据仍在断开的工作区，未上传GitHub。

原始三个ZIP的标题搜索没有精确匹配；GitHub Release387688738仍为draft，认证接口仅支持UTF-8读取，不能取二进制。仍需附件指定的5098/12321-write模型、frame19和原初始/停止世界，不能用旧V50/V51或新短跑替代。原文件为：
`kairos-native-evidence-20260913.zip`、`kairos-motor-evidence-20260913.zip`、`kairos-r6-retention-20260913.zip`。其既有哈希登记在前一工程报告的environment.json。

整体A–E仍未完成。恢复环境后优先修复上述单项回归，完成原断言下的完整门禁，再冻结/运行预登记短跑、独立审计并发布候选源码和原始证据。
