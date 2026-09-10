/** A loopback-only evidence reader. No body, worker, model or mutation route. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [directory, portText = '3014'] = process.argv.slice(2), port = Number(portText);
if (!directory || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('demo-directory-and-local-port-required');
const html = await readFile(resolve(directory, 'index.html'));
const sources = await readFile(resolve(directory, 'DEMO_SOURCES.json'));
const server = createServer((request, response) => {
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  if (request.url === '/') response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  else if (request.url === '/sources') response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(sources);
  else response.writeHead(404).end();
});
await new Promise((done, reject) => {
  server.once('error', reject); server.listen(port, '127.0.0.1', done);
});
console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/`, readOnly: true,
  replayNotLiveGame: true, source: resolve(directory) }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
