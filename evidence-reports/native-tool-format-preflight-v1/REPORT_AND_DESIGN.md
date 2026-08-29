# 原生严格工具格式预验：协议阻断，未改生产

2026-08-28。依据计划 SHA-256：`7A377C4AF6DC2486228CC12F6AB2D0A97D9F46CC92FCC07B9122570A6D771CBD`。

## 真实结果

6组本地检查通过：旧第13请求的9动作参数原样读取、被拒绝且没有自动搬移 direction；正确嵌套参数通过；五种补丁保真；10个原动作分支及类型/范围检查保留；实际调用已安装Pi严格转换器，确实报对象联合不支持；源模式与直接边界未变。对应 `OFFLINE_RESULTS.json` 和原始日志。离线命令执行两次，退出码均0：第一次后只补了线上JSON原始键序的留存，再冻结同一探针；未增发模型请求。

唯一线上命令 `D:\nodejs\node.exe evidence\native-tool-format-preflight-v1\format-probe.mjs --live`，退出码1。发送到 `https://api.deepseek.com/beta/chat/completions`，请求 `deepseek-v4-pro`、thinking enabled/high、strict=true；没有强制tool_choice、采样改动或重试。官方0813分词：2049输入词元；预算仍24000/8192。准备596.783ms，准备后至收尾约2488.485ms，无有效生成进展，无超时。

服务HTTP **400**：`An object with no properties is not allowed.` 请求包含interact/attack/break的空parameters（已显式properties/required/additionalProperties），错误没有指出分支。结果是**这一完整模式被拒绝**；不能由此断言所有anyOf均不支持，也不能证明移除空对象后一定可用。没有返回工具参数，因此“返回数据正确性”是**未验证**，不是模型语义失败。没有第二次生成、非严格回退或真实动作。

`PUBLIC_REQUEST_WIRE.json`保留实际发送JSON键序；`PUBLIC_REQUEST.json`是规范化公开副本。响应、HTTP、时序、命令和源模式均可直接复查。`PROBE_RESULT.json`中的serviceInputTokens=0及差值-2049来自SDK错误路径的初始化usage零值，**不是服务用量或分词失配**；服务未返回usage，权威解释是未取得，另见 `RESULT_INTERPRETATION.json`。实际响应模型身份也未独立取得；SDK计费表的0不证明API免费。无私密推理正文或凭据持久化。

## 最小无损接入设计（未实施、未经服务验证）

1. 保持七工具名称、同一个Pi循环、原逻辑TOOL_SCHEMAS及身体Action。仅在现有分析适配边界增加严格**线格式**与可逆解码；Pi工具参数使用线模式，原始线参数先经过现有反类型转换检查，再解码、验证原模式、调用原实现。这样多轮历史仍保存真实线参数，而非偷偷修改模型输出。最终onPayload给每个function加strict=true，避开Pi通用严格转换器；实际分词继续位于最终线请求之后。不升级SDK、不新增Agent或通用harness。
2. 空对象目前是明确阻断。未来可评估固定unit线表示：空parameters用且仅用`{"unit":"empty"}`，严格验证后还原唯一的`{}`；无参observe工具也需同类零元表示。它不补任何方向/刻数/目标，也不改变身体参数语义。但这是**新的传输表示建议**，本轮未发送，不是已证实可用的修复。不得直接据此启用生产strict。
3. 每个原可选字段在线上变为有标签联合：`keep`表示解码时省略；`set-null`表示实际null；其他`set-*`表示精确类型和值。原本不允许null的字段不得获得set-null分支。所有分支字段全required、无额外字段；不要统一“必填nullable→删null”。本地探针验证了以下区分：

| 原义 | 线表示与解码 |
| --- | --- |
| 省略、不修改 | `{op:"keep"}` → 该键不存在 |
| 真正null | `{op:"set-null"}` → 该键存在且值null |
| false / 0 / 字符串"true" / 空字符串 | 各类型set分支保留原值，绝不按truthiness丢弃 |
| 清空数组 | set-array且value=[] → 明确空数组；keep则不修改（仅设计，未做服务测试） |

   `parentId:null`是解除父关系；`recall.value:null`是检索null结果，不能变成无value约束。数组与字符串的清空仍按各字段原义执行；不自动完成任务或确认注意力。可选offset等只在解码后确实省略时沿用原工具已有默认值。探针的set-null是**标签解码为null**，不证明服务接受独立JSON Schema null类型。
4. [官方严格工具文档](https://api-docs.deepseek.com/guides/tool_calls/)说明受支持的结构限制和Beta入口；本次实测进一步暴露空对象限制。严格生成只约束受支持语法，不证明动作合法、目标存在、证据足够或任务完成。被服务子集移除的数组非空/数量约束仍由原本地校验拒绝，不能扩大动作权限或自动修正输出。
5. 后续如获批准，最少触及现有`analysis.ts`线模式/反类型转换/调用边界、`analysis-actions.ts`的纯动作线映射，以及Beta端点对应的配置和`services.ts`校验；逻辑workspace和身体/物理模块不改。必要直接检查：全部七工具省略/显式值往返、原错参拒绝、空对象unit拒绝多余字段、原范围与非空限制、原始线历史配对、最终payload实际计数及一次无执行服务兼容测试。本轮未落实这些生产变更，不能跳过下一轮兼容确认。

## 边界与交付

本轮仅在当前证据目录新增探针、结果和本说明；19个直接使用的源/编译/依赖/配置文件前后哈希一致，提示、六模式提示、七工具模式、ACTION_SCHEMA及官方计数资产未变。未重扫全库：沿用上一轮独立审定源码身份 `F2276323F648F43AFCF357ADC7A434FB8955B2BF064F73EDF0EFED2594D659A2`，不能将其表述成本轮重新全库计算的身份。

身体实例/实际工具执行/动作/writer/Minecraft启动/初始化/新增Formal访问均0。探针仅调用streamSimple，没有Agent、工具execute实现、Runtime或身体实例。Formal状态仍0/false，文件SHA-256 `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`；只读的旧失败文件哈希也未变。不训练、不打包、不声称V5能力通过。

请求线文件SHA-256 `C7F7BB75B86692B2B9D26E51AF3AA7BE1BF5988685CE9574EAE132B56B6C3067`；公开响应 `F43622A5DF7DB1CFD54D4FBF48A8552047584831CF6A95A6AD1B31F9D790B7D6`；实际执行探针 `535A9609116DEA7CE8C073DB2ED2E2EC5B76218AEE88F15D05C511AB2319E159`。

结论：本地语义保真检查通过；真实严格模式兼容性被服务协议约束阻断。按停止线收尾，供顾问独立只读审查；本轮不追加生成。
