/** Execute presentation controls against their real embedded data; no game. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Script, createContext } from 'node:vm';
import assert from 'node:assert/strict';
const [directory] = process.argv.slice(2);
if (!directory) throw new Error('recorded-demo-directory-required');
const html = await readFile(resolve(directory, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(script); assert(!script.includes('fetch(')); assert(!script.includes('WebSocket'));
const elements = new Map(); let canvasCalls = 0;
const drawing = new Proxy({}, { get: (_target, method) => (...args) => {
  canvasCalls++; for (const arg of args) if (typeof arg === 'number') assert(Number.isFinite(arg), `invalid ${String(method)} coordinate`);
} });
for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], {
  value: 0, textContent: '', append: () => {}, getContext: () => drawing,
});
const context = createContext({ document: { getElementById: id => {
  assert(elements.has(id), `missing element: ${id}`); return elements.get(id);
}, createElement: () => ({}) } });
new Script(script).runInContext(context);
assert(elements.get('proof').textContent.includes('24'));
const cases = new Script('data.cases.map(c=>c.steps.map(s=>s.frames.length))').runInContext(context);
let frameChecks = 0, actionChecks = 0;
for (let c = 0; c < cases.length; c++) {
  elements.get('case').onchange({ target: { value: c } });
  for (let step = 0; step < cases[c].length; step++) {
    if (step) elements.get('next').onclick();
    for (let frame = 0; frame < cases[c][step]; frame++) {
      elements.get('timeline').oninput({ target: { value: frame } }); frameChecks++;
    }
    assert(elements.get('receipt').textContent.includes('startSequence')); actionChecks++;
  }
}
assert.equal(actionChecks, 10);
console.log(JSON.stringify({ presentationControlsPassed: true, actionChecks, frameChecks,
  canvasCalls, gameCalls: 0, physicalWrites: 0, visualPixelInspection: false }));
