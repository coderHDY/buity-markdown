/* Buity Markdown — preview client */
declare function acquireVsCodeApi(): { postMessage(msg: any): void; getState(): any; setState(s: any): void };
declare const mermaid: any;

interface Heading {
  level: number;
  text: string;
  id: string;
}

interface Config {
  theme: 'auto' | 'paper' | 'midnight';
  fontSize: number;
  lineHeight: number;
  width: 'narrow' | 'comfortable' | 'wide' | 'full';
  showOutline: boolean;
  syncScroll: boolean;
  mermaid: boolean;
}

const vscode = acquireVsCodeApi();

const el = {
  body: document.body,
  titleText: document.getElementById('title-text') as HTMLElement,
  stats: document.getElementById('stats') as HTMLElement,
  progress: document.getElementById('progress-bar') as HTMLElement,
  sidebar: document.getElementById('sidebar') as HTMLElement,
  toc: document.getElementById('toc') as HTMLElement,
  main: document.getElementById('main') as HTMLElement,
  article: document.getElementById('article') as HTMLElement,
  outlineBtn: document.getElementById('btn-outline') as HTMLButtonElement,
  themeSeg: document.getElementById('theme-seg') as HTMLElement,
  fontDec: document.getElementById('btn-font-dec') as HTMLButtonElement,
  fontInc: document.getElementById('btn-font-inc') as HTMLButtonElement,
  exportBtn: document.getElementById('btn-export') as HTMLButtonElement,
  topBtn: document.getElementById('btn-top') as HTMLButtonElement,
};

const WIDTHS: Record<string, string> = {
  narrow: '34rem',
  comfortable: '42rem',
  wide: '50rem',
  full: '100%',
};

let config: Config = {
  theme: 'auto',
  fontSize: 16,
  lineHeight: 1.75,
  width: 'comfortable',
  showOutline: true,
  syncScroll: true,
  mermaid: true,
};

let themeKind: 'light' | 'dark' = 'dark';
let mermaidUri = '';
let mermaidPromise: Promise<any> | null = null;
let suppressScrollEvent = 0;
let scrollTimer: number | undefined;
let lineIndex: { line: number; el: HTMLElement }[] = [];

/* ------------------------------------------------------------------ config */

function applyTheme() {
  const effective = config.theme === 'auto' ? themeKind : config.theme;
  const isLight = effective === 'light' || effective === 'paper';
  el.body.classList.toggle('vscode-light', isLight);
  el.body.classList.toggle('vscode-dark', !isLight);
  el.body.setAttribute('data-bm-theme', config.theme);
  for (const btn of Array.from(el.themeSeg.querySelectorAll('button'))) {
    btn.classList.toggle('is-active', btn.dataset.theme === config.theme);
  }
}

function applyConfig() {
  applyTheme();
  el.body.style.setProperty('--bm-font-size', `${config.fontSize}px`);
  el.body.style.setProperty('--bm-line-height', String(config.lineHeight));
  el.body.style.setProperty('--bm-max-width', WIDTHS[config.width] || WIDTHS.comfortable);
  el.body.classList.toggle('bm-no-outline', !config.showOutline);
  el.outlineBtn.classList.toggle('is-on', config.showOutline);
  el.outlineBtn.setAttribute('aria-pressed', String(config.showOutline));
}

function postConfig(patch: Partial<Config>) {
  config = { ...config, ...patch };
  applyConfig();
  vscode.postMessage({ type: 'setConfig', patch });
}

/* ------------------------------------------------------------------- index */

function buildIndex() {
  const nodes = Array.from(el.article.querySelectorAll<HTMLElement>('[data-line]'));
  lineIndex = nodes
    .map((node) => ({ line: Number(node.dataset.line), el: node }))
    .filter((entry) => Number.isFinite(entry.line))
    .sort((a, b) => a.line - b.line);
}

function lineAtOffset(offset: number): number {
  let lo = 0;
  let hi = lineIndex.length - 1;
  if (hi < 0) return 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineIndex[mid].el.offsetTop <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lineIndex[lo].line;
}

function scrollToLine(line: number, smooth = false) {
  if (!lineIndex.length) return;
  let target = lineIndex[0];
  for (const entry of lineIndex) {
    if (entry.line <= line) target = entry;
    else break;
  }
  const top = Math.max(0, target.el.offsetTop - 16);
  suppressScrollEvent = Date.now();
  el.main.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

/* --------------------------------------------------------------- mermaid */

function loadMermaid(): Promise<any> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = mermaidUri;
    script.nonce = (document.getElementById('buity-script') as HTMLScriptElement)?.nonce || '';
    script.onload = () => resolve((globalThis as any).mermaid);
    script.onerror = () => reject(new Error('mermaid failed to load'));
    document.head.appendChild(script);
  });
  return mermaidPromise;
}

