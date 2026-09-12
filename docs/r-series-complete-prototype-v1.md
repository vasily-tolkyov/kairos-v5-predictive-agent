# R 系列：保留的实验接口与删除的包装层

2026-09-10 第一性原理清理后，记忆由 `DistributedHierarchicalPhysicalMemoryV1`
统一拥有，生产持久化继续使用 V3/V4 协议。删除了只重复包装同一份记忆与哈希的
`KairosV5RSeriesRuntimeV1`；它没有提供另一条学习或控制闭环。旧包装文件需用
[清理前版本](https://github.com/vasily-tolkyov/kairos-v5-predictive-agent/tree/7fe4157dcac57daf9febf5f0d449ea938a081249)
审计，不会被自动当作生产检查点导入。

保留 `AttractorPublicEventDictionaryStoreV1`、`InterventionAgendaStoreV1` 与
`InterventionPairCollectorV1` 及其在当前记忆中的状态。词典只命名已由可信事件
确认的物理终端；冲突为 `ambiguous`，未登记为 `unknown`。议程与配对器保留
真实事件来源、前缀和精确动作的匹配边界。

```ts
import { DistributedHierarchicalPhysicalMemoryV1 } from './src/prototype.js';
const memory = new DistributedHierarchicalPhysicalMemoryV1();
const restored = DistributedHierarchicalPhysicalMemoryV1.restore(memory.snapshot());
```

`recordAttractorPublicObservation`、`recordPredictionViolation`、
`pendingInterventionArmRequests` 和 `recordInterventionWindow` 是实验接口。
主控制器没有完整调用它们构成自主实验课程，不能把接口存在表述成自主因果学习
已经完成。元证据内部通道和连续片段仍可审计；仅按片段/场景数量晋升
“meta-predictive-stable”的接口已删除，因为它没有验证任何预测误差。

本次没有改动物理介质、行动资格门槛或真实记录。能力状态以
[第一性原理审查](first-principles-review-2026-09-10.md)和
[三阶段报告](three-stage-test-status-2026-09-10.md)为准。
