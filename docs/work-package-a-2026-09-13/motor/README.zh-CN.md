# 工程包 A：实际按键收据

此目录保存动作时间边界的红绿回归记录。测试使用替代 Mineflayer 传输的装置夹具，**不是 Minecraft 原生能力或任务成功证据**。

## 修复及范围

- `BodyResult.motorReceipt` 新增 `MotorReceiptV1`，进入对应 `RealEvent` 以及发生错误时的 `body-incomplete-window` 原始归档。
- 请求、实际按下、实际释放分别记录进程单调毫秒、观察帧序号、观察时钟和物理 tick 计数。实际时长与请求时长分开保留。
- `actualTicks` 只计物理回调；`actualSeconds = actualTicks × 0.05` 是客户端 20 Hz 物理时长。`activeSeconds` 仍是原有感觉帧时钟；死亡附加感觉帧不冒充一个物理 tick。`elapsedMonotonicMs` 是实际进程经过时间，两种时间在 CPU catch-up 下不必相等。
- 覆盖 `move`、带 `holdTicks` 的 `jump`、`use-item` 三种持续按键。旧 jump pulse 及非持续动作保持旧合约，本补丁没有为其重建或伪造持续按键收据。
- catch-up 在帧回调内释放；死亡、故障、关闭、超时归因分别记录。释放调用只执行一次。原始请求 action/cue 不改写。
- `validateEvent` 校验新收据的版本、结构、有限数字、顺序、请求参数、实际差值、帧对应、释放结果与终止原因。收据不包含 action、对象 ID 或世界坐标，额外字段亦拒绝。
- `measuredMotorCueV1(event)` 派生实际持续时间的学习 cue。实际 0 tick 返回 `null`，不得训练正持续时间动力学。旧事件未带收据时仅返回原 cue，不增补时序证据；这不是对旧时序准确性的认证。

## 原始回归

`red-tests.txt`：同一测试文件在收据实现之前运行，20 项中通过 12、失败 8；失败来自新增收据要求，旧断言保留。`red-build.txt` 记录该时刻其他并行工作包测试中的 TypeScript 错误，编译器仍输出了执行红测的 JavaScript，未将此编译错误误作动作问题证据。

`green-build.txt`：TypeScript 构建退出码 0。

`green-tests.txt`：20 项全部通过，包括正常持续动作、同步 catch-up、死亡额外感觉帧、零物理 tick 死亡、非法收据以及故障/关闭/超时。所有原有断言保留。

复现命令：

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --outDir evidence/motor-dist
node --test evidence/motor-dist/test/body-motor-window.test.js
```

工具链为 Node v24.19.0、TypeScript 5.9.3。该目录本身不证明原生装置校准或工程包 B—E 达标。
