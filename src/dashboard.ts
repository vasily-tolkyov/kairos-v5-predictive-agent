import { createServer, type Server } from 'node:http';
import type { V5Runtime } from './runtime.js';

const HTML = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Kairos V5 · 物理控制场</title>
<style>body{background:#101923;color:#d9e6ee;font:14px system-ui;margin:20px}h1{font-weight:500}a{color:#70cbd2}.views{display:flex;gap:12px}canvas{background:#182737;width:31%;height:240px}pre{white-space:pre-wrap;max-height:500px;overflow:auto}small{color:#abc}</style>
<h1>Kairos V5 · 预测核心与联合控制场</h1><a href="http://127.0.0.1:3000/" target="_blank">机器人第一视角</a>
<p><small>窗口没有动作或学习写入权限。三种介质坐标彼此独立，也不是Minecraft坐标；联合场与依赖图是快速衰减的当前计算。非语义习惯权重是窄小的操作连接记忆，不保存对象、动作种类或结果标签。</small></p>
<div class="views"><canvas id="r1"></canvas><canvas id="r2"></canvas><canvas id="r2a"></canvas></div><pre id="state"></pre>
<script>function draw(id,medium){let c=document.getElementById(id);c.width=500;c.height=240;let x=c.getContext('2d');x.clearRect(0,0,500,240);x.fillStyle='#acd8e0';x.fillText(id.toUpperCase(),15,20);if(!medium)return;let k=medium.sites.filter(p=>p.potentialDepth>1e-7||Math.abs(p.activation)>1e-7);let scale=1;for(let p of k)scale=Math.max(scale,...p.coordinate.map(Math.abs));for(let p of k){let alpha=Math.min(.9,.08+p.potentialDepth/8+Math.abs(p.activation)/8);x.fillStyle='rgba(88,210,203,'+alpha+')';let a=p.coordinate;x.beginPath();x.arc(250+(a[0]+a[2]*.35)/scale*190,125-(a[1]-a[2]*.25)/scale*90,1.8,0,7);x.fill()}}
async function update(){try{let d=await(await fetch('/state')).json();document.getElementById('state').textContent=JSON.stringify(d.runtime,null,2);draw('r1',d.media?.r1);draw('r2',d.media?.r2);draw('r2a',d.media?.r2a)}catch(e){document.getElementById('state').textContent=String(e)}}setInterval(update,2000);update();</script></html>`;

/** A defensive, read-only dashboard projection. Exported so viewer non-mutation is directly testable. */
export function dashboardPayload(runtime: V5Runtime): unknown {
  const snapshot = runtime.snapshotForDisplay;
  const media = snapshot ? (() => {
    const value = snapshot as unknown as Record<string, any>;
    return value.r1Medium ? { r1: value.r1Medium, r2: value.r2Medium, r2a: value.r2a?.medium }
      : { r1: value.r1Store?.medium, r2: value.r2Store?.medium, r2a: value.r2a?.r2aMedium };
  })() : null;
  return structuredClone({ runtime: runtime.display(), controlFields: runtime.controlFieldForDisplay,
    controlHabits: runtime.habitCheckpointForDisplay,
    media });
}
export async function startDashboard(runtime: V5Runtime, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/state') {
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(dashboardPayload(runtime))); return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(HTML);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server;
}
