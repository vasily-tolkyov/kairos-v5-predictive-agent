# V5 原生值传输与预算分层：本批封存结果

## 结论

工程直接验证及一次无身体分页闭环通过；唯一一次空经验实机初始化失败停止，未完成 V5。

- `validated`：构建退出0；直接测试24/24、skipped=0。新线格式保留普通JSON值，keep/null/unit分开；旧逻辑七工具及十种动作未改。
- `validated (limited)`：无身体2请求，3页真实读取进入第2请求；4个HTTP原始调用均合当次模式且与Pi参数深相等，模型只读结论与页内容一致。
- `rejected`：实机第5请求的set_intent携带 `/tasks/0/parentId: null`，不合本轮已经冻结的线模式。当前SDK会将其转换为`""`，原有生产反转换检查在工具执行前拒绝。这不是合法线参数被误拒，也不能把清除父关系与空ID等同。
- `not established`：128初始化、唯一事件地图、自然R2A条件、随机预测和后续目标能力均未建立。本批不改协议继续试、不重跑、不打包。

## 直接修改与边界

生产仅 `src/analysis-strict-wire.ts` 和 `src/analysis.ts`；测试修改 `test/analysis-strict-wire.test.ts`、`test/strict-context-hints.test.ts`，新增 `test/native-wire-budget.test.ts`。工作区既有提示presenter直接复用，未修改生产工作区/Runtime/身体/注意力/物理/表示/恢复/计数资产/配置/依赖。

线格式身份 `KairosNativeValueStrictWireV2`：普通字符串、数值、布尔、数组和非空对象原生传输；省略字段用keep，显式逻辑null用set-null，真正零参数对象用unit。旧set-number/set-string等不兼容兜底。模式在首次真实请求前冻结，实机失败后未改码。

预算是明确的契约修订：DeepSeek本地整理仍≤24000；服务实际输入+实际输出≤32768、实际输出≤8192。Qwen原输入硬限不变。服务输入略超24000但总量合法只在预算合成用例中验证，本次真实运行并未触及该边界。不增加差额常数或重试。

## 命令与原始结果

工作目录 `D:\Kairos_V5_Predictive_Agent`，可执行文件 `D:\nodejs\node.exe`。

|命令/范围|实际退出码|证据|
|---|---:|---|
|`evidence/native-value-wire-budget-separation-v2/red-boundaries.mjs`|1（预期红测）|RED_COMMAND/RED_RAW/RED_RESULTS；真实请求0|
|`node_modules/typescript/bin/tsc -p tsconfig.json`|0|BUILD_COMMAND（编译无诊断输出）|
|`--test dist/test/analysis-strict-wire.test.js dist/test/strict-context-hints.test.js dist/test/native-wire-budget.test.js`|0|DIRECT_TEST_COMMAND/RAW，24/24|
|`evidence/native-value-wire-budget-separation-v2/readonly-pagination.mjs`|0|DIAGNOSTIC_COMMAND/RAW/RESULT|
|`dist/src/main.js --bootstrap-only --evidence-dir D:\Kairos_V5_Predictive_Agent\evidence\native-value-wire-budget-separation-v2\bootstrap-001`|1|BOOTSTRAP_COMMAND/RAW、bootstrap-001/RUN_RESULT|
|`evidence/native-value-wire-budget-separation-v2/collect-postmortem.mjs`（离线提取）|0|POSTMORTEM_COMMAND/RAW、BOOTSTRAP_POSTMORTEM、FINAL_AUDIT|

没有旧全量、八题、合成128、物理校准、开门或Formal运行。模型请求总数7（分页2+实机5），无自动重试。

## 分页：有限成功

使用同一封存公开观察g1-e1/sequence33，读取objects、historySubjects、selfProperties三页，全部nextOffset=null，正确进入后续请求；finish报告对象共12、历史主体5、self属性8，和返回材料一致。工具仅read_context×3、finish×1，无身体/Runtime/物理核心实例。

独立HTTP公开流在 `HTTP_PUBLIC_STREAM.jsonl`，发送首体在 `FIRST_PUBLIC_REQUEST_WIRE.json`；逐choice/index参数、原始usage和实际发送体计数在 `TRANSPORT_AND_COUNT.json`。原始键序参与计数，私密思考不落盘。

