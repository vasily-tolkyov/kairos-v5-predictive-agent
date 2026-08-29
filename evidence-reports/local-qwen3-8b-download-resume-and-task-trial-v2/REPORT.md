# Qwen3-8B 有界本地试用 V2：下载通过，能力测试首错停止

2026-08-28；工程 `D:\Kairos_V5_Predictive_Agent`。本批没有修改生产源码、根配置、提示、工具或题目，没有恢复自主初始化。

## 结论

官方 Qwen3-8B Q4_K_M 已完整取得并实际加载。原前三题中实际启动2题、共6次模型请求：第一题语义通过；第二题发生工具引用语义错误并被生产边界拒绝，进程退出1。按冻结停止规则，第三题和后五题均未运行。不能称为八题通过、V5通过或实机能力通过。

| 原题 | 请求数 | 耗时 | 原自动评分 | 公开证据复核 |
| --- | ---: | ---: | --- | --- |
| current-versus-history | 3 | 254.709秒 | 通过 | 当前4、历史7、当前目标未满足均正确；引用真实提供的g1-e1/g1-e2，无动作。中间错误读取任务t0的`/data/self/selectedSlot`得到field-not-found，最终没有把该未命中伪装成读数。 |
| exact-query-conditions | 3 | 382.625秒 | 未通过 | 第3请求把任务ID t0放入`acknowledgeAttention`，不是注意力证据；生产抛`context-reference-not-in-current-goal:t0`。没有finish，本次任务更新未提交。 |

第二题唯一recall使用`lit=true,direction=increase`、省略主体，实际返回0条；随后正确翻页看到了铜灯当前lit=false，但没有完成铜灯布尔变化的精确检索与适用条件核对。省略主体本身合法；不得把此查询未命中当全部历史不存在，也不得把这次错误写成服务器故障或整个模型普遍无能力。

两题各自的 `RESULT.json`、`RAW.jsonl`、原自动评分及单列的执行端 `SEMANTIC_REVIEW.json` 均保留，顾问独立审查尚待回调。第一题通过不代表每个工具调用正确；第二题未完成也不抹去其成功的公开对象分页。初始模式由原harness给定，本轮未证明自主模式路由。测试历史与预测是明确标记的工具夹具，不能证明真实R1/R2A/Clone能力。

## 模型、下载与运行配置

- 模型：`runtime/models/Qwen3-8B-GGUF-7c41481f/Qwen3-8B-Q4_K_M.gguf`，5,027,783,488字节。
- 官方仓库revision：`7c41481f57cb95916b40956ab2f0b139b296d974`；固定[官方文件](https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf)。
- 下载复用旧连续297,574,400字节前缀；1次串行curl续传，HTTP206、退出0，新传4,730,209,088字节。curl耗时9,124.659秒；下载及校验总耗时9,139.475秒，在3小时限额内；无额外续传。旧9个片段全部保留、哈希不变。
- 完整文件SHA-256（下载后、加载前及收尾均核对）：`D98CDCBD03E17CE47681435B5150E34C1417F50B5C0019DD560E4882C5745785`。
- 冻结llama：b10516-b95502ba9，SHA `5A3CBD5613C45EF2D53D3AFC6734FD9E67229C0066C2415626DDC7C18901D36C`。
- 实际上下文16,384；输入上限7,680、生成上限8,192；原生思考开启；温度0.6、top_p 0.95、top_k 20、min_p 0、presence_penalty 1.5、seed 1262836050；单并发，120秒连续无有效生成进展时限。未调整参数、重试或自动续写。
- 调用现有 `Services.startAnalysis()` 和生产Pi/原runCase；没有调用会建立世界的 `Services.start()`。

## 实际速度与观测边界

加载及身份核验20.843秒。6次输入本地/服务计数全部相等：5656、6091、6176、5660、5848、6439。生成量分别342、394、444、645、517、611，总计2953；每请求77.073–138.283秒，总请求耗时637.278秒。服务日志生成速度4.53–5.25词元/秒，加权约4.87词元/秒。