function mermaidTheme() {
  const effective = config.theme === 'auto' ? themeKind : config.theme;
  return effective === 'light' || effective === 'paper' ? 'default' : 'dark';
}

async function renderDiagrams(force = false) {
  if (!config.mermaid) return;
  const nodes = Array.from(el.article.querySelectorAll<HTMLElement>('pre.mermaid'));
  if (!nodes.length) return;
  let lib: any;
  try {
    lib = await loadMermaid();
  } catch {
    return;
  }
  const theme = mermaidTheme();
  if (force) {
    for (const node of nodes) {
      if (node.dataset.src) node.textContent = node.dataset.src;
      node.removeAttribute('data-processed');
      const figure = node.closest('.bm-diagram');
      figure?.classList.remove('bm-diagram-error');
    }
  } else {
    for (const node of nodes) if (!node.dataset.src) node.dataset.src = node.textContent || '';
  }
  try {
    lib.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      fontFamily: getComputedStyle(el.body).getPropertyValue('--bm-font-body').trim() || 'sans-serif',
      flowchart: { curve: 'basis', padding: 16 },
      themeVariables: {
        background: 'transparent',
        primaryColor: theme === 'dark' ? '#1b2029' : '#f4efe4',
        primaryTextColor: theme === 'dark' ? '#e6ebf3' : '#22252b',
        primaryBorderColor: theme === 'dark' ? '#3b4453' : '#d8d0c0',
        lineColor: theme === 'dark' ? '#5c6779' : '#b9b0a0',
        fontSize: '14px',
      },
    });
    await lib.run({ nodes, suppressErrors: true });
  } catch {
    /* keep the raw source visible */
  }
}

/* -------------------------------------------------------------------- toc */

let diagramTimer: number | undefined;

function scheduleDiagrams(force = false) {
  window.clearTimeout(diagramTimer);
  diagramTimer = window.setTimeout(() => void renderDiagrams(force), force ? 0 : 240);
}

let diagramAckSent = false;

/** One-shot diagnostic: confirms the bundled diagram engine actually ran. */
function scheduleDiagramAck() {
  if (diagramAckSent) return;
  window.setTimeout(() => {
    if (diagramAckSent) return;
    const svg = el.article.querySelectorAll('.bm-diagram svg').length;
    if (!svg) return;
    diagramAckSent = true;
    vscode.postMessage({ type: 'rendered', nodes: 0, headings: 0, katex: 0, diagrams: svg });
  }, 1600);
}

function renderToc(headings: Heading[]) {
  el.toc.innerHTML = '';
  if (!headings.length) {
    const empty = document.createElement('div');
    empty.className = 'bm-toc-empty';
    empty.textContent = 'Add headings (#) to build an outline.';
    el.toc.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const heading of headings) {
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.dataset.level = String(heading.level);
    link.dataset.id = heading.id;
    link.textContent = heading.text;
    link.title = heading.text;
    fragment.appendChild(link);
  }
  el.toc.appendChild(fragment);
}

function syncToc() {
  const links = Array.from(el.toc.querySelectorAll<HTMLAnchorElement>('a'));
  if (!links.length) return;
  const threshold = el.main.scrollTop + 90;
  let activeId = links[0].dataset.id;
  for (const link of links) {
    const target = document.getElementById(link.dataset.id || '');
    if (target && target.offsetTop <= threshold) activeId = link.dataset.id;
  }
  for (const link of links) {
    const active = link.dataset.id === activeId;
    link.classList.toggle('is-active', active);
    if (active) {
      const top = link.offsetTop - 60;
      const bottom = top + link.offsetHeight + 120;
      if (top < el.sidebar.scrollTop || bottom > el.sidebar.scrollTop + el.sidebar.clientHeight) {
        el.sidebar.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }
  }
}

/* ---------------------------------------------------------------- updates */

function updateProgress() {
  const max = el.main.scrollHeight - el.main.clientHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, el.main.scrollTop / max)) : 0;
  el.progress.style.width = `${(ratio * 100).toFixed(2)}%`;
  el.topBtn.classList.toggle('is-on', el.main.scrollTop > 400);
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

