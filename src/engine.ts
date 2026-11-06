import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import sanitizeHtml from 'sanitize-html';

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
  words: number;
  chars: number;
  readingMinutes: number;
  hasMath: boolean;
  hasDiagram: boolean;
}

export interface EngineOptions {
  math?: boolean;
  callouts?: boolean;
  highlight?: boolean;
  mermaid?: boolean;
  breaks?: boolean;
  linkify?: boolean;
  typographer?: boolean;
  /** Rewrite image sources (e.g. to webview URIs). */
  resolveImage?: (src: string) => string;
}

type Token = any;
type State = any;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'];

const CALLOUT_ALIASES: Record<string, string> = {
  note: 'note',
  info: 'note',
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  important: 'important',
  warning: 'warning',
  warn: 'warning',
  caution: 'caution',
  danger: 'caution',
  error: 'caution',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

const CALLOUT_LABELS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
  example: 'Example',
  quote: 'Quote',
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}_\-.]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return slug || 'section';
}

function plainText(inline: Token): string {
  const children: Token[] = inline.children || [];
  let out = '';
  for (const child of children) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content;
    else if (child.type === 'image') out += child.content || '';
    else if (child.type === 'html_inline') out += child.content.replace(/<[^>]*>/g, '');
    else if (child.children && child.children.length) out += plainText(child);
  }
  return out.trim();
}

