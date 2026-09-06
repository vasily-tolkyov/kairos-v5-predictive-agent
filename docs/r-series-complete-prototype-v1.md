# R 系列因果闭环与吸引域命名层

本版本在原有三个分布式物理介质之上增加两层**只读/证据边界**：

* `AttractorPublicEventDictionaryStoreV1` 只登记已经由可信真实事件到达并观察确认的终端吸引域。它保存的是物理终端签名到公开变化的审计关联，不参与候选选择，也不能在预测尚未到达终端时给出结果。冲突读出返回 `ambiguous`，未登记返回 `unknown`。
* `InterventionAgendaStoreV1` 记录高置信预测偏差。相同物理前缀和精确动作的真实窗口由 `InterventionPairCollectorV1` 配对，自动派生四臂实验候选；只有真实匹配臂的物理测量可以升级证据等级。词典和议程都不会写入 R1/R2/R2A 介质。

`KairosV5RSeriesRuntimeV1` 使用命名空间 `V5-RSERIES-V1` 包住现有物理记忆，检查记忆、词典和议程的独立哈希。旧的 V3/V4 检查点不被自动迁移；要建立新版本状态，必须从可信事件重新沉积。

## 最小接线

```ts
const runtime = new KairosV5RSeriesRuntimeV1();
const checkpoint = runtime.snapshot();
const restored = KairosV5RSeriesRuntimeV1.restore(checkpoint);
```

真实事件封闭后，运行时可以把终端读出交给 `recordAttractorPublicObservation`；注意力或实测回执确认高置信偏差后，交给 `recordPredictionViolation`。当议程打开实验单元，`pendingInterventionArmRequests()` 只返回尚未测量的物理臂，身体和联合控制场仍负责决定是否执行。`recordInterventionWindow()` 只接受已被记忆观察过的真实事件，并从不透明因素状态中推导匹配关系。

## 当前边界

这些接口已经实现并通过定向回归，但它们不会凭空制造因果证据。尚未出现两次真实预测偏差、四臂匹配执行或稳定的词典读出时，结果必须保持 `unknown`/`open`。Minecraft 真实演示仍需在中性 G3/G4 门和可信连续经验满足后单独运行；本版本不打开旧 Formal V3，也不改变受保护的物理核心。

