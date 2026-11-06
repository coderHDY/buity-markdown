/**
 * Live editing mode — the preview itself becomes the editor.
 *
 * Every top-level block is contenteditable. Edits are debounced, serialised back
 * to Markdown (see `serialize.ts`) and applied to the document, so the file on
 * disk stays canonical while the preview feels like a WYSIWYG surface.
 */
import { serializeBlock } from './serialize';

type Post = (message: any) => void;

const TEXT_BLOCKS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'BLOCKQUOTE']);

export interface LiveEditorOptions {
  article: HTMLElement;
  post: Post;
  /** Called when a deferred render can finally be applied. */
  onFlush?: () => void;
}

export class LiveEditor {
  enabled = false;

  private readonly article: HTMLElement;
  private readonly post: Post;
  private readonly onFlush?: () => void;
  private timer: number | undefined;
  private current: HTMLElement | null = null;
  private lastSent = new Map<number, string>();
  private pendingFocus: { line: number; offset: number; text?: string } | null = null;
  private deferred: any = null;
  private flattened = new WeakSet<Element>();

  constructor(options: LiveEditorOptions) {
    this.article = options.article;
    this.post = options.post;
    this.onFlush = options.onFlush;

    this.article.addEventListener('focusin', (event) => this.onFocusIn(event));
    this.article.addEventListener('focusout', (event) => this.onFocusOut(event));
    this.article.addEventListener('input', () => this.schedule());
    this.article.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.article.addEventListener('paste', (event) => this.onPaste(event));
  }

  /* ------------------------------------------------------------ plumbing */

  private blockOf(node: EventTarget | null): HTMLElement | null {
    if (!(node instanceof Element)) return null;
    const block = node.closest<HTMLElement>('[data-line-start]');
    if (!block) return null;
    // climb to the outermost block that starts a source range
    let outer = block;
    let parent = block.parentElement?.closest<HTMLElement>('[data-line-start]');
    while (parent) {
      outer = parent;
      parent = parent.parentElement?.closest<HTMLElement>('[data-line-start]');
    }
    return outer;
  }

  isActive(): boolean {
    return this.enabled && this.current !== null;
  }

  setEnabled(value: boolean) {
    this.enabled = value;
    this.article.classList.toggle('bm-editing', value);
    this.refresh();
    if (!value) this.flush();
  }

  /** Re-attach contenteditable after the article HTML was replaced. */
  refresh() {
    for (const el of Array.from(this.article.children)) {
      if (!(el instanceof HTMLElement)) continue;
      if (!el.hasAttribute('data-line-start')) continue;
      this.makeEditable(el, this.enabled);
    }
    if (this.pendingFocus) {
      const request = this.pendingFocus;
      this.pendingFocus = null;
      if (request.text) this.focusText(request.text);
      else this.focusLine(request.line, request.offset);
    }
  }

  /** Focus the block whose text starts with `text` (used after an Enter split). */
  private focusText(text: string) {
    const needle = text.slice(0, 40);
    const candidates = Array.from(
      this.article.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6'),
    ).filter((el) => (el.textContent || '').trim().startsWith(needle));
    const target = candidates[candidates.length - 1];
    if (!target) return;
    target.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    this.scrollIntoView(target);
  }