export function countText(text: string): { words: number; chars: number; readingMinutes: number } {
  const chars = text.replace(/\s/g, '').length;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .match(/[A-Za-z0-9\u00c0-\u024f'’\-]+/g);
  const words = cjk + (latin ? latin.length : 0);
  const readingMinutes = Math.max(1, Math.round(cjk / 400 + (latin ? latin.length / 220 : 0)));
  return { words, chars, readingMinutes };
}

/* ------------------------------------------------------------------ */
/* plugins                                                             */
/* ------------------------------------------------------------------ */

/** `==marked==` inline highlight. */
function markPlugin(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'bm_mark', (state: State, silent: boolean) => {
    const start = state.pos;
    const src = state.src;
    if (src.charCodeAt(start) !== 0x3d /* = */) return false;
    if (src.charCodeAt(start + 1) !== 0x3d) return false;
    const end = src.indexOf('==', start + 2);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('bm_mark', 'mark', 0);
      token.content = src.slice(start + 2, end);
      token.markup = '==';
      state.pos = end + 2;
      return true;
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.bm_mark = (tokens, idx) => `<mark>${md.utils.escapeHtml(tokens[idx].content)}</mark>`;
}

/** KaTeX math: $$..$$, \[..\], $..$, \(..\). */
function mathPlugin(md: MarkdownIt) {
  const render = (tex: string, display: boolean) => {
    try {
      const html = katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
        trust: false,
      });
      const source = escapeHtml(tex);
      return display
        ? `<div class="bm-math bm-math-block" data-tex="${source}">${html}</div>`
        : `<span class="bm-math bm-math-inline" data-tex="${source}">${html}</span>`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `<code class="bm-math-error" title="${escapeHtml(msg)}">${escapeHtml(tex)}</code>`;
    }
  };

  // block: $$ ... $$ or \[ ... \]
  md.block.ruler.before('fence', 'bm_math_block', (state: State, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    let pos = start;
    const s = state.src;
    let open = '';
    let close = '';
    if (s.startsWith('$$', pos)) {
      open = '$$';
      close = '$$';
    } else if (s.startsWith('\\[', pos)) {
      open = '\\[';
      close = '\\]';
    } else return false;
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;

    let endLineFound = -1;
    let body = '';
    const restOfFirst = s.slice(pos + open.length, max);
    if (restOfFirst.trim().endsWith(close) && restOfFirst.trim().length > close.length) {
      body = restOfFirst.trim().slice(0, -close.length);
      endLineFound = startLine;
    } else {
      body = restOfFirst;
      for (let line = startLine + 1; line < endLine; line++) {
        const ls = state.bMarks[line] + state.tShift[line];
        const le = state.eMarks[line];
        const text = s.slice(ls, le);
        if (text.trim().endsWith(close)) {
          body += '\n' + text.slice(0, text.lastIndexOf(close));
          endLineFound = line;
          break;
        }
        body += '\n' + text;
      }
    }
    if (endLineFound < 0) return false;
    if (silent) return true;

    const token = state.push('bm_math_block', 'div', 0);
    token.content = body.trim();
    token.map = [startLine, endLineFound + 1];
    token.markup = open;
    state.line = endLineFound + 1;
    return true;
  });

  md.renderer.rules.bm_math_block = (tokens, idx) => {
    const token = tokens[idx];
    const range = token.map ? ` data-line="${token.map[0] + 1}" data-line-start="${token.map[0] + 1}" data-line-end="${token.map[1]}"` : '';
    const inner = render(token.content, true);
    return range ? inner.replace('<div class="bm-math bm-math-block"', `<div class="bm-math bm-math-block"${range}`) : inner;
  };

  // inline: $...$ and \(...\)
  md.inline.ruler.after('escape', 'bm_math_inline', (state: State, silent: boolean) => {
    const src = state.src;
    const pos = state.pos;
    let close = '';
    let startLen = 0;
    if (src.startsWith('$', pos) && src[pos + 1] !== '$') {
      close = '$';
      startLen = 1;
    } else if (src.startsWith('\\(', pos)) {
      close = '\\)';
      startLen = 2;
    } else return false;
    // no space right after the opener, and a matching closer
    if (/[\s\d]/.test(src[pos + startLen] || '')) return false;
    let end = pos + startLen;
    while (true) {
      end = src.indexOf(close, end);
      if (end < 0) return false;
      if (src[end - 1] !== '\\') break;
      end += close.length;
    }
    if (end === pos + startLen) return false;
    if (!silent) {
      const token = state.push('bm_math_inline', 'span', 0);
      token.content = src.slice(pos + startLen, end);
      token.markup = close;
      state.pos = end + close.length;
      return true;
    }
    state.pos = end + close.length;
    return true;
  });

  md.renderer.rules.bm_math_inline = (tokens, idx) => render(tokens[idx].content, false);
}

/** `::: tip Title` fenced callouts. */
function calloutContainer(md: MarkdownIt) {
  const MARKER = /^(:{3,})\s*([A-Za-z][\w-]*)?[ \t]*(.*)$/;

  md.block.ruler.before('fence', 'bm_callout', (state: State, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const line = state.src.slice(start, max);
    const match = MARKER.exec(line);
    if (!match) return false;
    const rawType = (match[2] || 'note').toLowerCase();
    const type = CALLOUT_ALIASES[rawType] || 'note';
    const title = (match[3] || '').trim();
    if (silent) return true;

    let nextLine = startLine;
    let autoClosed = false;
    let depth = 0;
    for (;;) {
      nextLine++;
      if (nextLine >= endLine) break;
      const s = state.bMarks[nextLine] + state.tShift[nextLine];
      const e = state.eMarks[nextLine];
      if (s < e && state.sCount[nextLine] < state.blkIndent) break;
      const text = state.src.slice(s, e).trim();
      if (/^:{3,}\s*[A-Za-z]/.test(text)) {
        // a nested callout opens; its own closing fence must not close us
        depth++;
        continue;
      }
      if (/^:{3,}$/.test(text)) {
        if (depth > 0) {
          depth--;
          continue;
        }
        autoClosed = true;
        break;
      }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;
    state.parentType = 'callout';
    state.lineMax = nextLine;

    const open = state.push('bm_callout_open', 'div', 1);
    open.block = true;
    open.map = [startLine, nextLine + (autoClosed ? 1 : 0)];
    open.meta = { type, title };
    open.attrSet('class', `bm-callout bm-callout-${type}`);

    state.md.block.tokenize(state, startLine + 1, nextLine);

    const close = state.push('bm_callout_close', 'div', -1);
    close.block = true;

    state.parentType = oldParent;
    state.lineMax = oldLineMax;
    state.line = nextLine + (autoClosed ? 1 : 0);
    return true;
  });

  md.renderer.rules.bm_callout_open = (tokens, idx) => {
    const meta = tokens[idx].meta || {};
    const title = meta.title || '';
    const label = title ? md.utils.escapeHtml(title) : CALLOUT_LABELS[meta.type] || 'Note';
    const map = tokens[idx].map;
    const range = map ? ` data-line-start="${map[0] + 1}" data-line-end="${map[1]}"` : '';
    return (
      `<div class="bm-callout bm-callout-${meta.type || 'note'}" data-callout="${meta.type || 'note'}"` +
      ` data-callout-title="${escapeHtml(title)}"${range}>` +
      `<div class="bm-callout-title"><span class="bm-callout-dot"></span>${label}</div>`
    );
  };
  md.renderer.rules.bm_callout_close = () => '</div>';
}

/** GitHub style `> [!NOTE]` alerts, rewritten to the same markup as callouts. */
function githubAlerts(md: MarkdownIt) {
  md.core.ruler.push('bm_github_alerts', (state: State) => {
    const tokens: Token[] = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      let close = i;
      while (close < tokens.length && tokens[close].type !== 'blockquote_close') close++;
      const pOpen = tokens.slice(i, close).findIndex((t) => t.type === 'paragraph_open');
      if (pOpen < 0) continue;
      const pIdx = i + pOpen;
      const inline = tokens[pIdx + 1];
      if (!inline || inline.type !== 'inline') continue;
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)(?:\n|$)/i.exec(inline.content);
      if (!m) continue;

      const type = m[1].toLowerCase();
      const title = (m[2] || '').trim();
      const rest = inline.content.slice(m[0].length);

      tokens[i].type = 'bm_alert_open';
      tokens[i].tag = 'div';
      tokens[i].nesting = 1;
      tokens[i].meta = { type, title };
      const endIdx = close;
      tokens[endIdx].type = 'bm_alert_close';
      tokens[endIdx].tag = 'div';
      tokens[endIdx].nesting = -1;

      if (rest.trim()) {
        inline.content = rest;
        inline.children = [];
        state.md.inline.parse(inline.content, state.md, state.env, inline.children);
      } else {
        // drop the emptied first paragraph
        tokens.splice(pIdx, 3);
      }
      i = close;
    }
  });

  md.renderer.rules.bm_alert_open = (tokens, idx) => {
    const meta = tokens[idx].meta || {};
    const title = meta.title || '';
    const label = title ? md.utils.escapeHtml(title) : CALLOUT_LABELS[meta.type] || 'Note';
    const map = tokens[idx].map;
    const range = map ? ` data-line-start="${map[0] + 1}" data-line-end="${map[1]}"` : '';
    return (
      `<div class="bm-callout bm-callout-${meta.type || 'note'}" data-callout="${meta.type || 'note'}"` +
      ` data-callout-title="${escapeHtml(title)}" data-callout-syntax="alert"${range}>` +
      `<div class="bm-callout-title"><span class="bm-callout-dot"></span>${label}</div>`
    );
  };
  md.renderer.rules.bm_alert_close = () => '</div>';
}

