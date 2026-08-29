# V5 原生空值兼容性：本批结果

## 结论

`validated (limited)`：本地原生null无损接线通过；官方Beta接受本次全部七工具模式，真实HTTP中出现原生`parentId:null`，与Pi逐值相同，工作区实际应用，未发生SDK转换。

`not passed`：一次无身体记录—读取—结束闭环未完成。第2请求只读取了`limit=1`的任务页，实际返回`{id:"t0"}`而没有parentId；第3请求finish引用了`evidenceRefs:["t0"]`，但t0是任务ID而不是当前证据集合中的证据，生产抛出`context-reference-not-in-current-goal:t0`。不把HTTP200或格式合法当作完整通过。

按计划停止，未发第4请求，未改码/重试。**未启动bootstrap、Minecraft、身体、Runtime或物理核心，无动作、无经验写入、无新经验快照。**不是本批实机初始化通过，也不是对模型普遍能力的结论。

## 唯一生产改动

- `src/analysis-strict-wire.ts`：逻辑null直接派生、编码和解码为JSON null；删除set-null分支，明确不兼容旧包装。保留keep省略与unit零参数对象。
- 传输版本为`KairosNativeValueStrictWireV3`，不是旧Formal V3。
- 直接测试改动仅`test/analysis-strict-wire.test.ts`及`test/native-wire-budget.test.ts`。

analysis.ts与Pi反转换检查不变；七工具逻辑/动作/模型high/24000本地目标/32768总量/8192输出/超时/官方计数/Runtime/身体/观察/物理/表示/恢复/经验保存机制均未改。系统及六模式提示身份保持，只有获准的传输说明随版本更新。

## 红测与直接验证

工作目录`D:\Kairos_V5_Predictive_Agent`，执行器`D:\nodejs\node.exe`。

|实际命令|退出码|结果|
|---|---:|---|
|`evidence/native-null-wire-bootstrap-v1/red-native-null.mjs`|1（预期）|封存第5调用在原线模式不合规，Pi会将null转为空字符串；原对象未变，无模型调用|
|`node_modules/typescript/bin/tsc -p tsconfig.json`|0|一次构建，无诊断输出|
|`--test dist/test/analysis-strict-wire.test.js dist/test/strict-context-hints.test.js dist/test/native-wire-budget.test.js`|0|26/26，skipped=0|
|`--check evidence/native-null-wire-bootstrap-v1/readonly-native-null.mjs`|0|仅语法检查，无生成|
|`evidence/native-null-wire-bootstrap-v1/readonly-native-null.mjs`|1|一次真实无身体运行，3请求，首次运行时错误停止|

原始命令与时间在RED_COMMAND、BUILD_COMMAND、DIRECT_TEST_COMMAND、DIAGNOSTIC_COMMAND；原始日志在对应RAW文件。未跑旧全量/八题/合成128/校准。

新增本地反例经过真实已安装Pi：封存参数在旧模式仍拒绝，在新模式逐值相同、原对象不变；本地真实工作区子任务先keep保留父任务，再原生null清空，其他笔记保持；recall的显式null与省略不同，非法null与旧set-null/set-number包装拒绝。七工具与十动作原边界继续通过。

## 真实原始链路

没有强制tool_choice、重试、固定工具顺序或夹具注入null答案。任务要求模型明确记录根任务无父任务并读取核对。初始根任务本来为null；本次真实调用是显式写入同值，不冒充真实父关系从非空清除（后者仅在本地工作区反例验证）。

1. 请求1：HTTP工具set_intent实际发送`tasks:[{id:"t0",parentId:null,...keep}]`；当次模式合法、HTTP/Pi参数一致。逻辑解码为`{tasks:[{id:"t0",parentId:null}]}`，工具成功，其他任务内容全部保持。
2. 请求2：read_context实际参数为`reference:t0, field:keep, offset:0, limit:1`。页中仅`id:t0`，total=12、nextOffset=1，提供more提示；该真实返回进入请求3。没有实际读取parentId页。
3. 请求3：finish的结构合法，但`evidenceRefs:["t0"]`不是有效证据引用。工具进入执行后抛错，没有成功finish。公开报告称已读取核对parentId；当前工作区确实包含null，但读取工具页本身不足以支持这个核对链，不能算计划规定的读取验证通过。

首个实际程序错误为引用语义错误，不是原生null模式拒绝、SDK转换、HTTP400、预算超限或超时。三次HTTP均200，三个原始调用均合当次线模式且与Pi深相等；模型工具开始3次，成功结束2次，tool-error一次，反转换拒绝0。整体通过字段保持false，不改分数掩盖剩余问题。

原始HTTP公开流：HTTP_PUBLIC_STREAM.jsonl。首请求精确键序：FIRST_PUBLIC_REQUEST_WIRE.json。逐请求公共载荷、Pi事件、实际计数分别在REQUEST_*_PUBLIC.json、PI_PUBLIC_EVENTS.jsonl、TRANSPORT_AND_COUNT.json。工作区前后及真实更新在INITIAL_WORKSPACE、FINAL_WORKSPACE、TASK_TRANSITIONS；停止证据在STOPPING_FAILURE.json。不保存密钥、授权头或私密推理正文。

## 原始预算

|请求|本地最终发送体输入|服务prompt_tokens|实际输出|实际总量|差额|
|---|---:|---:|---:|---:|---:|
|1|6477|6502|1210|7712|25|
|2|7734|7759|221|7980|25|
|3|8041|8066|238|8304|25|

实际发送体在内存按冻结官方计数资产复算；原始HTTP与Pi用量一致。差额25原因仍未知，不补常数，不重标旧28/54。全部预算合法。真实响应model为deepseek-v4-pro（服务返回名，不是底层权重独立证明）；cost=0仍仅代表本地未配置价格，不表示免费API。

## 身份、隔离与未运行项

本批30项直接文件冻结前后失配0，其中27项不可变直接文件失配0；旧清单文件身份不变，未重扫历史证据树。见FINAL_AUDIT.json和SOURCE_MANIFEST.sha256。

- 直接源码聚合：`B5389C86AA480A4E2B28A8F2C1D6FF41A48BADBB74620FF731FD2E22680D6B34`
- 新线模式：`E8BA15CF3BBD21BDCC70786B4396EC999CA981739F93DCE8CBABAC35AB89378E`
- 七工具逻辑仍为：`3EA5953FE8D07164198E454D0BE443AA4D8BB1F9630B3FFF0D22ED3D1B278270`
- physical-medium：`40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`
- PredictionClone：`7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`
- core/config：`AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`
- 旧Formal访问文件：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`，保持0/false。

无身体完整门失败，因此一次初始化的前提不成立：未加载旧12条、未启动游戏、未产生新快照，未作恢复核对、开门或Formal，也未打包。诊断进程已退出，25567/3000/3002/18080无监听；没有需要强停的自有服务，未操作其他进程。

结论分层：原生null传输兼容性有限通过；任务读取核对/证据引用未通过；物理学习与初始化本批未运行。保持停止，由顾问据真实证据独立审查下一步，不在本批添加提示、引用别名修补或外部决策策略。
