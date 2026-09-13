# 连续状态首片设计：让真实时序进入当前预测介质

状态：设计，尚未实现、未运行新测试或原生试验。依据用户的 `ENGINEERING_NEXT.zh-CN.md` 工作包 B 及当前 PR #3 代码。当前帧对齐开发试验应先完成并保存；本设计不改变它的 actor、预算或验收。用户已允许分派子任务；不恢复历史自定义运行协议。

建议首片完成一个闭环：**每个真实帧推进独立的实时状态 z；完整真实窗口才更新长期参数 θ；当前 `ExperienceMedium` 使用 z 和实际动作时间学习相邻帧变化，并用同一读出进行私有预演。** 不另加调度器、路线记忆或任务解题器。首片首先针对和平环境中有完整时间证据的短运动与主动/被动观察；其他动作保留原始证据，但不能假造已知的持续控制信号。

## 当前缺口与落点

| 现有位置 | 实际行为 | 首片修改 |
|---|---|---|
| `scripts/minecraft-body-connection.mjs` 的 `#acceptObservation` | worker 已发送每帧，连接仅覆盖 latest | 保留有界、有序的帧与动作边沿交付，并记录消费水位；不能将中间帧覆盖掉 |
| `ExperienceSession.#consumePassive` / `step` | 冻结学习时不调用 medium；world 只看决策前后帧 | 冻结仅禁止 θ 写入，z 仍处理所有真实帧；预测前拿到精确开始帧的 z |
| `ExperienceMedium.observe` | 校验全部帧，拟合与窗口校准主要是 first→last | 增加按实际 on/off 分段的相邻帧读出；所有子行仍属于一个原始窗口 |
| `ExperienceMedium.#field` | 最先登记的 32 个输入永久占位，16 维 tanh 激活没有跨帧状态 | 新编码版本使用固定总维度投影及跨帧激活；后来的公开通道不会因到达次序被排除 |
| `ExperienceWorld.observe` | 有界地点/表面回忆，不进入 medium 的后果预测 | 保留空间索引；从实际可见帧建立有来源的信念，并作为同一预测读出的条件；不把 remembered 追加进 objects |
| `ExperienceAgent.plan` / session 的 `#proposal` | 搜索节点主要是 Observation，相同当前画面合并 | 节点带私有 z；搜索等价键包括预测相关状态、来源和区间；不按原始历史 ID 区分 |

另一个不能忽略的问题是时间标签。`measuredMotorCueV1` 已用实际按键 ticks，但 `observe` 仍将整个窗口的最后一帧作为输出。当前 move 在按键释放后还可能等待最多 80 个稳定观察间隔，另加两帧尾部；jump/use-item 跳过该稳定循环，但仍有释放后尾帧。请求 move(4) 的标签因此不只表示四 tick 内的变化。把最终才知道的稳定时长加到 first-frame 特征，会泄漏未来；只把 z 加到现有 first→last 表格也没有解决这个问题。

## 最少新增的类型

以下是接口草案。可以放入一个纯类型/数值运算模块 `experience-live-state.ts`；唯一参数写入者仍为 `ExperienceMedium`，唯一执行拥有者仍为 `ExperienceSession`。