6/6请求观察到原生思考进展，全部正常以tool_calls返回，随后第二题工具边界抛错；0次length退出、0次无进展超时、0次输入超限。SDK reasoning字段为0不证明没有思考；未保存私密思考正文。

配置使用`--gpu-layers auto --fit on`。RTX2060总显存使用峰值采样5111MiB（含其他程序），llama进程最大工作集6,824,361,984字节、最大private bytes 7,306,567,680，最小主机空闲内存976,908KiB。CPU与GPU均有活动。**当前未修改的日志和/props没有暴露实际卸载层数，因此层数未独立取得，不能称全GPU运行；没有为补该数字重启服务。** 原始资源采样和/props保留。

响应中的`kairos-v5-local-analysis`仅是本地服务别名；真实权重身份来自已核验文件和加载路径，不来自该别名。SDK cost=0仅是本地成本元数据，不能据此推导任何远端API免费。本轮未调用远端/DeepSeek。

## 命令与变更

- 本批下载：见 `DOWNLOAD_ATTEMPT_1_COMMAND.json`、对应RAW/RESULT及`DOWNLOAD_RESULT.json`；curl退出0。
- 能力运行：`D:\nodejs\node.exe evidence/local-qwen3-8b-download-resume-and-task-trial-v2/run-trial.mjs`，退出1；见`TRIAL_COMMAND.json`、`TRIAL_EXECUTION_EXIT.json`与逐题RAW。
- 新driver只复制原driver并替换新输出根；独立配置逐字节复用；只新增本批证据与完整模型文件。
- 本批没有重新构建或运行测试。复用上一批已通过的3/3直接接线测试（退出0）及必要构建（退出0），其命令/日志哈希在`BASELINE.json`；不冒称本批重跑通过。
- 收尾仅针对预声明输入、旧片段及必要只读边界做哈希检查：51项，0失配；未扫描全库或历史树。

## 不变性与清理

33项具名运行输入身份：`E0456A37FA1EC81644AF0D3B7583BA058D96C28311C2177F7860DD40AFADD14D`，运行前后相同；这是该输入闭包，不是全工程身份。

提示组合SHA：`E128DB6F66A56DD81F9A116D425568D3129ADF1575FFA3FD75A9093F42F6B61B`；逻辑schema：`120531C44777D6121EC03C78E872D37E488AE40BBDB62D192A77C5AF46857C70`；八题：`44FB24E9D42ED9C75F9CFF253F825CC007E608916B77D57EBA24B607A5835FA2`。每请求实际模式提示和载荷哈希另见RAW/REQUEST_METRICS。

根DeepSeek配置SHA仍为`46C32B042D96B3F820A5C2BDDF83F2BEEF8F91E9B6348726CC041E17C0D68CEB`。成功64条快照SHA仍为`D2135C6E2FBA9FF5FACDB3258037272C3DDE8C2EB5BE991D66EB95C3461D395E`；未加载为可写模型。

受保护介质/Clone/config/恢复页分别仍为：

- `40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`
- `7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`
- `AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`
- `85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922`

Formal V3仍为0/false，状态文件SHA `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。Minecraft、Viewer、初始化及Formal均未启动，真实动作/写入与夹具动作均0，无包。自有llama及driver均退出，13:03:35Z核对18080/25566/25567/3000/3002无监听。

## 审查入口与限制

原始输入、公开参数及结果：`cases/*/RAW.jsonl`和`RESULT.json`；逐请求用量/速度：`REQUEST_METRICS.json`与`llama-server.log`；身份/停止核对：`FINAL_BOUNDARY_CHECK.json`；最终文件清单：`EVIDENCE_MANIFEST.sha256`。

结论是**有限第一题通过、第二题工具使用失败、其余未验证**。本地速度较慢且内存余量较低，但没有把它误作本次停止原因。不能与旧4B的2/3作严格参数量比较：历史接口及预算不同。后续是否修接口、换配置或再试由顾问独立审查，不在本批继续修改或生成。
