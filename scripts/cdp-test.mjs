/* Real-browser end-to-end test for live editing.
 *
 * Drives headless Chrome over CDP: clicks into a block, types, presses Enter,
 * edits a table cell and drops an image — then verifies the messages the
 * webview sends to the extension host.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const URL_BASE = process.env.MOCK_URL || 'http://127.0.0.1:8940/index.html?theme=midnight&edit=1';

let failures = 0;
function check(ok, label, detail) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log('     ', typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + expression);
    return result.result.value;
  }
  async type(text) {
    await this.send('Input.insertText', { text });
  }
  async key(key, code, keyCode, modifiers = 0) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key === 'Enter' ? '\r' : undefined });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async click(selector) {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  }
  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'bm-cdp-'))}`,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    let target;
    for (let attempt = 0; attempt < 80 && !target; attempt++) {
      await sleep(150);
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
        target = list.find((entry) => entry.type === 'page');
      } catch {
        /* not up yet */
      }
    }
    if (!target) throw new Error('Chrome did not expose a debugging target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const nav = await cdp.send('Page.navigate', { url: URL_BASE });
    if (nav.errorText) throw new Error(`page did not load: ${nav.errorText}`);
    await sleep(2600);

    const ready = await cdp.eval(`document.querySelectorAll('[contenteditable="true"]').length`);
    check(ready > 10, `preview rendered ${ready} editable blocks`);
    check(await cdp.eval(`document.getElementById('article').classList.contains('bm-editing')`), 'live edit mode is on');

    /* --------------------------------------------------- typing a paragraph */
    const paragraph = await cdp.eval(`(() => {
      const p = document.querySelector('#article p[contenteditable="true"]');
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      p.focus();
      window.__sample = p.textContent.slice(0, 20);
      return { start: p.getAttribute('data-line-start'), end: p.getAttribute('data-line-end'), sample: window.__sample };
    })()`);

    await cdp.type('Zz ');
    await sleep(750);

    const edits = await cdp.eval(`window.__edits`);
    check(edits.length === 1, `one applyEdit after typing (${edits.length})`, edits);
    check(edits[0]?.text?.startsWith('Zz '), 'typed text reached the host', edits[0]?.text?.slice(0, 40));
    check(Number(edits[0]?.start) === Number(paragraph.start), 'edit is anchored to the right source line', edits[0]);

    /* ------------------------------------------------------------- Enter key */
    // Put the caret at the end of the paragraph, where people actually press Enter.
    await cdp.eval(`(() => {
      const p = document.activeElement;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    await cdp.key('Enter', 'Enter', 13);
    await sleep(400);
    await cdp.type('Second paragraph.');
    await sleep(750);

    const afterSplit = await cdp.eval(`window.__edits`);
    const splitEdit = afterSplit.find((edit) => edit.source === 'live-edit-split');
    check(Boolean(splitEdit), 'Enter produced a paragraph split', afterSplit);
    check(/\n\n/.test(splitEdit?.text || ''), 'split edit inserts a blank line', splitEdit);
    check(Number(splitEdit?.start) === Number(paragraph.start), 'split is anchored to the original paragraph');

    const lastEdit = afterSplit.at(-1);
    check(lastEdit?.text === 'Second paragraph.', 'text typed after Enter becomes its own block', lastEdit);
    check(Number(lastEdit?.start) === Number(paragraph.start) + 2, 'the new paragraph gets the next source line', lastEdit);
    const domParagraphs = await cdp.eval(
      `Array.from(document.querySelectorAll('#article > p')).map((p) => p.textContent.trim()).filter((t) => t.includes('Second paragraph'))`,
    );
    check(domParagraphs.length === 1, 'the new paragraph is visible in the preview', domParagraphs);

    await cdp.shot('/tmp/live-edit-typed.png');

    /* ---------------------------------------------------------- table cells */
    const tableEdit = await cdp.eval(`(async () => {
      const cell = document.querySelector('#article .bm-table-wrap td[contenteditable="true"]');
      if (!cell) return null;
      const before = window.__edits.length;
      cell.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { before, start: cell.closest('.bm-table-wrap').getAttribute('data-line-start') };
    })()`);
    if (tableEdit) {
      await cdp.type('renamed');
      await sleep(750);
      const last = (await cdp.eval(`window.__edits`)).at(-1);
      check(/renamed/.test(last?.text || ''), 'table cell edit reaches the host', last?.text);
      check(/^\|/m.test(last?.text || ''), 'table is serialised back to a markdown table', last?.text);
      check(Number(last?.start) === Number(tableEdit.start), 'table edit targets the whole table block');
    } else {
      check(false, 'a table with editable cells exists');
    }

    /* ------------------------------------------------------------- code block */
    const codeEdit = await cdp.eval(`(async () => {
      const pre = document.querySelector('#article .bm-code pre[contenteditable="true"]');
      if (!pre) return null;
      pre.focus();
      return { flattened: pre.classList.contains('is-plain'), text: (pre.textContent || '').slice(0, 30) };
    })()`);
    if (codeEdit) {
      check(codeEdit.flattened, 'code block switches to plain text while editing', codeEdit);
      check(!/hljs-token|span/.test(codeEdit.text), 'no highlight markup while typing');
    } else {
      check(false, 'a code block is editable');
    }

    /* ------------------------------------------------------- blur commits */
    await cdp.eval(`document.activeElement.blur()`);
    await sleep(400);
    const count = (await cdp.eval(`window.__edits`)).length;
    await cdp.eval(`document.activeElement.blur()`);
    await sleep(300);
    check((await cdp.eval(`window.__edits`)).length === count, 'blurring twice does not duplicate edits');

    /* ------------------------------------------------------ drag & drop image */
    const imageResult = await cdp.eval(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e2935f'; ctx.fillRect(0, 0, 8, 8);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'pasted shot.png', { type: 'image/png' });
      const article = document.getElementById('article');
      const target = article.querySelector('p[contenteditable="true"]');
      target.focus();
      const rect = target.getBoundingClientRect();
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 10, clientY: rect.top + 5 });
      article.dispatchEvent(over);
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 10, clientY: rect.top + 5 });
      article.dispatchEvent(drop);
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { images: window.__images, dropping: article.classList.contains('is-dropping') };
    })()`);

    check(imageResult.images.length === 1, 'dropped image was sent to the host', imageResult.images);
    check(imageResult.images[0]?.name === 'pasted shot.png', 'original file name preserved');
    check(imageResult.images[0]?.size > 20, 'image payload is non-trivial');
    check(!imageResult.dropping, 'drop overlay is cleaned up');

    check((await cdp.eval(`window.__errors || []`)).length === 0, 'no runtime errors in the webview');

    await cdp.shot('/tmp/live-edit-final.png');
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }

  console.log(failures ? `\n${failures} browser check(s) failed` : '\nall browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('browser test failed:', error);
  process.exit(1);
});