```ts
type FrameKey = {
  epoch: string; sequence: number; sensorySha256: string;
}; // 仅审计/去重，绝不投影进预测器

type RealFrameClockV1 = {
  version: 'RealFrameClockV1';
  physicsTick: number; activeSeconds: number; monotonicMs: number;
  sample: 'physics' | 'terminal';
};

type MotorSignalV1 = {
  version: 'MotorSignalV1';
  state: 'off' | 'held' | 'impulse' | 'unknown';
  cue: ActionCue | null; // 匿名公开动作；不含世界/任务/引擎对象 ID
  sincePhysicsTick: number | null;
  provenance: 'body-transition' | 'verified-passive' | 'legacy-unknown';
};

type RealFrameEnvelopeV1 = {
  version: 'RealFrameEnvelopeV1'; key: FrameKey;
  clock: RealFrameClockV1; observation: Observation;
  motorAfterSample: MotorSignalV1;
  motorEdgesSincePrevious: readonly {
    clock: MotorClockV1; signal: MotorSignalV1;
  }[];
};

type RememberedHypothesisV1 = {
  key: string; // 本进程信念记录身份，非模型特征
  source: 'remembered-real'; lastSeen: FrameKey;
  lastSeenActiveSeconds: number;
  appearance: Readonly<Record<string, PublicValue>>;
  relativeBounds: NumericRanges; // 已测自身位姿下重表达的可能位置
  association: readonly { perceptId: string; weight: number }[];
  unresolvedMass: number; visibleNow: false;
};

type ExperienceLiveStateV1 = {
  version: 'ExperienceLiveStateV1'; encoder: 'continuous-receptors-v1';
  revision: number; frame: FrameKey | null; clock: RealFrameClockV1 | null;
  h: readonly number[]; // 16 个持续激活，与当前 readout 的尺寸一致
  motor: MotorSignalV1;
  hypotheses: readonly RememberedHypothesisV1[];
  continuity: 'continuous' | 'unanchored' | 'gap';
};

type PredictionBranchV1 = {
  origin: 'imagined'; thetaVersion: number;
  observation: Observation; state: ExperienceLiveStateV1;
  bounds: NumericRanges; remainingTransitions: number;
};

type LiveAcceptance = {
  disposition: 'advanced' | 'duplicate' | 'gap';
  stateRevision: number; lastConsumed: FrameKey;
  thetaWrites: 0;
};

type RealWindowStateTraceV1 = {
  version: 'RealWindowStateTraceV1';
  parentWindowId: string; eventSha256: string;
  encoder: 'continuous-receptors-v1'; thetaBeforeVersion: number;
  start: ExperienceLiveStateV1;
  intervals: readonly {
    before: FrameKey; after: FrameKey;
    priorH: readonly number[]; inputSha256: string;
    dtPhysicalSeconds: number; observedMotor: MotorSignalV1;
  }[];
}; // 内部构建并核对原始帧/边沿；不能接受调用方任意声称的 priorH
```

`thetaVersion`、z.revision、epoch、frame digest 和时间戳用于绑定与缓存失效，不是情境类别。物理积分使用 physicsTick 差与引擎时间；进程 monotonicMs 只记录交付延迟和时间异常。当前 `activeSeconds = offset + sequence * .05` 还把终端采样计为序列时间，因此不能将它单独冒充实际控制持续时间。必须记录物理帧时钟；历史缺失值保留 unknown，不能用请求 ticks 倒推。

绝对 physicsTick / sincePhysicsTick 只用于核对时序。预测输入使用两者差得到的已持续时间，不能让绝对时钟或进程顺序成为隐含世界 ID。混合 on/off 边沿跨越一个采样区间时，trace 的 motor 字段应展开为按实际时长计量的有限段数组；不允许多数投票把少量按键时间抹掉。首片可在该情况出现时保留真实帧但将动力学行标为 unknown，待支持分段积分后再训练，不能偷偷归类为完整 on。

motorAfterSample 不是上一间隔实际施加的动作。边沿日志必须能表达“这一帧结束了最后一个 held 间隔，随后释放”；相邻区间 `[frame_i, frame_i+1]` 的暴露由按下/释放时钟和物理 tick 交集得到，不能错把最后一个 on 间隔记为 off。零物理时长的终端采样仅同化实际感觉，不产生 dt=0 的动力学训练行。

## 实时 z 与 θ 的写入路径

建议增加三个窄接口，而不是让 `observe` 同时承担所有隐含副作用：

```ts
medium.acceptRealFrame(frame: RealFrameEnvelopeV1): LiveAcceptance;
medium.observe(event: RealEvent, trace: RealWindowStateTraceV1): LearningReceipt;
medium.predict(cue: ActionCue, observation: Observation,
  options: { state: Readonly<ExperienceLiveStateV1>; /* 现有选项 */ }): ExperiencePrediction;
```

