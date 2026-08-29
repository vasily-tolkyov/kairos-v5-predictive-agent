# Qwen3-8B 有界本地试用：下载环境阻断

## 结论

本地型号接线已实现，直接测试 **3/3** 通过；完整模型下载失败，**真实8B请求0、原题0/8**。未取得任何8B任务能力、加载速度、生成速度或GPU卸载结论。本批按技术错误停止线结束，不再下载重试或生成。

这是下载传输阻断，不是模型理解、输入长度、显存不足或模型能力失败。没有调用DeepSeek，没有启动Minecraft、Viewer或初始化，也没有读取经验为可写模型。

## 已实施与验证

- `src/services.ts`：本地别名统一为 `kairos-v5-local-analysis`；复用现有 `--gpu-layers auto --fit on`，显式16K上下文不变。
- `src/analysis.ts`：生产Pi本地model id使用同一别名，名称不再虚称4B；远端分支、提示、逻辑工具及决策语义未改。
- `test/local-qwen8b-trial.test.ts`：3项配置、生产Pi传输和现有runCase独立输出/12请求上限测试。
- `TRIAL_CONFIGURATION.json`、`run-trial.mjs`：独立试用配置及复用Services.startAnalysis/runCase的入口。入口只做语法检查，未实际启动llama，不能称为真实组合入口已验证。

固定待试配置：Qwen3-8B Q4_K_M；context16384、输入7680、输出8192、余量512；原生思考开启；temperature0.6、top_p0.95、top_k20、min_p0、presence_penalty1.5、seed1262836050。保留120秒连续无有效生成进展规则。根DeepSeek配置未修改。

测试使用本地HTTP替身，共14个合成生成响应，不是模型请求。日志中12次observe后出现evaluation-request-limit及题目自动失败，是上限反例的预期行为；不得将它计入真实8B成绩或将3/3工具测试当成模型通过。

## 下载原始事实

[官方仓库](https://huggingface.co/Qwen/Qwen3-8B-GGUF)固定revision为 `7c41481f57cb95916b40956ab2f0b139b296d974`。已保存官方API元数据 `OFFICIAL_REPOSITORY.json`，大小及LFS哈希与计划一致：

- 期望大小：5,027,783,488字节。
- 官方期望SHA-256：`D98CDCBD03E17CE47681435B5150E34C1417F50B5C0019DD560E4882C5745785`。
- 资产目录：`D:/Kairos_V5_Predictive_Agent/runtime/models/Qwen3-8B-GGUF-7c41481f`。
- **完整GGUF不存在，本地完整文件SHA未取得。官方元数据核对不等于模型文件核验通过。**

首个单连接传输收到297,574,400字节后，执行者为改用无重叠分段续传而主动停止；该退出码4294967295不是网络自然报错。原因和时间在 `DOWNLOAD_RESUME_PLAN.json`，原命令在 `DOWNLOAD_COMMAND.json`。

分段续传最后一段4436507352–5027783487发生真正错误：HTTP206、curl exit18，140.453602秒只收到9,635,369字节，报告还缺581,640,767字节。原输出在 `DOWNLOAD_RESUME_RESULT.json`。协调脚本exit1，并停止其余自有curl；错误之后没有重试。

`DOWNLOAD_RESUME_RESULT.json`落盘时只有首个失败分段的完成记录；其他分段随后被取消，不能把该文件称作八段完整结果。最终所有残留文件实际大小另存 `RESULT.json/partialFiles`：合计397,604,393字节，均为未完成/未完整校验的片段，保留不覆盖。没有组装或冒充可用模型。

## 命令与退出码

工作目录均为 `D:/Kairos_V5_Predictive_Agent`，Node为 `D:/nodejs/node.exe`。

| 操作 | 真实结果/原始记录 |
| --- | --- |
| `node --test --test-name-pattern="^local8b: generic local alias" dist/test/local-qwen8b-trial.test.js` | exit1；旧4B别名确实不符合新契约；RED_RAW.log |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` 首次 | exit2；新测试TypeBox字段静态类型错误；BUILD_RAW.log |
| 修正该测试类型访问后相同构建 | exit0；BUILD_TEST_TYPE_FIX_RAW.log |
| `node --test dist/test/local-qwen8b-trial.test.js` | exit0；3/3、skipped0、1758.6599ms；DIRECT_TEST_RAW.log |
| `node --check evidence/local-qwen3-8b-task-trial-v1/run-trial.mjs` | exit0；仅语法检查，未运行模型入口 |
| 原始curl下载 | 主动停止，exit4294967295；DOWNLOAD_COMMAND.json |
| `node evidence/local-qwen3-8b-task-trial-v1/resume-model-download.mjs` | exit1；实际失败curl为exit18；DOWNLOAD_RESUME_RESULT.json |

收尾元数据核对另有一次执行者手抄期望哈希不完整导致exit1，保留 `EVIDENCE_FINALIZATION_ERROR.log`。改为读取已冻结配置后收尾exit0；未重跑测试、网络或生成，也未改动官方元数据。

## 资源与只读边界

运行前RAM总16,647,348KiB、空闲7,647,184KiB；RTX2060显存6144MiB、当时空闲4932MiB；D盘空闲127,337,635,840字节。详见 `RESOURCE_BEFORE.json`。这些是下载/测试前的资源采样，**不是8B实际运行占用**。实际卸载层数、实际16K加载、加载耗时、每题延迟和tokens/s全部未测。

收尾17个不可变直接文件及4个明确只读输入哈希均未变，不声称扫描了全部历史树。`CLEANUP.json`记录自有下载/llama进程0、18080/25567/3000/3002监听0。

- 根配置SHA：`46C32B042D96B3F820A5C2BDDF83F2BEEF8F91E9B6348726CC041E17C0D68CEB`。
- 成功64条经验文件SHA：`D2135C6E2FBA9FF5FACDB3258037272C3DDE8C2EB5BE991D66EB95C3461D395E`，指针未变；实际动作、缓冲、沉积和保存均0。
- 冻结llama文件SHA：`5A3CBD5613C45EF2D53D3AFC6734FD9E67229C0066C2415626DDC7C18901D36C`。
- 旧Formal V3仍 `accessCount=0/formalOpened=false`，状态SHA：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`。
- 本批20个明确直接文件的聚合身份：`4400E0F0B3AF266F0E57D9E6BBF30BC1C602E72E2740644F64F5147DAAC05CC3`；**不是全工程身份**。
- `SOURCE_MANIFEST.sha256`文件SHA：`2618307D95CC18CF926B4B6C5E2D81D7C54C37C1D550EC8C45A8F2E8F5B18DA3`。

核心哈希逐项在 `RESULT.json/boundaries`。原题、公开底图、Pi锁文件、物理/表示/恢复/Clone均未改变。旧4B2/3不作本轮同条件对照；未生成任何包。

## 验收状态

- implemented / validated（本地替身范围）：共享别名、auto/fit参数、固定预算、生产Pi原逻辑工具传输、独立runCase输出和请求上限。
- blocked（环境/下载传输）：完整官方模型取得与文件哈希验证。
- unverified：真实llama启动、8B资源适配、前三题与后五题、速度与任务表现。

本报告、RESULT.json和原始日志是本次交付；没有真实逐题结果可评分。结束后一次性回调顾问独立只读审查。
