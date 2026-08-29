# V5 分页提示与严格工具接口对齐：限定交付

## 结论

**可信分页提示接线已修复并通过直接验证；真实分页闭环未通过。**

唯一无身体生产 Pi 目标只发送了 **1 次 HTTP 请求**。服务 HTTP 200，返回同一批次的 4 个 `read_context` 调用；四个调用的 `field` 已带标签，但 `offset`、`limit` 都仍是裸数字。它们在原始 HTTP 中已不合规，与 Pi 最终参数逐项一致。生产校验在第一个调用的实现执行前停止：工具执行、动作、经验写入均为 **0**，没有第二次请求、重试或游戏运行。

按计划归类为 **服务协议约束未兑现 / 参数格式失败**，不是物理失败、上下文耗尽或模型拒绝行动，也不据此推断模型一般能力。当前严格参数链的可靠性仍未建立。

## 实际变更

- `src/cognitive-workspace.ts`：注入只负责呈现的分页参数函数。数组 `more`、对象 `moreFields`、嵌套页及 `publicSummary/readPublic/material` 使用统一 `{tool, arguments}`，说明元数据在参数外。`readPublic` 的续页提示走同一函数；只调整一句分页阅读说明。存储、历史 query、公开值、模型笔记不改。
- `src/analysis.ts`：DeepSeek 提供既有 `encodeStrictToolArguments(TOOL_SCHEMAS.read_context, args)`；Qwen 仍提供逻辑参数。没有新编码器、输出修补、工具 schema、策略或重试。
- `test/strict-context-hints.test.ts`：7 项直接反例/回归，包括生产 Pi + 明确标注的模拟 HTTP 分页交接。这个模拟运输测试不是实际模型成功证据。
- 本目录脚本只复现红测与执行计划规定的一次无身体诊断，不参与生产身体或决策。

## 红测与命令

运行目录均为 `D:/Kairos_V5_Predictive_Agent`，Node 为 `D:/nodejs/node.exe`。

| 命令 / 原始文件 | 实际退出码 | 结果 |
|---|---:|---|
| 初次离线准备；`RED_RAW.log` | 1 | 错把封存文档顶层当 workspace，出现 TypeError；**不是目标红测**，保留原错 |
| `node evidence/strict-context-hint-alignment-readonly-v1/red-hints.mjs`；`RED_VERIFIED_RAW.log` | 1（预期） | 正确读取 `document.workspace.evidence` 后，3 个旧提示逻辑合法、严格线格式 0/3；模型请求0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.json`；`BUILD_RAW.log` | 2 | 新测试 `map(JSON.parse)` 回调类型错误，仅测试代码 |
| 相同构建；`BUILD_CORRECTED_RAW.log` | 0 | 修正该回调后构建通过 |
| `node --test dist/test/strict-context-hints.test.js` | 0 | 7/7，skipped=0 |
| `node --test --test-name-pattern '^(identical observation content is sent once\|public summary paging preserves\|explicitly requested read_context details\|the displayed task objective reference)' dist/test/cognitive-workspace.test.js` | 0 | 4/4，skipped=0；实际参数数组见 `AFFECTED_WORKSPACE_COMMAND.json` |
| `node --check evidence/strict-context-hint-alignment-readonly-v1/readonly-pagination.mjs` | 0 | 无请求的语法检查 |
| `node evidence/strict-context-hint-alignment-readonly-v1/readonly-pagination.mjs` | 1 | 本轮唯一真实诊断，首次参数错误停止 |

本轮直接测试合计 **11/11**。没有旧全量、八题、合成128、校准或实机初始化。早期日志目录准备问题和上述 TypeError/编译错误不算格式红测成功；真实请求前均已处理，原始失败未覆盖。

## 真实请求：输入、传输、参数分开核对

- 生产 `AnalysisCore`、同一个 Pi 0.84.2 Agent、原七工具；官方 `https://api.deepseek.com/beta/chat/completions`。七工具均发送 `strict=true`，各参数 schema 与当前生产逐项哈希一致，无 `tool_choice`。
- 封存源是旧 bootstrap 第一请求 `g1-e1`、sequence=33 的完整公开观察；本轮未读实时世界。实际首请求尾部三处提示均带 `set-string/set-number`，3/3 合法且可逆。原始 JSON 键序保存在 `FIRST_PUBLIC_REQUEST_WIRE.json`。
- 四个真实调用分别请求 `/objects` 的 offset 4 和 8、`/queryVocabulary/historySubjects` 的 offset 4、`/queryVocabulary/selfProperties` 的 offset 4。均指向存在的封存材料，但格式失败，**未读出页内容，未产生下一请求，因此语义核对及真实分页交接未完成**。
- `HTTP_PUBLIC_STREAM.jsonl` 只留公开 model、工具参数片段、finish_reason、usage，按 index 重组；4/4 与 `PI_PUBLIC_EVENTS.jsonl` 中的 Pi 输出一致。原流通过 clone 只读观察，没有改写；没有私密推理正文或凭据。
- 本次 stop 为 `tool_calls`，不是超时/截断。生成约16.970秒；私密推理仅记录有无和计数，不保存内容。
- 原始 HTTP `model=deepseek-v4-pro` 已独立取得；仅是服务响应名称，不证明底层权重身份。不能把生产日志的模型名后备值当作独立身份。

