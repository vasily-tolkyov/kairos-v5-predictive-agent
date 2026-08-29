# V5 原生严格工具无损接入：限定实现通过，首次真实初始化因格式错误停止

执行契约 SHA-256：B64522D5F99C287A49C45A3405384550B62A439BBFA82D894FF1BF95026188C6。
本轮为单任务；无子代理、无模型替换、无参数修复或请求重试。未修改物理、表示、恢复、身体、运行时、上下文顺序或进展时限。

## 实际改动

- `src/analysis-strict-wire.ts`：从原模式派生可逆线格式；真零属性对象使用 unit；原可选字段区分 keep、set-null 和带原类型的 set；原逻辑约束在解码后保留。
- `src/analysis.ts`：仅 DeepSeek 使用派生模式、原生 strict 标记及短线说明；原参数一致性检查后解码，调用原工具实现；分别记录原始线参数和逻辑参数。Pi 历史仍保存模型原始线调用与 ID。
- `src/services.ts`、`kairos.config.json`：官方 Beta 地址及原地址断言同步。
- 新增 `test/analysis-strict-wire.test.ts`；三个直接受影响的远端传输测试夹具改为产生线格式：`deepseek-backend.test.ts`、`analysis-turn-order-progress.test.ts`、`deepseek-template-alignment.test.ts`。

未改变原七工具逻辑 schema、ACTION_SCHEMA、SYSTEM_PROMPT、六模式说明、Pi 0.84.2、DeepSeek V4 Pro/high、32768/24000/8192、120 秒无有效生成进展时限。Qwen 接口保持原样，不作为后备。

## 工程验证

一次构建退出 0。明确文件与名称过滤的直接验证初次为 15/16，唯一失败是测试把包含双引号的原说明直接匹配到 JSON 转义字符串。改为检查实际 message.content 后，再编译退出 0，仅复验该项 1/1。16 个不同直接测试最终全部通过；没有重跑旧全量、八题、合成128或校准。

测试实际经过 Pi、原逻辑解码与测试端口；这些不算真实模型或物理能力。覆盖原九动作错参拒绝、unit、null/false/0/空值/省略、原范围、整链不部分执行、SDK 强转拒绝、历史配对、当前工作区、真实官方计数与错误不重试。

原始命令和输出：`BUILD_COMMAND.json`、`BUILD_RAW.log`、`DIRECT_TEST_COMMAND.json`、`DIRECT_TEST_RAW.log`、`TEST_FIX_COMMAND.json`、`TEST_FIX_RAW.log`。实际选中测试为16项，skipped=0；并非执行了全部文件内的旧测试。

## 唯一无身体协议请求

`D:\nodejs\node.exe evidence/native-strict-wire-integration-bootstrap-v1/strict-seven-tool-probe.mjs`，退出0。

HTTP 200；全部七工具模式被接受；模型生成一条 execute_chain，nested move/look/interact（unit→{}、o1）与预先固定的纯格式样例完全一致。只调用生产解码器，没有 Agent、身体、工具执行器或写入。其他六工具在这一请求中未生成，不能据此称其模型任务能力通过。

本地输入6813，服务输入6867，输出189（含推理70）。差54原样保留，未加常数或提高预算。`PUBLIC_REQUEST_WIRE.json` 保留实际请求 JSON 键序；`PUBLIC_RESPONSE.json` 保存公开原始参数；`PROGRESS_TIMING.json` 只存进展元数据，不保存思维链。

## 唯一真实 bootstrap-only

`D:\nodejs\node.exe dist/src/main.js --bootstrap-only --evidence-dir D:\Kairos_V5_Predictive_Agent\evidence\native-strict-wire-integration-bootstrap-v1\bootstrap-001`，退出1。

使用新隔离 Minecraft 1.21.4 世界，experiencePointer=null，从空经验开始；128初始化、512动作及每32条保存策略均未改。第一视角曾在127.0.0.1:3000正常启动，状态页3002；本次关闭后地址不再监听。

