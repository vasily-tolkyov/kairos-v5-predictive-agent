import { createServer, type Server } from 'node:http';
import type { V5Runtime } from './runtime.js';
import type { MediaPageRequestV1, MediaPageResultV1 } from './compute.js';

const MEDIA_PAGE_LIMIT_DEFAULT = 2400;
const MEDIA_PAGE_LIMIT_MAX = 4096;
const PAGE_CACHE_CAP = 128;

const HTML = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Kairos V5 · 物理控制场</title>
<style>body{background:#101923;color:#d9e6ee;font:14px system-ui;margin:20px}h1{font-weight:500}a{color:#70cbd2}.views{display:flex;gap:12px}canvas{background:#182737;width:31%;height:240px}pre{white-space:pre-wrap;max-height:500px;overflow:auto}small{color:#abc}</style>
<h1>Kairos V5 · 预测核心与联合控制场</h1><a href="http://127.0.0.1:3000/" target="_blank">机器人第一视角</a>
<p><small>窗口没有动作或学习写入权限。三种介质坐标彼此独立，也不是Minecraft坐标；联合场与依赖图是快速衰减的当前计算。非语义习惯权重是窄小的操作连接记忆，不保存对象、动作种类或结果标签。介质画面是最近检查点的有界采样（默认只取每介质前2400个位点），统计量覆盖完整介质。</small></p>
<div class="views"><canvas id="r1"></canvas><canvas id="r2"></canvas><canvas id="r2a"></canvas></div><pre id="media"></pre><pre id="state"></pre>
<script>
function draw(id,page){let c=document.getElementById(id);c.width=500;c.height=240;let x=c.getContext('2d');x.clearRect(0,0,500,240);x.fillStyle='#acd8e0';x.fillText(id.toUpperCase()+(page?' rev='+page.revision+' sites='+page.totalSites:''),15,20);if(!page||!page.sites)return;let k=page.sites.filter(p=>p.potentialDepth>1e-7||Math.abs(p.activation)>1e-7);let scale=1;for(let p of k)scale=Math.max(scale,...p.coordinate.map(Math.abs));for(let p of k){let alpha=Math.min(.9,.08+p.potentialDepth/8+Math.abs(p.activation)/8);x.fillStyle='rgba(88,210,203,'+alpha+')';let a=p.coordinate;x.beginPath();x.arc(250+(a[0]+a[2]*.35)/scale*190,125-(a[1]-a[2]*.25)/scale*90,1.8,0,7);x.fill()}}
let drawnRevision=null;
async function update(){try{
let d=await(await fetch('/state')).json();
document.getElementById('state').textContent=JSON.stringify(d.runtime,null,2);
document.getElementById('media').textContent=d.media?JSON.stringify(d.media,null,2):'medium statistics arrive with the first checkpoint';
if(d.media&&d.media.revision!==drawnRevision){
for(const id of ['r1','r2','r2a']){
try{let response=await fetch('/state?media='+id+'&revision='+encodeURIComponent(d.media.revision)+'&limit=${MEDIA_PAGE_LIMIT_DEFAULT}&offset=0');
if(response.ok)draw(id,await response.json())}catch(e){}}
drawnRevision=d.media.revision}
}catch(e){document.getElementById('state').textContent=String(e)}}
setInterval(update,2000);update();
</script></html>`;

/** A defensive, read-only dashboard projection. Exported so viewer non-mutation is directly testable. */
export function dashboardPayload(runtime: V5Runtime): unknown {
  const snapshot = runtime.snapshotForDisplay;
  const media = snapshot ? { r1: snapshot.r1Medium, r2: snapshot.r2Medium, r2a: snapshot.r2a.medium } : null;
  return structuredClone({ runtime: runtime.display(), controlFields: runtime.controlFieldForDisplay,
    controlHabits: runtime.habitCheckpointForDisplay,
    media });
}

/**
 * Bounded /state payload (PLAN-005 1.1): runtime counters, the live control
 * field, a habit summary, and per-medium statistics of the last checkpoint.
 * It never clones or serializes full media; full media is only reachable
 * through the explicit paginated `?media=` route below.
 */
export function dashboardSummary(runtime: V5Runtime): unknown {
  return { runtime: runtime.displaySummary(), controlFields: runtime.controlFieldForDisplay,
    controlHabits: runtime.habitCheckpointForDisplay,
    media: runtime.mediaStatisticsForDisplay };
}

function parsePageRequest(url: URL): MediaPageRequestV1 | null {
  const medium = url.searchParams.get('media');
  if (medium !== 'r1' && medium !== 'r2' && medium !== 'r2a') return null;
  const integer = (name: string, fallback: number): number | null => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const offset = integer('offset', 0), requestedLimit = integer('limit', MEDIA_PAGE_LIMIT_DEFAULT);
  if (offset === null || requestedLimit === null || requestedLimit < 1) return null;
  return { medium, offset, limit: Math.min(requestedLimit, MEDIA_PAGE_LIMIT_MAX) };
}

export async function startDashboard(runtime: V5Runtime, port: number): Promise<Server> {
  // Pre-serialized media pages keyed by revision+window: an identical revision
  // is served from the buffer without touching the worker again.
  const pageCache = new Map<string, string>();
  const serveMediaPage = async (url: URL): Promise<{ status: number; body: string }> => {
    const request = parsePageRequest(url);
    if (request === null) return { status: 400, body: JSON.stringify({ error: 'invalid-media-page-request' }) };
    const requestedRevision = url.searchParams.get('revision');
    const key = `${requestedRevision ?? 'unpinned'}:${request.medium}:${request.offset}:${request.limit}`;
    const cached = requestedRevision === null ? undefined : pageCache.get(key);
    if (cached !== undefined) return { status: 200, body: cached };
    const page: MediaPageResultV1 = await runtime.mediaPageForDisplay(request);
    if (requestedRevision !== null && page.revision !== requestedRevision)
      return { status: 409, body: JSON.stringify({ error: 'revision-mismatch', currentRevision: page.revision }) };
    const body = JSON.stringify(page);
    if (requestedRevision !== null) {
      if (pageCache.size >= PAGE_CACHE_CAP) pageCache.clear();
      pageCache.set(key, body);
    }
    return { status: 200, body };
  };
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/state') {
      response.setHeader('content-type', 'application/json');
      if (!url.searchParams.has('media')) { response.end(JSON.stringify(dashboardSummary(runtime))); return; }
      serveMediaPage(url).then(({ status, body }) => { response.statusCode = status; response.end(body); },
        (error: unknown) => { response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); });
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(HTML);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server;
}
