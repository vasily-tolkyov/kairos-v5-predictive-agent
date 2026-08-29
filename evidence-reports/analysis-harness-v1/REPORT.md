# Kairos V5 任务化 Pi 与上下文：实施结果

2026-08-28。结论：**已实现并完成必要工程测试；当前固定模型/提示/上下文组合未通过任务资格；按批准的停止条件结束，没有启动 Minecraft 短闭环。** 不能把工程测试通过、测试工具调用或模型自述当作真实原型能力。

## 1. 三层结果

| 层次 | 实际结果 | 证据边界 |
|---|---|---|
| 上下文接线 | 一模型、一 Pi Agent、六模式提示、模型增量任务、不可改写证据、read_context、真实分词预算、精确动作参数/别名、通知接入已实现；相关测试 22/22 | 测试覆盖模式/任务保持、预算与工具配对、错误退出、通知中断；不是全部物理或注意力产生端验收 |
| 模型任务能力 | qualification-003 完成12个模式案例和3个连续情形；108次真实模型请求、108次结构化工具输出；严格合并门重评2/15 | 模型多数停留orient；也存在事实误读、循环和未处理通知。不能将失败唯一归因于参数量 |
| 实机结果 | 未启动。Minecraft动作0、真实writer写入0，short-loop-001不存在 | 不运行128初始化、开门、旧Formal V3或补充重试；测试工具的3次操作不算Minecraft动作 |

固定配置保持 Qwen3-4B / 8192上下文 / 输出768 / temperature=0 / seed=1262836050 / Pi0.84.2。qualification-003 实际输入4539–6488词元，由完整模板和工具模式经真实 llama.cpp 分词得到；输出合计7135词元、reasoning词元0。一个后续必需上下文6814词元被拦截，没有发送该请求。没有保存思维链。

## 2. 变更与边界追踪

| 计划要求 | 实现 | 验证 |
|---|---|---|
| 模型选模式、建/改/结束任务 | src/analysis.ts、src/cognitive-workspace.ts | 同一真实Pi基础Agent的多轮测试；raw model-intent记录 |
| 事实与笔记隔离、旧证据可取回 | CognitiveEvidenceV1、read_context | 不可变哈希、跨模式及超过两轮检索、原目标与笔记分开 |
| 真实8K预算、6500硬上限 | src/analysis-context.ts | 完整调用/返回组保留、必须材料失败关闭；REQUEST_TOKEN_AUDIT.json |
| 明确动作/别名/朝向 | src/analysis-actions.ts、src/body.ts | 空look拒绝、精确别名、FRU展示不改原坐标 |
| 通知携带完整事实、保留任务 | src/analysis.ts、src/runtime.ts | 注入通知的接入测试、实际Qwen continuity-interruption；产生端没有改动 |
| 复用身体/计算/服务，不加策略 | src/runtime.ts、src/services.ts、src/main.ts | 测试异常原样退出、无自动重试；短测入口先验资格再启动服务 |
| 独立案例与安全短测门 | src/analysis-harness.ts | 15个冻结案例、纯事后评分；本次门失败，短测不启动 |

实际13个源码/测试变更和文档详见SOURCE_CHANGES.json。物理介质、事件表示、恢复、PredictionClone、注意力产生端、模型配置与锁文件共27项与起始清单相同。没有把模型笔记、提示、测试响应写入物理介质。

## 3. 真实模型逐例结果（qualification-003，不重跑）

| 案例 | 请求数 | 重评结果与原始依据 |
|---|---:|---|
| orient-observable | 6 | 失败：当前观察槽位0，却报告“公开观察中显示选中槽位为2，当前满足条件”；旧评分误判通过已另存纠正 |
| orient-unseen | 7 | 通过：明确“无法确定，需要更多公开观察”；旧正则漏识别“无法” |
| recall-supported | 6 | 未通过模式覆盖：调用经验工具并报告，但始终orient；不将此单项等同于事实答案必然错误 |
| recall-counterexample | 10 | 未通过模式覆盖；报告无法确定当前适用，属于有价值的保留未知 |
| plan-supported | 6 | 失败：用户明确只推演却调用测试动作；随后6814必需词元超限，原样失败关闭 |
| plan-unknown | 12 | 失败：所有输入≤6488，继续重复观察/预测/重述任务，未finish；最小失败见MINIMAL_FAILURE.json |
| act-verify | 5 | 未通过模式覆盖；确实选择测试select-hotbar并依据返回报告2，但不是Minecraft动作 |
| act-no-effect | 5 | 未验证：模型选择了非当前准星目标；夹具抛test-target-not-current-crosshair，没有到达无效果反馈。该夹具比真实body的no-target返回更严格，是测试设计限制 |
| explore-question | 12 | 未完成：模型提出问题、调用一次零角度look测试操作，继续循环到上限 |
| explore-confounded | 12 | 未完成：重复记录/回忆，没有结束或隔离变量结论 |
| review-correction | 5 | 通过：明确切换review并用新观察纠正旧笔记为槽位0 |
| review-unseen | 4 | 未通过模式覆盖；“无法确认永久消失”是合理未知，不按旧正则算事实错误 |
| continuity-old-evidence | 6 | 未通过：没有翻第二页或重读最早证据，报告“全部历史已对照”不能当证据 |
| continuity-new-observation | 7 | 未通过连续性覆盖：只observe一次，未触发第二观察中的新读数，不能声称已证明忽略了已送达的3 |
| continuity-interruption | 5 | 未通过：通知完整进入下一请求，原目标仍在，但模型未处理通知、未作需要的推演即称“可以” |