1. 连接在真实 frame 消息与 motor 边沿到达时按 worker 顺序交付。环境完成匿名化后，将有来源的 envelope 交给 session 的一条真实输入路径。z 的同化不能写 θ、affordances 或校准计数，也不能改变动作选择计数。
2. 每个 `(epoch, sequence)` 只同化一次；共享边界同 digest 为幂等，不同 digest 报冲突。缺口、逆序、跨 epoch 不能当连续经历。连接队列/trace 超预算时明确产生 gap、撤销连续性支持，并保留溢出原因；不能阻塞身体时钟或静默跳帧。
3. 主线程处理消息可能落后于采集。这是有记录的处理延迟，不声称硬实时。在预测前必须完成截至预测帧的全部真实输入；不允许对较新帧或仅 latest 重建 z。开始帧过期仍按现有原子 guard 拒绝。
4. 保存一个有界的 `FrameKey → z at frame` 环和每完整窗口的紧凑 trace。trace 记录开始前读出版本、每个区间的前状态摘要/激活、实际 dt/motor 及真实帧引用。先同化到 prepared frame，再取该帧的不可变 z 给 fresh prediction。worker 已走到更晚帧时也不得用更晚的 z 替换它。
5. `#consumePassive` 对所有帧走相同同化路径，包括 `learn:false`；完整真实窗口的验证、去重和原始归档规则继续生效。只有 `learn:true` 才调用 θ 更新。动作返回与拒绝分支都排空此前实际被动输入；重复归档边界不会重复推进 z。
6. `observe` 使用当时 trace，不使用窗口结束后的 live z 充当初态。一个窗口的全部预更新误差先算完，再拟合 θ；随后到达窗口的感觉绝不能混进较早预测。
7. `ExperienceWorld.observe` 移到这条逐帧输入路径，使用同一个去重键。world 保持地点索引用途，不拥有另一套物理预测参数。每帧复杂度须有上限；地点/表面淘汰不能每帧排序全部历史。

首片可沿用 body 的 512 帧最大在途窗口作为 trace 项数上限，但应只存紧凑激活、键、边沿和原始窗口引用，避免又复制 512 张图。必须另设并记录字节上限；512 是工程容量，不是独立经验数或长期保持保证。raw worker queue 与 trace 都要有溢出测试。若主线程持续赶不上，这一片不能通过 B 的延迟门禁，后续才考虑让计算分批让出执行；不把有丢帧的最新缓存包装为连续状态。

## 状态真正进入同一个已学习预测器

首片复用当前 32 维 receptor、16 维 tanh population、49 维 RLS readout 及 ContextualReadout，不新建一个给控制器直接提供答案的对象记忆预测器。

新版本将公开感觉通道、缺失/来源掩码、匿名实际 motor 信号和 dt 投影为 32 维输入 `r`；通道名及公开类别值通过固定、带符号的两路散列贡献到固定维度。编码不依赖发现顺序；连续值须有显式有界缩放。散列碰撞允许降低表达质量，**不能生成支持证书**：上下文域检查仍保留未散列的可追溯公开条件，以及相应的缺失/来源/时间范围。新增通道不再因为出现在第 33 位以后而永久没有连续通路。

用同一 tanh population 保持 `h`，例如：

```text
alpha_j(dt) = exp(-dt / tau_j)
h_next = alpha * h + (1 - alpha) * tanh(W*r + R*h + b)
field = [1, r, h]
predicted sensory delta = learned_readout_theta(field)
```

`W/R/b` 和时间尺度是编码版本的一部分。R 的范数应受限，确保有限输入下状态稳定。可先把 `[0.05, 0.5, 5] 秒` 作为跨数量级的开发候选尺度，**不是已验证常数**；在首次开发测试前固定，通过相同真实轨迹的时间扰动检查，不能按目标发生时间调节。首片只学习同一介质中的时序读出，递归核保持固定作为可审计的记忆基函数；不得将它宣传为已经实现完整可塑的多尺度动力学。若固定递归核不能承载必要历史，B 仍未完成。

`r` 必须含有当前感觉与“有来源的历史条件”两种不同掩码。历史内容的记忆存在本身是已观测事实，但对应物仍存在、位置正确或机制未改变不是已观测事实。预测过去线索消失后的身体后果时，h/历史条件进入与其他实测输入相同的 `#field`、`#learn` 和上下文域检验。没有独立窗口数据说明这种历史条件可靠，就只能给假设。

