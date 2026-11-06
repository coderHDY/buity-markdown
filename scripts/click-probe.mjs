import fs from 'node:fs';

const PORT = Number(process.env.PORT || 9339);
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('vscode-webview'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

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
const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return out.result?.result?.value;
};

await send('Runtime.enable');

const before = await evaluate(`document.querySelectorAll('iframe.webview').length`);

const rect = await evaluate(`(() => {
  const items = Array.from(document.querySelectorAll('.editor-actions .actions-container > .action-item'));
  const ours = items.find((i) => /Open Preview to the Side \\(⌘K B\\)/.test(i.querySelector('a')?.getAttribute('aria-label') || ''));
  if (!ours) return null;
  const r = ours.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
})()`);
console.log('our button rect:', JSON.stringify(rect));

if (rect) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      button: 'left',
      clickCount: 1,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    });
  }
}
await new Promise((r) => setTimeout(r, 2500));

const after = await evaluate(`(() => ({
  iframes: document.querySelectorAll('iframe.webview').length,
  tabs: Array.from(document.querySelectorAll('.tabs-container .tab')).map((t) => (t.textContent || '').trim()).filter(Boolean),
}))()`);

console.log('iframes before:', before, 'after:', after.iframes);
console.log('tabs:', JSON.stringify(after.tabs));
ws.close();
