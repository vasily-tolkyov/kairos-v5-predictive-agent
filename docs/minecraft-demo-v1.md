# Minecraft 演示入口

原型不内置任务顺序。运行时只接受一个用户提供的 `GroundedGoalV1` JSON，随后由联合控制场从当前公开观察、R1/R2/R2A 证据和真实动作供给中选择操作。

目标文件的最小结构如下（对象 ID 必须来自当前公开帧，不能猜测）：

```json
{
  "version": "GroundedGoalV1",
  "id": "demo-goal",
  "expression": {
    "kind": "predicate",
    "predicate": {
      "id": "door-open",
      "subject": { "kind": "public-object", "id": "<visible-door-id>", "expectedType": "iron_door" },
      "observable": "properties.open",
      "comparator": "equals",
      "target": true
    }
  }
}
```

使用已保存的、版本匹配的经验指针启动演示：

```powershell
npm run build
npm start -- --fixture legacy-door --experience-pointer D:\path\to\EXPERIENCE_LATEST.json --goal-file D:\path\to\goal.json
```

如果没有经验指针，先运行 `npm start -- --bootstrap-only`，让系统只在隔离世界中采集真实经验。没有达到初始化门时不会执行目标。运行时会在 `http://127.0.0.1:3000/` 提供第一视角、在 `http://127.0.0.1:3002/` 提供只读物理/控制面板。

目标文件只是公开谓词输入；它不包含动作顺序、路径、子目标或因果规则。Viewer 和词典也没有动作权，只有真实身体事件才能写入经验。