  private makeEditable(block: HTMLElement, editable: boolean) {
    const value = editable ? 'true' : 'false';
    const set = (el: Element | null) => {
      if (!el) return;
      if (editable) el.setAttribute('contenteditable', value);
      else el.removeAttribute('contenteditable');
    };

    if (block.classList.contains('bm-table-wrap')) {
      for (const cell of Array.from(block.querySelectorAll('th, td'))) set(cell);
      return;
    }
    if (block.classList.contains('bm-code') || block.classList.contains('bm-diagram')) {
      const pre = block.querySelector('pre');
      if (pre) {
        set(pre);
        if (!editable) pre.removeAttribute('spellcheck');
        else pre.setAttribute('spellcheck', 'false');
      }
      return;
    }
    if (block.classList.contains('bm-math-block')) {
      set(block);
      if (editable) block.setAttribute('spellcheck', 'false');
      return;
    }
    if (block.classList.contains('bm-callout')) {
      for (const child of Array.from(block.children)) {
        if (child.classList.contains('bm-callout-title')) continue;
        if (TEXT_BLOCKS.has(child.tagName)) set(child);
        else {
          for (const inner of Array.from(child.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6'))) set(inner);
        }
      }
      return;
    }
    if (block.tagName === 'HR') return;
    if (TEXT_BLOCKS.has(block.tagName) || block.tagName === 'DIV' || block.tagName === 'FIGURE') {
      set(block);
    }
  }

  /* ---------------------------------------------------------------- focus */

  private onFocusIn(event: FocusEvent) {
    if (!this.enabled) return;
    const block = this.blockOf(event.target);
    if (!block) return;
    this.current = block;
    block.classList.add('is-editing');

    const target = event.target as HTMLElement;
    if (target.tagName === 'PRE' && (block.classList.contains('bm-code') || block.classList.contains('bm-diagram'))) {
      this.flattenPre(target, block);
    } else if (block.classList.contains('bm-math-block')) {
      this.flattenMath(block);
    }
  }

  private onFocusOut(event: FocusEvent) {
    if (!this.enabled) return;
    const next = event.relatedTarget as Node | null;
    if (next && this.article.contains(next)) return;
    this.flush();
    this.current?.classList.remove('is-editing');
    this.current = null;
    if (this.hasDeferred()) this.onFlush?.();
  }

  /** Replace highlighted code with plain text so typing is predictable. */
  private flattenPre(pre: HTMLElement, block: HTMLElement) {
    if (this.flattened.has(pre)) return;
    const source = block.classList.contains('bm-diagram')
      ? block.getAttribute('data-src') || pre.textContent || ''
      : pre.textContent || '';
    const raw = source.replace(/\n+$/, '');
    const area = pre.querySelector('code');
    const host = area || pre;
    host.textContent = raw;
    host.classList.remove('hljs');
    pre.classList.add('is-plain');
    this.flattened.add(pre);
    this.placeCaretEnd(host);
  }

  private flattenMath(block: HTMLElement) {
    if (this.flattened.has(block)) return;
    const tex = block.getAttribute('data-tex') || '';
    block.textContent = tex;
    block.classList.add('is-plain');
    this.flattened.add(block);
    this.placeCaretEnd(block);
  }

  private placeCaretEnd(el: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  focusLine(line: number, offset = 0) {
    const block = Array.from(this.article.querySelectorAll<HTMLElement>('[data-line-start]')).find(
      (el) => Number(el.getAttribute('data-line-start')) === line,
    );
    if (!block) return;
    const target =
      block.querySelector<HTMLElement>('p, li, th, td, h1, h2, h3, h4, h5, h6') ||
      (block.classList.contains('bm-code') || block.classList.contains('bm-diagram')
        ? block.querySelector('pre')
        : block);
    if (!target) return;
    target.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    let remaining = Math.max(0, offset);
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let placed = false;
    while (node) {
      const length = node.nodeValue?.length || 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= length;
      node = walker.nextNode();
    }
    if (!placed) {
      range.selectNodeContents(target);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    this.scrollIntoView(target);
  }

  private scrollIntoView(el: Element) {
    const main = this.article.closest('.bm-main');
    if (!main) return;
    const rect = el.getBoundingClientRect();
    const host = main.getBoundingClientRect();
    if (rect.top < host.top + 12 || rect.bottom > host.bottom - 80) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ----------------------------------------------------------- serialising */

  private schedule() {
    if (!this.enabled) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 480);
  }

  private blockTargets(block: HTMLElement): HTMLElement[] {
    return [block];
  }

  flush() {
    window.clearTimeout(this.timer);
    if (!this.enabled) return;
    const block = this.current;
    if (!block) return;
    for (const target of this.blockTargets(block)) {
      const edit = serializeBlock(target);
      if (!edit) continue;
      const previous = this.lastSent.get(edit.start);
      if (previous === edit.text) continue;
      this.lastSent.set(edit.start, edit.text);
      this.post({
        type: 'applyEdit',
        start: edit.start,
        end: edit.end,
        text: edit.text,
        source: 'live-edit',
      });
    }
  }

  /* -------------------------------------------------------------- keyboard */

  private onKeyDown(event: KeyboardEvent) {
    if (!this.enabled) return;
    const mod = event.metaKey || event.ctrlKey;

    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b') return this.wrapSelection(event, 'strong');
      if (key === 'i') return this.wrapSelection(event, 'em');
      if (key === 'e') return this.wrapSelection(event, 'code');
      if (key === 'k') return this.insertLink(event);
      if (key === 'x' && event.shiftKey) return this.wrapSelection(event, 'del');
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      const block = this.current;
      if (!block) return;
      if (block.classList.contains('bm-table-wrap')) {
        // keep cell content single-line; let Tab move between cells
        event.preventDefault();
        document.execCommand('insertLineBreak');
        return;
      }
      if (block.tagName === 'P' || /^H[1-6]$/.test(block.tagName)) {
        this.splitBlock(event, block);
        return;
      }
    }

    if (event.key === 'Tab' && this.current?.classList.contains('bm-table-wrap')) {
      event.preventDefault();
      this.moveCell(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === 'Escape') {
      (event.target as HTMLElement).blur();
    }
  }

  private splitBlock(event: KeyboardEvent, block: HTMLElement) {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    const startLine = Number(block.getAttribute('data-line-start'));
    const endLine = Number(block.getAttribute('data-line-end') || startLine);
    if (!Number.isFinite(startLine)) return;

    // Move everything after the caret into a fresh paragraph.
    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    tailRange.setEnd(block, block.childNodes.length);
    const fragment = tailRange.extractContents();

    const tailEl = document.createElement('p');
    tailEl.appendChild(fragment);
    block.parentElement?.insertBefore(tailEl, block.nextSibling);

    const clean = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    const headText = clean(block.textContent || '');
    const tailText = clean(tailEl.textContent || '');

    // Inside a callout / quote / list the outer block owns the source range,
    // so let the serialiser describe the whole thing instead of guessing lines.
    const nested = Boolean(block.parentElement?.closest('[data-line-start]'));
    if (nested) {
      this.lastSent.delete(startLine);
      this.flush();
      if (tailText) this.pendingFocus = { line: startLine + 2, offset: 0, text: tailText };
      return;
    }

    const text = `${headText}\n\n${tailText}`;
    this.post({ type: 'applyEdit', start: startLine, end: endLine, text, source: 'live-edit-split' });

    // Keep typing in the paragraph that was just created. Its optimistic source
    // range lines up with the edit we just sent (head, blank line, tail).
    tailEl.setAttribute('data-line-start', String(startLine + 2));
    tailEl.setAttribute('data-line-end', String(startLine + 2));
    tailEl.setAttribute('contenteditable', 'true');
    this.lastSent.set(startLine, headText);
    this.current = tailEl;
    block.classList.remove('is-editing');
    tailEl.classList.add('is-editing');

    tailEl.focus({ preventScroll: true });
    const caret = document.createRange();
    caret.setStart(tailEl, 0);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }

  private headTextBefore(range: Range, block: HTMLElement): string {
    const head = document.createRange();
    head.selectNodeContents(block);
    head.setEnd(range.startContainer, range.startOffset);
    return (head.toString() || '').replace(/\u00a0/g, ' ').trim();
  }

  private wrapSelection(event: KeyboardEvent, tag: 'strong' | 'em' | 'code' | 'del') {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    const wrapper = document.createElement(tag);
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    selection.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(wrapper);
    selection.addRange(after);
    this.schedule();
  }

  private async insertLink(event: KeyboardEvent) {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = range.toString();
    const href = window.prompt('Link URL', 'https://');
    if (!href) return;
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    anchor.textContent = text || href;
    range.deleteContents();
    range.insertNode(anchor);
    this.schedule();
  }

  private moveCell(delta: number) {
    const cells = Array.from(this.current?.querySelectorAll<HTMLElement>('th, td') || []);
    const index = cells.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const next = cells[index + delta];
    if (!next) return;
    next.focus();
    this.placeCaretEnd(next);
  }

  /* --------------------------------------------------------- paste & drop */

  private onPaste(event: ClipboardEvent) {
    if (!this.enabled) return;
    const items = Array.from(event.clipboardData?.items || []);
    const image = items.find((item) => item.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      const file = image.getAsFile();
      if (file) void this.sendImage(file);
      return;
    }
    const text = event.clipboardData?.getData('text/plain');
    if (text !== undefined) {
      event.preventDefault();
      document.execCommand('insertText', false, text);
      this.schedule();
    }
  }

  async sendImage(file: File) {
    return this.sendImageAt(file, this.current);
  }

  async sendImageAt(file: File, block: HTMLElement | null) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const line = block
      ? Number(block.getAttribute('data-line-end') || block.getAttribute('data-line-start'))
      : 0;
    this.post({
      type: 'attachImage',
      name: file.name || 'image.png',
      mime: file.type,
      data: btoa(binary),
      line,
      cursor: this.caretOffset(block),
    });
  }

  private caretOffset(block: HTMLElement | null): number {
    const selection = window.getSelection();
    if (!block || !selection || !selection.rangeCount) return 0;
    const range = selection.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  /* --------------------------------------------------------------- updates */

  deferUpdate(message: any) {
    this.deferred = message;
  }

  hasDeferred(): boolean {
    return this.deferred !== null;
  }

  takeDeferred(): any {
    const message = this.deferred;
    this.deferred = null;
    return message;
  }

  resetHistory() {
    this.lastSent.clear();
  }
}