对实际观测，h 由按时序到来的真实感觉同化；对想象分支，先由该同一 learned readout 产生下一感觉的区间/可能类别，再推进分支 h。未知感觉保留 unknown 掩码和不确定区间，不用 0 或复制旧值冒充测量。因此未来分支状态由 θ 的真实经验读出驱动。消融 h 后同一当前感觉必须失去本来依赖历史的区别，否则这条状态通路只是装饰。

新接口应显式返回后继分支状态。`ExperienceAgent.plan` 队列、`explore` 预演、`ExperienceSession.#proposal` 和 fresh prediction 四处统一传入/接收它；不能只有主计划使用 z。`experienceSearchKey` 增加预测相关 h/历史来源/区间的编码摘要。不能把相同画面但不同可预测历史合并，也不能因相同语义状态来自不同事件 UUID 而拆成无限节点。查询缓存至少按 `(thetaVersion, encoderVersion, stateDigest, cue, requestedFields, horizon)` 失效；当前两个 WeakMap 若继续仅按 Observation 取值会错误复用别的 z。

## 相邻帧训练与动作结束时间

新增时序语义命名空间，如 `transition-v1/<anonymous-motor-signal>/<subject>`，复用现有读出/上下文实现。持续动作的 requestedTicks 不再被当作整个稳定窗口的唯一动力学类别；每行条件含实际 on/off、当前已持续的物理时间、dt 和前一状态。动作方向等公开控制信号可作为条件，不包含它应产生什么后果。

一个原始事件 E 的帧 `f0…fn` 产生 n 个区间拟合行。每行的目标仍是实际自运动补偿后的感觉变化，观察不到的对象通道保持 masked。按下期间、释放后的惯性/稳定期，以及后续普通被动期使用实际 motor 条件；不能把释放后的位移全记成仍在按键。单次 impulse 只在实测边沿所在区间出现，不把整个观察等待期都标成持续 look/interact。

所有行使用 E 开始前的读出计算误差；`ContextualReadout.observeWindow(..., E.id, rows)` 的独立来源保持 E.id，最大误差按窗口汇总。内部标签 `E.id/interval/i` 仅定位行，不是新独立样本。真实被动片段若只是同一父采集窗口的重新分装，仍保留原父 ID，分窗不得制造支持。θ 写入仍按原窗口计数，另报 fittedIntervals。

teacher-forced 的相邻帧误差只说明已知真实前态时的一步预测。它不认证从 f0 出发的多步预演。必须另保存**动作发出前**生成的整条时间轴预测，按同一窗口评价最坏残差/区间覆盖；rollout 证书使用 E.id，与一步证书分开语义，不能相乘或直接借用它的独立计数。

保持当前 body 返回语义和动作预算，首片不能偷偷改成“释放就结束”。为兼容 `ExperiencePrediction.observation` 表示动作返回后状态，增加如下输出，而不是塞入事后才知道的实际时长：

```ts
type TimedPredictionV1 = {
  frameHorizons: readonly { physicsTicksAhead: number;
    prediction: ExperiencePrediction; branch: PredictionBranchV1 }[];
  returnHorizon: { range: NumericRange | null; supported: boolean };
  endEnvelope: ExperiencePrediction; // 在可能返回时刻上的保守合并
};
```

返回时长读出是同一 θ 中一个普通目标 `return/physicalTicks`：输入只有窗口开始可知的感觉、z、请求动作和装置协议；标签是实测 motor/窗口时钟差。绝不能把实际释放/实际稳定长度当成开始输入。它只预测装置何时回包，不决定或训练环境任务答案。

时间轴使用已知请求控制程序产生假设 motor 日程，并逐步读取同一介质；实际提前中断仍是待观察的竞争情形。返回时长域没有可信支持、某段需要未知持续信号、或预算内算不完时，完整动作末态支持不足。可以保留有来源的一步/短时预测与明确假设，不能借用旧窗口类别的证书补成确定终点。末态包络必须合并所有有支持的可能返回时刻；发生区间/类别冲突时保留未知，不能事后选最吻合的一帧。

实际 motor 回执和真实末帧到来后，只选择**此前已存的**对应时间轴位置进行审计；不允许使用新 θ 或真实中间帧重算，再称为执行前预测。目标完成仍由后续真实感觉确认。首片预算内如果只能认证释放时刻而不能认证返回时刻，应分别报告这两项，不把释放位置当作实际开始下一动作的位置。