function applyUpdate(message: any) {
  const ratio =
    el.main.scrollHeight > el.main.clientHeight
      ? el.main.scrollTop / (el.main.scrollHeight - el.main.clientHeight)
      : 0;

  el.article.innerHTML = message.html || '';
  el.titleText.textContent = message.title || 'Preview';
  document.title = message.title || 'Buity Markdown';
  if (message.stats) {
    const parts = [`${formatNumber(message.stats.words)} words`];
    if (message.stats.readingMinutes) parts.push(`~${message.stats.readingMinutes} min read`);
    el.stats.textContent = parts.join('  ·  ');
  }

  buildIndex();
  renderToc(message.headings || []);

  // keep the reader roughly where they were
  if (ratio > 0.001) {
    el.main.scrollTop = ratio * (el.main.scrollHeight - el.main.clientHeight);
  }

  scheduleDiagrams();
  scheduleDiagramAck();
  syncToc();
  updateProgress();
}

/* ----------------------------------------------------------------- events */

el.main.addEventListener('scroll', () => {
  updateProgress();
  if (Date.now() - suppressScrollEvent < 200) return;
  if (!config.syncScroll) return;
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    const line = lineAtOffset(el.main.scrollTop + 8);
    vscode.postMessage({ type: 'scroll', line });
    syncToc();
  }, 70);
});

el.article.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const copyBtn = target.closest<HTMLButtonElement>('[data-copy]');
  if (copyBtn) {
    const host = copyBtn.closest('.bm-code, .bm-diagram');
    const code = host?.querySelector('code') || host?.querySelector('pre.mermaid');
    const text = code?.textContent || '';
    const done = () => {
      const previous = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('is-copied');
      window.setTimeout(() => {
        copyBtn.textContent = previous;
        copyBtn.classList.remove('is-copied');
      }, 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
    return;
  }

  const checkbox = target.closest<HTMLInputElement>('.task-list-item-checkbox');
  if (checkbox) {
    const item = checkbox.closest<HTMLElement>('[data-line]');
    if (item?.dataset.line) {
      vscode.postMessage({
        type: 'toggleTask',
        line: Number(item.dataset.line),
        checked: checkbox.checked,
      });
    }
    return;
  }

  const anchor = target.closest<HTMLAnchorElement>('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') || '';
  event.preventDefault();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const heading = document.getElementById(id);
    if (heading) {
      el.main.scrollTo({ top: Math.max(0, heading.offsetTop - 20), behavior: 'smooth' });
      const owner = heading.closest<HTMLElement>('[data-line]');
      if (owner?.dataset.line) vscode.postMessage({ type: 'revealLine', line: Number(owner.dataset.line) });
    }
  } else if (href) {
    vscode.postMessage({ type: 'openLink', href });
  }
});

function fallbackCopy(text: string, done: () => void) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } finally {
    area.remove();
  }
}

for (const btn of Array.from(el.themeSeg.querySelectorAll<HTMLButtonElement>('button'))) {
  btn.addEventListener('click', () => postConfig({ theme: (btn.dataset.theme as Config['theme']) || 'auto' }));
}

el.fontInc.addEventListener('click', () => postConfig({ fontSize: Math.min(24, config.fontSize + 1) }));
el.fontDec.addEventListener('click', () => postConfig({ fontSize: Math.max(12, config.fontSize - 1) }));
el.outlineBtn.addEventListener('click', () => postConfig({ showOutline: !config.showOutline }));
el.exportBtn.addEventListener('click', () => vscode.postMessage({ type: 'export' }));
el.topBtn.addEventListener('click', () => el.main.scrollTo({ top: 0, behavior: 'smooth' }));

window.addEventListener('message', (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init':
        themeKind = message.themeKind;
        mermaidUri = message.mermaidUri || '';
        config = { ...config, ...message.config };
        applyConfig();
        break;
      case 'update':
        applyUpdate(message);
        vscode.postMessage({
          type: 'rendered',
          nodes: el.article.querySelectorAll('*').length,
          katex: el.article.querySelectorAll('.katex').length,
          diagrams: el.article.querySelectorAll('.bm-diagram svg').length,
          headings: (message.headings || []).length,
        });
        break;
      case 'config':
        themeKind = message.themeKind || themeKind;
        config = { ...config, ...message.config };
        applyConfig();
        if (message.redrawDiagrams) renderDiagrams(true);
        break;
      case 'scrollTo':
        scrollToLine(message.line, false);
        syncToc();
        updateProgress();
        break;
    }
  } catch (error) {
    vscode.postMessage({ type: 'error', message: error instanceof Error ? error.stack || error.message : String(error) });
  }
});

vscode.postMessage({ type: 'ready' });
