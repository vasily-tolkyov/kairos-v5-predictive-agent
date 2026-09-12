# 2026-09-13 源码、经验与任务抢救交接

## 已经恢复并核验

| 内容 | 本次取得的证据 |
| --- | --- |
| 原型源码 | `ea097eb823eb28639c58639dd55f552fab08e98d` 全部 382 文件，与完整源码 ZIP 和原 Git blob 清单一致；原文件未改写 |
| 当前集成测试 | Node 24.14.0 / Windows 下重新编译，120 通过、0 失败、0 跳过，见 `validation/next-stage-tests-windows.log` |
| 未完成下载 | 从 239,626,527 字节的截断 ZIP 中恢复 5,928 个完整文件；每个文件通过 ZIP 局部头的长度和 CRC32 校验，并计算 SHA-256 |
| 已执行构建 | 抢救包保存 V48、V50、V51、V52 的执行副本；它们是历史构建，不能作为最新源码的替代 |
| 原生经验 | V47 完成动作 1,023 段；V50 新增动作 183 段、被动窗口 1,133 段；V51 新增动作 239 段、被动窗口 571 段，逐窗口原始文件已恢复 |
| 可用续跑起点 | V51 `ExperienceSession1`、停止报告与世界存档；累计 decisions=1600、executed=1445、writes=3149、passiveWindows=1704 |
| 世界一致性 | V47/V50/V51 存档 SHA-256 与原始 provenance 相符，停止时间和检查点计数相符；V51 的 28 个世界/配置/日志文件逐文件核验 |
| 对话记录 | 提取 248 条公开消息和 2,423 条已记录命令，包含消息 ID、时间与顺序；不包含隐藏推理、会话凭据或被隐藏的工具输出 |

当前代码已能运行测试；它并不代表原对话最后未保存工作区的完整恢复。
所有抢救文件的清单位于 `recovered-files.json`，恢复状态核验位于
`rescued-state-verification.json`，来源边界位于 `TASK_STATE.json`。

## 下载并准备恢复状态

发布页：<https://github.com/vasily-tolkyov/kairos-v5-predictive-agent/releases/tag/rescue-2026-09-13>

- `kairos-v51-resume-20260913.zip`：V51 的完整已恢复运行目录，适合接续；包含模型、世界和该轮原始窗口。
- `kairos-recovered-evidence-20260913.zip`：全部 5,928 个抢救文件，另含前序 V47/V50 证据和历史执行构建。
- `kairos-next-stage-code-ea097eb.zip`：原始完整源码 ZIP，保留来源提交注释和所有文件原字节，供独立核对。
- `SHA256SUMS.txt`：发布包 SHA-256；仓库 `release-assets.json` 记录相同身份。

两份抢救 ZIP 的文件路径保持 `kairos-handoff-ea097eb/` 前缀。原交接 ZIP 的中央目录缺失，
所以不能恢复原始 Unix 文件模式、符号链接属性和完整档案清单。完整成员的内容已校验；
源码内容另经完整源码 ZIP 核验，仓库文件模式与 Git 清单一致；完整源码 ZIP 本身也没有
Unix 权限字段。新包不是原来的完整 489 MiB 交接包。
最后截断的 V49 世界存档没有作为完整文件收录。

在仓库根目录操作，实验和下载放入已忽略的 `evidence/`，使用新路径：

```sh
gh release download rescue-2026-09-13 --repo vasily-tolkyov/kairos-v5-predictive-agent --pattern 'kairos-v51-resume-20260913.zip' --pattern SHA256SUMS.txt --dir evidence/downloads
```

下载后先按 `release-assets.json` / `SHA256SUMS.txt` 校验整个 ZIP。
PowerShell 可用 `Get-FileHash -Algorithm SHA256`；Linux 可用 `sha256sum`。
校验通过后再解压并准备恢复状态：

```sh
python -m zipfile -e evidence/downloads/kairos-v51-resume-20260913.zip evidence/recovered
npm ci --ignore-scripts
npm run test:next-stage
python scripts/prepare-rescued-native-checkpoint.py --evidence-root evidence/recovered/kairos-handoff-ea097eb --output evidence/resume/v51-predecessor
node scripts/verify-rescued-session.mjs evidence/resume/v51-predecessor/session.json.gz
```

恢复工具在创建输出前核对 session、报告、世界、原 provenance 和全部世界文件哈希，
拒绝覆盖现有目录。它只在新报告中重定位 `runtimeRoot` 并附加来源记录；
原报告和 proof 以原字节留档，session 与世界文件不改写，也不会增加经验或启动游戏。

原 `scripts/fork-stopped-native-checkpoint.py` 要求原始 Linux 绝对路径一致。
跨机器不要修改旧 proof 来绕过检查；使用本次新增的显式迁移工具。