/** Heading ids + collected outline + hover anchors. */
function anchorsAndOutline(md: MarkdownIt) {
  md.core.ruler.push('bm_anchors', (state: State) => {
    const used = new Map<string, number>();
    const headings: Heading[] = [];
    const tokens: Token[] = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const text = inline && inline.type === 'inline' ? plainText(inline) : '';
      if (!text) continue;
      let id = slugify(text);
      const seen = used.get(id) ?? 0;
      used.set(id, seen + 1);
      if (seen) id = `${id}-${seen}`;
      t.attrSet('id', id);
      if (inline && inline.children) {
        const anchor = new state.Token('html_inline', '', 0);
        anchor.content = `<a class="bm-anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a>`;
        inline.children.unshift(anchor);
      }
      headings.push({ level: Number(String(t.tag).slice(1)), text, id });
    }
    state.env.bmHeadings = headings;
  });
}

/* ------------------------------------------------------------------ */
/* engine                                                             */
/* ------------------------------------------------------------------ */

export interface Engine {
  md: MarkdownIt;
  render(text: string): RenderResult;
}

export function createEngine(options: EngineOptions = {}): Engine {
  const opts = {
    math: options.math !== false,
    callouts: options.callouts !== false,
    highlight: options.highlight !== false,
    mermaid: options.mermaid !== false,
    breaks: options.breaks ?? false,
    linkify: options.linkify ?? true,
    typographer: options.typographer ?? true,
  };

  const md = new MarkdownIt({
    html: true,
    linkify: opts.linkify,
    breaks: opts.breaks,
    typographer: opts.typographer,
  });
  const resolveImage = options.resolveImage;

  md.use(markPlugin);
  md.use(footnote);
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  if (opts.math) md.use(mathPlugin);
  if (opts.callouts) {
    md.use(calloutContainer);
    md.use(githubAlerts);
  }
  md.use(anchorsAndOutline);

  // table scroll wrapper + source line anchors
  const renderToken = md.renderer.renderToken.bind(md.renderer);
  const lineRange = (token: Token) =>
    token.map ? ` data-line="${token.map[0] + 1}" data-line-start="${token.map[0] + 1}" data-line-end="${token.map[1]}"` : '';

  md.renderer.renderToken = (tokens: Token[], idx: number, options2: any) => {
    const token = tokens[idx];
    // The footnote section is generated from the definitions at the end of the
    // file; keep it read-only so live edits can never drop those definitions.
    if (token.type.startsWith('footnote_')) {
      token.attrSet('data-locked', 'true');
      if (token.type === 'footnote_block_open') token.attrJoin('class', 'bm-footnotes');
      return renderToken(tokens, idx, options2);
    }
    if (token.type === 'table_open') {
      return `<div class="bm-table-wrap"${lineRange(token)}>${renderToken(tokens, idx, options2)}`;
    }
    if (token.type === 'table_close') {
      return `${renderToken(tokens, idx, options2)}</div>`;
    }
    if (
      token.map &&
      token.level === 0 &&
      token.nesting !== -1 &&
      token.block &&
      (token.type.endsWith('_open') || token.type === 'fence' || token.type === 'hr' || token.type === 'html_block')
    ) {
      if (!token.attrGet('data-line')) {
        token.attrPush(['data-line', String(token.map[0] + 1)]);
        token.attrPush(['data-line-start', String(token.map[0] + 1)]);
        token.attrPush(['data-line-end', String(token.map[1])]);
      }
    }
    return renderToken(tokens, idx, options2);
  };

  md.renderer.rules.image = (tokens, idx, options2, env, self) => {
    const token = tokens[idx];
    if (token.children && token.children.length) {
      token.attrSet('alt', self.renderInlineAsText(token.children, options2, env));
    }
    if (!token.attrGet('data-src')) token.attrPush(['data-src', token.attrGet('src') || '']);
    if (resolveImage) {
      const src = token.attrGet('src');
      if (src) {
        const resolved = resolveImage(src);
        if (resolved) token.attrSet('src', resolved);
      }
    }
    token.attrSet('loading', 'lazy');
    token.attrJoin('class', 'bm-img');
    return self.renderToken(tokens, idx, options2);
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
    const lang = info ? info.split(/\s+/g)[0] : '';
    const raw = token.content;
    const lineAttr = token.map
      ? ` data-line="${token.map[0] + 1}" data-line-start="${token.map[0] + 1}" data-line-end="${token.map[1]}"`
      : '';
    const langCheck = lang.toLowerCase();

    if (opts.mermaid && (langCheck === 'mermaid' || langCheck === 'mmd')) {
      return (
        `<figure class="bm-diagram" data-lang="${escapeHtml(lang)}" data-src="${escapeHtml(raw)}"${lineAttr}>` +
        `<div class="bm-code-head"><span class="bm-lang">mermaid</span>` +
        `<span class="bm-code-actions"><button class="bm-btn-copy" type="button" data-copy>Copy</button></span></div>` +
        `<pre class="mermaid">${md.utils.escapeHtml(raw)}</pre>` +
        `</figure>`
      );
    }

    let highlighted: string;
    if (opts.highlight && lang && hljs.getLanguage(lang)) {
      try {
        highlighted = hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value;
      } catch {
        highlighted = md.utils.escapeHtml(raw);
      }
    } else {
      highlighted = md.utils.escapeHtml(raw);
    }
    const lines = raw.replace(/\n$/, '').split('\n').length;
    return (
      `<div class="bm-code"${lineAttr}>` +
      `<div class="bm-code-head"><span class="bm-lang">${escapeHtml(lang || 'text')}</span>` +
      `<span class="bm-code-meta">${lines} ${lines === 1 ? 'line' : 'lines'}</span>` +
      `<button class="bm-btn-copy" type="button" data-copy>Copy</button></div>` +
      `<pre class="bm-pre"><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ''}">${highlighted}</code></pre>` +
      `</div>`
    );
  };

  function render(text: string): RenderResult {
    const env: any = {};
    const raw = md.render(text, env);
    const html = sanitize(raw);
    const headings: Heading[] = env.bmHeadings || [];
    const counts = countText(text);
    return {
      html,
      headings,
      ...counts,
      hasMath: /class="katex/.test(html),
      hasDiagram: /<pre class="mermaid">/.test(html),
    };
  }

  return { md, render };
}

