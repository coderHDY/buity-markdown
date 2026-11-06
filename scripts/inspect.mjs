import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 9339);
const EXPR = process.argv[2] || '1';

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page = list.find(
  (t) => t.type === 'page' && !t.url.startsWith('vscode-webview') && t.url !== 'about:blank' && t.title !== 'about:blank',
);
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Runtime.enable');
const out = await send('Runtime.evaluate', {
  expression: EXPR,
  returnByValue: true,
  awaitPromise: true,
});
console.log(JSON.stringify(out.result?.result?.value ?? out, null, 2));
ws.close();