本次在 Windows 完成了上述恢复准备，随后用当前 V52 源码加载 V51 session，
验证学习动力学、操作可用性和物理计数不因恢复而改变。没有启动 Minecraft 或进行新实机试验。

## 最后 V52 任务：新找回的信息

原命令记录 ID：`2ff487f9-a797-4107-a288-69d41ec034d7`，
时间：2026-09-11 21:19:04 UTC。完整原文见 `thread-final-activity.json`。

| 参数 | 记录值 |
| --- | --- |
| 运行目录 | `native-unfamiliar-v52-passive-transfer` |
| 执行副本 | `execution-builds/v52/scripts/evaluate-minecraft-continuing.mjs` |
| 经验来源 | `native-natural-v51-bounded-fitting/session.json.gz` |
| 环境 / 世界种子 | natural / `129604783` |
| 外部目标 | `recovered-evidence/v50-carry-and-reach-goal.json` |
| 下达时机 | `--goal-after 128`；按本轮循环计数，在 128 次新决策后提交 |
| 预算 | `--steps 2048 --seconds 3600`；steps 是本轮最多新增决策数，session 另保留累计计数 |
| 端口 | `25624` |
| 学习 | 原命令没有 `--frozen`，是允许继续学习的一组 |

目标文件的生成代码也已恢复（消息 `7fbef779-1e68-4efb-9b3a-2809514b8ec2`）：
要求 `position.2 < V50初始位置z - 24`，并且 `properties.gripCount > 0`。
它引用另一个 V50 起点的固定坐标，不能擅自替换成 V52 起点并称为原任务。
该 V50 初始观察文件未在已恢复部分中出现，因此历史数值阈值仍未知。
`recovered-v52-invocation.json` 保留原参数、目标结构和未知项，不提供伪造数值。

2026-09-11 21:28:25 UTC 的命令明确写入了暂停请求：持续的身体维护目标
占用所有决策机会，外部任务没有规划机会；要保留现场后修复通用目标仲裁。
原公开进度还指出食物值 17 / 期望值 18 的轻微缺口。
**暂停命令有记录，完成停机后的结果和 session 没有取到。**

源码 `src/experience-session.ts` 的实际逻辑与这个问题一致：
存在 `maintenance` 时，`pending` 外部目标不会入选。后续出现了
`apply_patch` 操作记录，但补丁正文被隐藏；“121 项检查通过”仅有对话陈述，
没有对应测试用例、日志或新版源码。因此没有把它编造进当前 120 项版本。

## 接续优先级

1. 建立新工作分支，复核源码身份、当前 120 项门槛和 V51 恢复链。
2. 在通用模拟环境中复现身体需求使外部任务饥饿，新增确定性检查；
   设计有界的调度，使身体需求与外部目标都有处理机会，验证快照恢复一致性。
   这是重新实现缺失修复，须使用新的提交身份，不能称为原 121 项补丁。
3. 修复通过后先从 V51 的实际停止世界做新的有界续跑。
   `--continue` 保留同一个世界；`--restore` 把经验带入新世界，二者互斥。
   记录本轮新增预算以及已有 1600 decisions，区分本轮计数和累计计数。
4. 再建立新的陌生世界迁移对照，明确定义新目标阈值和提交时机。
   可以参考原种子 `129604783`，但不能声称恢复了缺失的 V52 现场或重放完全相同的随机过程。
5. 检查任务吞吐、身体需求、生存、知识保留与实际因果前提；保留失败、
   经验擦除/冻结对照、真实世界核验和后续观察确认。

准备好 Java 21 和 Minecraft 1.21.4 后，新的同世界续跑示例为：

```sh
node scripts/evaluate-minecraft-continuing.mjs --java /absolute/path/to/java --server /absolute/path/to/server-1.21.4.jar --continue evidence/resume/v51-predecessor --output evidence/v51-new-continuation --steps 64 --seconds 180 --port 25624
```

`--steps 64` 允许本轮最多新增 64 次决策；累计计数从 1600 起步。
路径需要按新机器填写；此示例没有在本次抢救中执行。不要自动重跑全部历史命令。
原评估器会直接继续使用该新建起点内的世界；做另一组对照时，重新准备不同的起点目录。

## 仍不可恢复的部分

- 121 项版本的原补丁、新测试正文、实际测试日志及其源码身份。
- V52 最后运行的实时状态、实际初始观察、暂停完成后的结果与世界。
- 原完整交接包中截断位置之后的成员，包括部分更早原生对照材料和恢复工具。
- 原始云端完整 Git 历史；GitHub 导入提交不能冒充原 `ea097eb` 提交对象。

已恢复的 V47/V50/V51 和记录中的有限成功不意味着长期生存或开放因果多阶段验收通过。
尤其要区分支持规划、未接受的假设与好奇探索，不能把生命值回升、重生或目标终态的合取
直接当成学会了生存与多阶段规划。