## 精确用量

| 口径 | 输入词元 |
|---|---:|
| 生产请求前计数 | 8248 |
| 实际发送 JSON 原键序，官方 tokenizer 内存重计 | 8248 |
| HTTP 原始 `usage.prompt_tokens` | 8302 |
| Pi `input 7662 + cacheRead 640 + cacheWrite 0` | 8302 |
| 服务减本地 | **54** |

原始 completion_tokens=1160（其中 reasoning_tokens=766），total_tokens=9462。保持 24000/8192/32768 和120秒无进展限制；没有补54常数或调整预算。缓存重复相加不是此次差额来源。差额原因仍未知；这次也不能宣称固定54永远成立。SDK cost=0 表示未配置本地价格，不表示 API 免费。

## 身份与边界

- 29 个直接相关源码/测试/配置/依赖文件的冻结身份：`9E2463851ED6E3028B86162D3F0F73AEE2D0602499182B4173A180D00F76ADB6`。这是**直接边界身份，不是全仓库身份**；清单见 `DIRECT_SOURCE_MANIFEST.sha256`。
- 本批26个不可变直接文件复核无失配；逻辑工具、动作、派生线 schema、原系统/模式提示、配置、依赖不变。诊断前后源码冻结无失配。
- 三个保护核心：physical-medium `40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`；PredictionClone `7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`；config `AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`。
- 旧封存工作区、原始 events、直接边界与旧清单4个已引用文件逐字节未变；未重新扫描历史树。
- Formal V3 仍 **0/false**；访问状态文件 SHA-256 `1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。
- 本轮无 Body/Runtime/PhysicalMemory/游戏实例；25567/3000/3002/18080 收尾监听为空，没有需停止的自有服务。

## 剩余与停止

1. **已修复**：可信分页提示与当前严格线格式不一致。
2. **未通过**：服务本次生成参数未遵守已发送的严格 schema；HTTP→Pi 未变义；没有真实页交接成功。
3. **未解决**：本地与服务输入计数仍相差54，来源未证实。
4. **本轮未验证**：初始化、物理学习、游戏/自主能力及任何全部工具保证。

按计划在首次真实错误后封存，不再改生产、不再发请求、不启动 bootstrap。交由顾问独立只读审查。

原始入口：`DIAGNOSTIC_RESULT.json`、`TRANSPORT_AND_COUNT.json`、`HTTP_PUBLIC_STREAM.jsonl`、`PI_PUBLIC_EVENTS.jsonl`、各 `*_COMMAND.json`。最终证据清单及其 SHA 见 `EVIDENCE_MANIFEST.sha256` / `MANIFEST_VERIFICATION.json`；这两个封存元文件不计入其自身。