- 仅1个真实模型请求；456帧，序号1—456连续，缺口0。
- 模型返回 observe 与 read_context。observe 的 unit 正确解码为{}并只读执行一次。
- read_context 的 field 使用 set-string，但 offset=0、limit=12 为裸数字，违反本次提供的可选字段标签联合。Pi 校验拒绝，read_context 未执行；现有错误路径终止并清理。
- 本地输入8180；服务输入7594+cacheRead640=8234，差54；输出1191（含推理1036）。准备约0.586秒，生成约20.489秒；有1107次有效进展，未超时、未触及输入限额。
- 实际动作0、真实事件0、缓冲0、沉积0；初始化 **0/128，未完成**。无地图、无自然R2A或随机预测能力结论。

`STOPPING_FAILURE.json` 绑定生产记录的七工具 strict=true、实际返回值和 Pi 错误；`bootstrap-001/events.jsonl`、`frames.jsonl`、`RUN_RESULT.json` 为原始记录。该轮记录的是最终 payload 的规范日志，并非另一次 HTTP 字节抓包；服务端为什么未严格约束本次参数，尚未独立确定。不能将这次格式故障归为物理理论失败或一般认知能力失败。

收尾期间顾问独立只读核对进一步确认：该请求尾部工作区的 objects、queryVocabulary/historySubjects、selfProperties 三处 `more` 仍是旧逻辑 read_context 参数（field 字符串、offset/limit 裸数字），原逻辑模式3/3合法、新线模式0/3合法；同一请求却要求带标签线格式。模型实际返回的 field 已带标签而数字未带。**上下文操作提示与新接口不同步是确定的接入缺口**，是否唯一诱因未证明；服务 strict 未拦住实际错误须单列。详见 `CONSULTANT_READ_ONLY_ADDENDUM.md`。按停止线只补充披露，没有继续修改生产或重跑。

两次真实请求总计2（协议1、实机1），无第二次协议或游戏尝试。按首次真实错误停止线，没有修改模式、提示、身体或补参数后重跑。

## 身份、保存与限制

- 原逻辑七工具：3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270。
- 派生线模式：1D9A57EB4D13D377CBC8F4E02F537BBC20AFEF9370663105B79496F9AD5BB5F0。
- 28个直接相关文件身份：0DD80F7F6EF3DCE9B8C49FF8787DFB6C34D0A11392789E94F0900E395F7C290A；这是明确范围身份，不冒称全库源码身份。20个不可变直接保护文件及冻结后28文件失配0，详见 `DIRECT_BOUNDARY_AFTER.json`。
- 唯一保存点仍为空 `bootstrap-001/experience-0000.json`。指针使用规范对象 SHA：8D08EFEE61B671D1023C7CB97A410E939D470D36B434EBD5A23FACE3FBB298C9；文件字节 SHA：13C8279031035A2D2C44FD95ABE19D5DE9DD0B24E9A9C7D1A08FD433DB1EE27F。没有非空快照，未重复空快照恢复检查。
- 收尾首次审计误把指针对象哈希与含换行文件哈希直接比较，退出1；按既有 runtime 的 sha(snapshot) 合同修正审计后退出0。错误记录保留在 `AUDIT_INITIAL_FAILURE.txt`，未改生产或重跑实机。
- 请求模型为 deepseek-v4-pro；SDK未独立暴露实际响应模型。生产日志 responseModel 的同名后备值不算实际身份。SDK cost=0只是本地未配置价目，不代表API免费。
- 新发现计数差54，两次均出现，来源未确认；不是此轮停止原因，未扩大范围修复。顾问离线重计协议原线6813，去strict变体6778，排序键变体6770，均不能解释服务6867；这不是额外真实生成。
- `SHUTDOWN_AUDIT.json`：本轮自有Java/Node已退出，25567/3000/3002监听0。
- 旧 Formal V3仍0/false，文件 SHA：1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF。未训练、未开门、未打包、未扫描或改写历史树。

结论：可逆接口的直接工程验证通过，但生产上下文中的操作提示尚未与新接口同步；一次格式样例通过不代表全工具严格执行已保障。首轮实际初始化在 read_context 格式边界安全停止，完整V5与物理学习仍未证明。请顾问独立只读审查本次原始返回、所供模式与计数边界；不要为复验运行模型探针或游戏命令。