## 词元：不掩盖差额

|范围/请求|本地输入|服务输入|实际输出|实际总量|输入差额|
|---|---:|---:|---:|---:|---:|
|分页1|7042|7070|978|8048|28|
|分页2|8639|8667|1193|9860|28|
|实机1|7084|7112|1744|8856|28|
|实机2|9499|9527|1688|11215|28|
|实机3|12962|12990|1735|14725|28|
|实机4|16204|16232|1174|17406|28|
|实机5|18735|18763|3380|22143|28|

分页数值来自原始HTTP usage与最终发送体计数；实机数值来自生产预检和SDK usage，未单独捕获实机原始HTTP流。新差额28仍未知，不能解释或重标旧54；未加补偿常数。所有本批请求实际预算合法，停止不是预算/超时故障。

请求模型deepseek-v4-pro、高档思考及配置不变。分页HTTP响应model确为deepseek-v4-pro（只是服务返回名称，不是底层权重独立证明）。实机 `responseModel` 存在请求名后备，因此真实HTTP响应身份记为“未独立取得”。SDK cost=0只是未配置本地计价，不表示API免费。

## 唯一实机与停止点

新世界 `runtime/v5-2026-08-28T04-56-10-106Z-1d2f0924`，Minecraft1.21.4，空经验；未导入旧增量。

- 原始帧3389条，序号1—3389，连续性错误0；12条完整事件中的帧与独立frames.jsonl逐帧一致，差异0。
- 真实身体回执12、真实入账12：look7、observe4、move1；重复入账ID=0。一次真实unknown-change中断了未执行的链尾observe，未把未执行部分算动作。
- 最后学习回报：缓冲12/128、沉积0、地图null；一条被动窗口已排队，不冒充新增已提交经验。
- 第5响应set_intent失败，随附execute_chain未开始；拒绝之后动作0、入账0。
- 最后成功指针仍指向 `experience-0000.json`（0事件）。12条增量未到32条保存点，失败后未补存。原始事件可审查，但不是可接续的成功经验快照；没有非空恢复验证。

`BOOTSTRAP_POSTMORTEM.json`保留实际第5参数、真实拒绝时刻和安装SDK的离线转换复现。唯一转换为null→空字符串，原对象未被就地改写；生产检查成功阻止含义改变。这里使用的是Pi公开记录，**不称为独立HTTP取证**。服务strict对所有工具的保障未获证明；不将有限分页成功推广为全部工具可靠。

失败分类：工具输出/线协议边界失败，叠加SDK隐式类型转换（被防线拒绝）；不是物理理论错误，亦不足以归为模型普遍语义能力失败。按计划停止，未扩修。

## 身份与清理

`FINAL_AUDIT.json`复核30项直接文件，冻结前后失配0；其中25个既有不可变直接文件失配0。不是全仓库扫描。旧证据清单文件哈希未变，未重扫旧证据树。

- 30项直接源码聚合：`62AB27E26ACC10DA72AB4D21109ED64D7BFCBD92E23F807D8CE25CB5C432EAE9`
- 逻辑七工具：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`（不变）
- 新线模式：`192DAD459ACB02D580E488BDC5A31E6641A917A2583043233AFE3DB54393DEFE`
- 最后空快照的文件SHA：`13C8279031035A2D2C44FD95ABE19D5DE9DD0B24E9A9C7D1A08FD433DB1EE27F`
- 该快照的规范JSON内容SHA（指针用）：`8D08EFEE61B671D1023C7CB97A410E939D470D36B434EBD5A23FACE3FBB298C9`
- 经验指针文件：`925C58CC90ABE4851BF7835F36ED27DCB19EC7FC483738E6C89C794BD64A5DB9`
- Formal V3文件：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`，始终0/false。

受保护三文件仍为physical-medium `40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`；PredictionClone `7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`；core/config `AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`。

自有Java/Node已退出，25567/3000/3002/18080无监听，未强杀其他进程，见SERVICE_CLEANUP.json。第一视角和状态页运行时可观看，现在已关闭。最终证据清单为EVIDENCE_MANIFEST.sha256（不包含其自身），留给顾问独立只读审查。