这是首片不可拆掉的一部分：先把历史输入加进 first→last 而继续混合返回时间，可能获得更低拟合误差，却无法说明连续动力学正确。

## 遮挡、身份歧义与自运动

复用 `AttentivePerception8` 的 visible、anchorEpoch、ambiguity、motionEvidence 和 surface 约束；不从引擎对象表补位置。当前 `perceptualObjects` 只输出 visible tracks 的边界继续保持。

首片只保留少量最近实际注意过的假设（建议最多 32 项，每项最多两个对应候选及 unresolvedMass；这是容量候选，不是物理真值）。出现遮挡时记录最后实测外观、几何区间、经过的物理时间与来源。当前自身位姿变化可将旧几何重新表达到当前身体坐标，这属于坐标变换；不能由此认定对象没有独立运动。缺乏已学习运动/持久性证据的维度应扩大为 unknown，而非长期保持一个窄位置区间。

再次看见时按已测几何/外观约束比较候选。歧义不能选最高分后抹掉其余可能性；两个候选会导致不同后果时，查询分别传播，只有各可能分支共同支持且区间合并仍有效的字段才能保留支持。概率/weight 在首片仅表示归一化候选质量，不叫校准概率。

作为动作条件的历史项按当前实际注意的公开角色绑定，如“先前注视表面的外观/年龄/仍未重见”。输入不能带 remembered-17 或 percept-42 等身份数值。线索保持可以改变身体动作预测，即便线索现在不在 objects；但 remembered 项不能获得当前 targetId，也不能产生原生引擎未提供的可执行 offer。

只转相机时，先用实际自位姿补偿，再判断残余对象变化；当前代码已有这种几何变换与 motionEvidence，应复用并加逐帧检验。看不见只监督“未获得测量”，不监督销毁、属性归零或瞬间运动。固定注视点外仍处理身体信号及低分辨率外围变化；学习贡献驱动的完整注意竞争留待后续，但不能仅处理最终 attentionId 而跳过其余真实帧。

## 想象、恢复和迁移

| 情况 | z | θ / 证据 |
|---|---|---|
| 普通只读预测 | 拷贝或持久化分支；与 live 状态不共享可写数组 | θ、ledger、校准、choices 摘要完全不变；分支对象无法传入真实输入 |
| `learn:false` 实机冻结 | 每真实帧照常推进；动作/遮挡/时间照常变化 | θ 不变，符合“知识冻结，身体继续经历” |
| 同进程连续窗口 | 按真实共享边界接续，不重复同化 | 每原窗口至多一次独立校准与一次 write |
| 同世界停止后重启 | 保留世界回忆，但所有当前可见性、percept 对应和 motor-on 均失效；开启新 epoch；快速 h 默认清零，慢历史降为未锚定假设 | θ 保留；首个真实帧重新锚定。未观测的停止时间不凭墙钟补成轨迹 |
| 另世界 transfer | 清除绝对位置、对象/任务所有权、历史 h、当前 motor 与对应关系；从首帧新建 z | 只保留参数与带版本的真实经验；world ID 不进入模型 |

“同世界保存再恢复”等于实际世界停止状态被验证，但不等于跨进程物理时间连续。若将来要精确保留快速状态，须有额外已验证的传感器时钟/世界暂停边界契约；首片不能假设它存在。保存 `liveState`、其 epoch/最后帧摘要、编码版本与连续性状态；legacy snapshot 没有 z 就初始化 unanchored，不能从任务历史反推。

新 receptor/时间语义与旧参数不可直接互换。建议 `KairosExperienceMediumV12`、`ExperienceSession2`，明确保存 encoder/dynamics law 身份。旧 V9–V11 的参数、样本和误差原样保留在原语义中，作为可加载基线；新时序 circuit 不继承旧证书。可以从带完整真实时钟的旧原始窗口离线重编码重新拟合，但这只是 replay，独立采集计数不增长；缺失时钟的旧窗口只读或保留为旧语义。迁移不能静默改变权重解释，不能把旧 actor 成功归给新模型。

## 真正有区分力的反例与消融

每个反例先记录当前 actor 的失败；固定数据、种子、资源预算及支持门槛。下面是可实现的软件门禁/装置协议，不是已经取得的能力证据。

