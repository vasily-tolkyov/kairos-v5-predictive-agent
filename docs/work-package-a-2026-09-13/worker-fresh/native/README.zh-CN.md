# 异步 worker 新鲜开始帧绑定：本轮原生证据

源码提交 `85175eeb00227ff5dd6e46676bbc8e1c543c0ab8`。本目录与前序 native/final-native 证据独立，不替换旧结果。

和平模式、世界种子 129604783、8 次决策、120 秒预算按预登记运行。实际 17.339 秒完成 8 次决策：4 次执行、4 次因 action-start-expired 拒绝，总体执行覆盖 4/8=50%。全部 4 次执行的 token、完整匿名起始感觉摘要和预测计算起始帧一致；4 次拒绝全部保留，拒绝等待期间 worker 的帧序各前进 1，未暂停感知以等待预测。

**4 次 fresh 只表示开始帧绑定通过。** 这 4 个预测的 supportedFields 全部为空、compared 全为 0；comparison.basis 的默认 supported 字样不构成动作后果获得支持的证据。实质受支持预测 0、受支持任务计划 0，预测可靠性和数值区间覆盖没有可计算分母。目标仍 pending，不能声称任务成功、知识保持、迁移或长期自主能力。

**原始采集有 1 个未记录间隔：31→32。** 初始观察为 frame 31，首个被动窗口是 32→33。此缺口保留在停止世界审计、summary 和 audits/index 中，未补帧，也未重跑替换。不能声称连续感知无缺口。之后实际执行动作的首帧绑定审核仍通过。

记录 4 个主动窗口和 17 个被动窗口，共 21 次真实写入；保存玩家位置与独立停止世界一致、死亡 0。离线恢复检验保持模型/任务状态，清理 73 个短暂可见绑定，查询无学习写入，重复原始事件被拒绝。它不是一次原生重启运行。

独立运动装置随后运行，6 次请求均为 4 ticks，交错无附加负载与 230 ms 主机阻塞；SDK 独立计数全部为 4，嵌入收据和服务端位置审核一致。装置没有学习写入。

**worker 启动尝试共 2 次：1 次游戏前失败、1 次进入世界。** 初次 Node 启动在游戏启动前因旧 scratch 依赖目录消失而失败，原输出目录尚未创建，0 次动作/写入。失败日志完整保留；这次失败计入启动尝试分母，与运行内 4/8 拒绝分母分开。环境依赖安装另计 2 次尝试、1 次失败，不混作动作。随后 offline npm ci 因缓存缺失失败；使用官方 registry 和 npm 的 registry-host 替换选项执行 npm ci 成功，192 个版本逐项与原锁定文件匹配、源 package-lock 字节未变，依赖实体化到当前项目 node_modules。这不是增加原生预算或重复选取有利结果。

目录：worker-fresh-v1 保存原始主动/被动窗口、完整 journal、checkpoint、server-evidence 和停止世界 tar/provenance；worker-fresh-motor-v1 保存校准原件；audits 是冻结脚本输出；commands 包括全部启动/审核命令和失败输出；dependency-recovery 保留依赖恢复过程。actors 的 tar 含固定的全部 864 个 src/scripts/dist/test/package/配置文件，排除 node_modules 链接及 Java/server 二进制，逐成员验证后原子发布。

原始文件中的绝对路径是当时身份记录，不应静默改写。解包后的 actor 需要安装同一 package-lock 的依赖；审计及 harness 使用该冻结 actor 的脚本和 dist。MANIFEST.json 登记本目录除自身外的所有文件；actor 与停止世界归档另有逐字节核验记录。后续验证结果见兄弟目录 artifact-double-check.json。
