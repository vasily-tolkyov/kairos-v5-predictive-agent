# 异步身体开始帧协议

本次在 PR #3 已保存的工程包 A 之后继续实现。原先 actor、原生窗口和历史报告保持原件；本目录是新的工程记录。

## 一次准备、一次条件执行

worker `prepareActionStart` 清空较早的真实被动窗口，捕获完整当前帧并发出一次性 token。控制线程使用准备响应内的确切帧，不用可能更晚的 `latest()` 缓存替代它；先消费此前的实测窗口，再通过原介质只读预测。

worker `executePrepared` 在收到请求时消费 token，比较当前完整原始帧摘要及序号。相符才在不经过 `await` 的同一调用中进入身体执行；否则拒绝这次尝试并交回等待期间的真实被动窗口。支持撤销、无可用动作或控制线程取消也会终结 token。没有内部重试、暂停世界或延长原规划预算。

新准备、普通执行与关闭会使旧 token 失效。未知 token 不会取走另一个合法准备所拥有的事件流。RPC 的较早响应不会让控制线程观测缓存倒退。

## 证据边界

- 成功收据的事件首帧仍须与控制线程预测的完整匿名帧摘要一致。
- 执行和拒绝收到的被动窗口均检查来源、时间顺序、边界和同 ID 内容一致性；重复传回不重复学习或计数。
- 预测异常、取消失败或身体异常保留已经收到的被动窗口。worker 彻底失效后只能恢复控制线程已有的证据，未传回的尾部不能凭空补齐。
- `body-action-start` 诊断包含 `WorkerActionStartReceiptV1`：token、prepared/accepted/refused/cancelled、原因、准备和核验时刻、帧序号、完整原始/匿名摘要与耗时。摘要采用 `src/util.ts` 的 `sha`（规范化对象 JSON）。
- `accepted` 只表示开始帧匹配，随后身体仍可能拒绝或发生故障；动作成功须看实际事件。诊断不会进入介质输入。
- 会话增加 `actionStartToken`、`actionStartElapsedMs`；过期拒绝不获得预测成功、局部反驳或已证伪失败试探的信用。
- 收尾即使身体关闭失败，仍尝试停止服务，并导出最终关闭诊断；最初异常不会被恢复异常覆盖。

## 软件证据

工具链：Node 24.19.0、TypeScript 5.9.3。新增 `worker-action-start.test.ts` 已加入既有串行标准门禁；未改变旧断言。

- `protocol-red-build.log`、`protocol-red-tests.log`：接线前 6 项中 3 个异步适配器反例失败，3 项底层保护通过。
- `protocol-green-build.log`：独立输出目录 `evidence/worker-action-start-dist` 编译通过。
- `protocol-green-tests.log`：新增 worker 协议及既有 action-start 合计 29 项通过，0 失败/取消/跳过。覆盖 session 的成功/过期、同序号不同感觉、单次 token、错误 token 不夺流、异常保全、冻结同 ID 冲突和未来被动污染。

这是协议正确性证据，不是覆盖率保证。若被动经验更新、预测或 IPC 跨越下一帧，拒绝率仍可能很高。原生验收必须计入全部尝试，分别报告准备、匹配、实际执行、过期拒绝和受支持预测；不得用无限重试或更宽时限制造通过。后续整体门禁与新 actor 的原生结果由新运行报告登记。