10/15案例有finish，3例到12次请求上限，1例上下文预算错误，1例测试目标错误。108次请求中模式为orient 103次、plan 1次、review 4次；recall/act/explore提示未在这轮被模型选入请求。六模式可以跳过，**这不是强迫每次行动切换模式**；本项只说明所要求的六模式资格覆盖没有建立。

## 4. 失败保留与事后纠错

- qualification-001：15次HTTP400，在生成前被旧任务ID正则的`\\w`语法阻断；输出0。等价ASCII正则修复及Pi规范化原目标去重后进入下一实现版本，非无修改重跑。
- qualification-002：34次发送请求；重复相同观察材料使必需输入过大。已保留原失败、仅终止该次自有llama进程，精确内容去重修复后进入003；各观察引用/时点和原始材料未合并丢失。该次也暴露全局停止分类不够及时，在主动终止后留下一项0请求fetch失败；不算模型能力结果。
- qualification-003：完整冻结运行，源码前后一致；模型资格失败后不再调提示、改夹具、换模型或重跑。
- 结束后核查原输出发现三个评分器问题：当前事实漏检、`无法`漏判、把可编辑任务笔记当原目标。新增3个红测均失败，然后只改评分器及其测试；最终相关工程22/22。003内部原SCORE/SUMMARY和所有RAW/RESULT未修改，新分数在REVIEWED_SCORES.json。
- 评分器为这些封闭案例的有限字面规则，不是通用语义裁判。全部回答、工具返回和workspace可供顾问逐条检查；不因重评总数同为2而隐藏“一个假阳性被撤销、一个假阴性被纠正”。

当前仍有：模型在正确预算内不能可靠结束；只读目标被误执行（仅测试工具）；真实新事实连续性和无效果案例未获完整验证；必需材料仍可能超预算且会安全退出。历史经验的角色标识与当前对象别名的跨主体物理检索尚未通过实物验证，不能拿self/槽位夹具代替。注意力产生端另列不修。本轮不继续扩展修复或增加外部决策策略。

## 5. 命令、原始记录与独立入口

工作目录：`D:\Kairos_V5_Predictive_Agent`，TEMP/TMP均指向该目录tmp。

```powershell
& D:\nodejs\node.exe node_modules\typescript\bin\tsc -p tsconfig.json
& D:\nodejs\node.exe --test dist\test\analysis.test.js dist\test\cognitive-workspace.test.js dist\test\runtime-context.test.js dist\test\analysis-harness.test.js
```

最终构建退出0；上述测试退出0，22/22。直接红测退出1（2通过/3失败）。真实模型运行命令为`D:\nodejs\node.exe dist\src\analysis-harness.js`，003最终退出1。其原始控制台在qualification-003-console.log；各案例RAW.jsonl记录每次实际请求、输出和工具返回，RESULT.json记录任务/证据/错误，server日志与OWNED_SERVICES记录真实后端身份。精确执行命令及已捕获退出码见COMMAND_RESULTS.json。

不要再次执行模型资格命令。只读重评分命令见docs/task-pi-context-v1.md；它只读取003结果并调用scoreCase，不启动任何服务。最终源码只有评分器和对应测试不同于003冻结身份，已在REVIEWED_SCORES中列出；不会把旧模型结果重新标成“最终全源码实测通过”。短测入口对这一身份差异和未通过案例继续失败关闭。

## 6. 关键身份与隔离

- 003推理源码聚合：`8B9C1B4521F80A0BC59C42F34F00AEAECE5F2A1AFFE731A95DB309439C89A50E`
- 最终源码聚合：`62D509AC73D487A5843C57C79689C51328AF5E5DEE220C2644033466DA30D920`
- 最终源码清单文件SHA-256：`E62FCB9B3E4115A9D4B75175434564858AAE29D6E6ADB669C130A3AA898CB27C`
- 模式提示合并身份：`FA4FEDE34956165F50F7C6462F1C2829011BCC364296BA69BBCDC7AAF8785BF5`
- 工具模式身份：`E823464052DFE770E8D0CE14054A2A9C38C42F681762599CD52BCFD746BC116F`
- 案例承诺：`94DB15D02A9A9656481589C84CC349A93F8ECB1BC145CEA026D8DFC4BE48003B`
- 冻结GGUF：`7485FE6F11AF29433BC51CAB58009521F205840F5B4AE3A32FA7F92E8534FDF5`
- 冻结llama：`5A3CBD5613C45EF2D53D3AFC6734FD9E67229C0066C2415626DDC7C18901D36C`
- PhysicalMedium：`40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A`
- PredictionClone：`7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC`
- 恢复/物理配置：`AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E`
- 旧Formal V3状态仍0/false，文件SHA-256：`1A28B87A23AE08B6F597708BECEF14F5E2B61BBE76AD2EE779141E8E6B7A88DF`

全部27项隔离核查见FINAL_ISOLATION_AUDIT.json。旧证据清单本身未变，未重新扫描旧实验。18080/25567/3000/3002最终无监听，自有Qwen进程已退出。没有实机短测、训练、包或新正式访问。证据树完整清单为EVIDENCE_MANIFEST.sha256；独立重算记录为MANIFEST_VERIFICATION.json。

供顾问独立只读审查；不得把本报告称作任务能力或实机通过。