| 反例 | 必须观察的差别 | 排除的假通过 |
|---|---|---|
| 相同末帧、不同过去线索 | 由真实感知序列构建不同 z；相同 θ、当前画面、动作下，预测不同实测后果；擦除 h 后下降 | 不给“历史 A/B”标签、任务名或不同 cue；只用记录中原有的线索 |
| 线索先出现后遮挡 | 学习实际 cue→后果后，隐藏 cue 时仍条件预测；无历史则未知；旋转、换公开 track ID 不改变关系 | objects/targetId 无幽灵可见物；原生后果由后来真实帧确认 |
| 纯自转、静态表面 | 逐帧自运动补偿后不学到表面横移/毁灭；去掉补偿显著恶化 | 不利用服务器材质/对象真值训练；真值只供独立审计 |
| 两个相似对象交换/遮挡 | 两个对应假设仍在；有冲突的对象效果为未知或包络；重见后才消歧 | 不能选择有利的身份匹配让误差变小 |
| 同 4-tick 按键、不同释放后等待 | on 区间学到一致局部响应；off 行解释后续变化；冻结预演按时间轴评分 | 最后才知道的 n 不进入开始特征；禁止用实际中帧重算“先验” |
| 同原轨迹不同打包/交付延迟 | 无塑性时逐帧 z 一致；同父窗口重分包后的 θ/校准计数一致；CPU catch-up 的实际 tick 仍一致 | 把一个事件拆成多个独立样本；丢帧重采样不可称等价 |
| 第 33 位以后才出现的关键通道 | 新编码不随发现次序永久失去通道；改变无关公开 ID 不改输出 | 只扩大 INPUTS 或把关键通道预排到最前面 |
| 冻结/私有分支/恢复 | frozen θ 摘要不变而 z 有实测变化；一千次只读分支不改任何 live/学习计数；迁移无旧世界位置条件 | 查询顺手推进 live h；恢复后复用旧 percept 身份 |
| 128 次高负载/故意队列缺口 | 无重叠窗口、无错误 dt/motor；完整报告滞后、字节峰值和 gap 拒绝 | 丢失背景输入后依靠最新画面继续声称连续 |

至少配对运行四个条件：完整状态、每次动作前清零 h/历史、仅保留末帧不处理中间真实帧、擦除/打乱实际 motor 时间。消融只能改指定机制，保持 θ 起点、选择状态、世界和预算相同。线索出现而后续后果不同的任务，应由独立真实试验验证 cue 确实反映机制；若 Minecraft 当前开发场景不具备这种可观察线索，就不能仅靠人造表格门禁宣布原生遮挡记忆成立。

不同传感采样率会损失不同信息；只要求共同可观察低频后果在预登记容差内相容，不能要求漏掉短暂线索后的模型仍凭空恢复。门禁需区分“同一原帧仅改变分包”和“真实减少采样”，前者可要求精确一致，后者必须报告信息损失。

## 最小实施顺序与明确延后

先实现带时钟和 motor 边沿的逐帧交付、z/θ 分离、真实 trace 与 frozen 路径；随后在同一 medium 加时序 receptor/readout、窗口内分段拟合及独立校准；再把所有预测入口和搜索节点接入私有 z，补返回时间轴与未知/遮挡分支。四者连通并通过上述反例才构成 B 的首片，不能停在记录了一个从未参与预测的 state 对象。

本片不做 learned options、路线或子目标发现、巩固采样政策、长时记忆容量分配、需求调度更改、全量多对象贝叶斯跟踪或可塑递归核学习。也不把新受体投影本身叫作保持修复。先在和平短任务上重新获得可信且有用的预测/动作覆盖，再开展 C 的同世界冻结/擦除/继续学习及 A→B→A；完整有前提的多阶段与 1/8/24 小时协议仍需后续独立验收。

具体首片风险是每帧 readout 与分支时间轴增加计算，可能再次降低开始帧可用率。必须同时报告真实帧消费滞后、fresh callback 耗时、单查询工作量、RSS/字节上限、执行分母和任务结果。在原预算下不满足时应改实现或缩小本片可认证的预测范围，不能加大原生动作/搜索预算，也不能把所有预测都拒绝后宣布完成。