/* ------------------------------------------------------------------ */
/* sanitising user HTML (webview renders the result)                   */
/* ------------------------------------------------------------------ */

let cachedSanitizer: ((html: string) => string) | null = null;

function sanitize(html: string): string {
  if (!cachedSanitizer) {
    const defaults = sanitizeHtml.defaults;
    const tags = Array.from(
      new Set([
        ...defaults.allowedTags,
        'img',
        'video',
        'audio',
        'source',
        'track',
        'figure',
        'figcaption',
        'details',
        'summary',
        'mark',
        'ins',
        'del',
        'kbd',
        'abbr',
        'dl',
        'dt',
        'dd',
        'sup',
        'sub',
        'input',
        'button',
        'section',
        'picture',
        'source',
        'colgroup',
        'col',
        'caption',
        'ruby',
        'rt',
        'rp',
        'math',
        'semantics',
        'annotation',
        'mrow',
        'mi',
        'mo',
        'mn',
        'msup',
        'msub',
        'mfrac',
        'msqrt',
        'mtext',
        'mspace',
        'mtable',
        'mtr',
        'mtd',
        'munder',
        'mover',
        'munderover',
      ]),
    );
    cachedSanitizer = (input: string) =>
      sanitizeHtml(input, {
        allowedTags: tags,
        allowedAttributes: {
          '*': ['class', 'id', 'style', 'title', 'align', 'data-line', 'data-line-start', 'data-line-end', 'data-callout', 'data-callout-title', 'data-callout-syntax', 'data-copy', 'data-src', 'data-tex', 'data-raw', 'aria-hidden', 'aria-label', 'role', 'dir', 'lang', 'type', 'contenteditable', 'spellcheck'],
          a: ['href', 'name', 'target', 'rel', 'class', 'id', 'title', 'aria-hidden'],
          img: ['src', 'srcset', 'alt', 'width', 'height', 'loading', 'class', 'title'],
          input: ['type', 'checked', 'disabled', 'class'],
          video: ['src', 'controls', 'loop', 'muted', 'poster', 'width', 'height', 'class'],
          audio: ['src', 'controls', 'loop', 'muted', 'class'],
          source: ['srcset', 'type', 'media'],
          td: ['colspan', 'rowspan', 'align', 'style'],
          th: ['colspan', 'rowspan', 'align', 'style'],
          col: ['span', 'width'],
          math: ['xmlns', 'display', 'class'],
          annotation: ['encoding'],
        },
        allowedStyles: undefined,
        allowedSchemes: ['http', 'https', 'mailto', 'data', 'file', 'vscode-webview', 'command'],
        allowedSchemesByTag: { img: ['http', 'https', 'data', 'file', 'vscode-webview', 'vscode-resource'] },
        transformTags: {
          '*': (tagName, attribs) => {
            if (attribs.style) {
              const kept = attribs.style
                .split(';')
                .filter((decl) => decl.trim() && !/url\s*\(|expression\s*\(|@import|behavior\s*:|position\s*:/i.test(decl))
                .join(';');
              if (kept) attribs.style = kept;
              else delete attribs.style;
            }
            return { tagName, attribs };
          },
        },
      });
  }
  return cachedSanitizer(html);
}

/* ------------------------------------------------------------------ */
/* built-in preview extension point                                    */
/* ------------------------------------------------------------------ */

/**
 * Used through `markdown.markdownItPlugins`: extends VS Code's own
 * markdown-it instance so the built-in preview gets callouts, math,
 * anchors, footnotes and task lists too.
 */
export function extendMarkdownIt(
  md: MarkdownIt,
  options: { math?: boolean; callouts?: boolean } = {},
): MarkdownIt {
  md.use(markPlugin);
  md.use(footnote);
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  if (options.math !== false) md.use(mathPlugin);
  if (options.callouts !== false) {
    md.use(calloutContainer);
    md.use(githubAlerts);
  }
  md.use(anchorsAndOutline);
  return md;
}
