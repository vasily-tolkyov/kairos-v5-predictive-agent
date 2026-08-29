import { createServer, type Server } from 'node:http';
import type { V5Runtime } from './runtime.js';

const HTML = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Kairos V5 · 只读观察</title>
<style>body{background:#101923;color:#d9e6ee;font:14px system-ui;margin:20px}h1{font-weight:500}a{color:#70cbd2}.views{display:flex;gap:12px}canvas{background:#182737;width:31%;height:240px}pre{white-space:pre-wrap;max-height:500px;overflow:auto}small{color:#abc}</style>
<h1>Kairos V5 · 只读观察</h1><a href="http://127.0.0.1:3000/" target="_blank">机器人第一视角</a>
<p><small>窗口没有动作、学习或模型写入权限。下面是三维介质的只读斜投影；不是Minecraft坐标。</small></p>
<div class="views"><canvas id="r1"></canvas><canvas id="r2"></canvas><canvas id="r2a"></canvas></div><pre id="state"></pre>
<script>function draw(id,medium){let c=document.getElementById(id);c.width=500;c.height=240;let x=c.getContext('2d');x.clearRect(0,0,500,240);x.fillStyle='#acd8e0';x.fillText(id.toUpperCase(),15,20);if(!medium)return;let k=medium.pages.flatMap(p=>p.kernels);let scale=1;for(let p of k)scale=Math.max(scale,...p.center.map(Math.abs));for(let p of k){x.fillStyle='rgba(88,210,203,'+Math.min(.8,Math.abs(p.coefficient)/16)+')';let a=p.center;x.beginPath();x.arc(250+(a[0]+a[2]*.35)/scale*190,125-(a[1]-a[2]*.25)/scale*90,2,0,7);x.fill()}}
async function update(){try{let d=await(await fetch('/state')).json();document.getElementById('state').textContent=JSON.stringify(d.runtime,null,2);draw('r1',d.media?.r1);draw('r2',d.media?.r2);draw('r2a',d.media?.r2a)}catch(e){document.getElementById('state').textContent=String(e)}}setInterval(update,2000);update();</script></html>`;
export async function startDashboard(runtime: V5Runtime, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/state') {
      const snapshot = runtime.snapshotForDisplay;
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ runtime: runtime.display(),
        media: snapshot ? { r1: snapshot.store.r1, r2: snapshot.store.r2, r2a: snapshot.r2a?.r2aMedium } : null })); return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(HTML);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server;
}
