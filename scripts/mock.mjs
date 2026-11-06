/* Generates a browser mock of the preview webview so the design can be
   reviewed without launching the extension host. */
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const out = '/tmp/mock';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of ['buity.css', 'webview.css', 'katex.css', 'webview.js']) {
  fs.copyFileSync(path.join(repo, 'media', file), path.join(out, file));
}
fs.cpSync(path.join(repo, 'media/fonts'), path.join(out, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(repo, 'media/vendor/mermaid.min.js'), path.join(out, 'vendor/mermaid.min.js'));

const source = fs.readFileSync('/tmp/buity-paper.html', 'utf8');
const body = source.slice(source.indexOf('<body'), source.lastIndexOf('</body>'));
const seed = body
  .replace(/^<body[^>]*>/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Buity Markdown — webview mock</title>
<link rel="stylesheet" href="/katex.css" />
<link rel="stylesheet" href="/buity.css" />
<link rel="stylesheet" href="/webview.css" />
</head>
<body class="bm-body bm-interactive vscode-dark" data-bm-theme="auto">
  <header class="bm-toolbar">
    <div class="bm-title">
      <span class="bm-title-dot"></span>
      <span class="bm-title-text" id="title-text">Preview</span>
      <span class="bm-stats" id="stats"></span>
    </div>
    <div class="bm-tools">
      <button class="bm-icon-btn" id="btn-font-dec" title="Smaller text">A−</button>
      <button class="bm-icon-btn" id="btn-font-inc" title="Larger text">A+</button>
      <span class="bm-divider"></span>
      <div class="bm-seg" id="theme-seg" role="group">
        <button data-theme="auto" title="Follow VS Code theme">Auto</button>
        <button data-theme="paper" title="Paper theme">Paper</button>
        <button data-theme="midnight" title="Night theme">Night</button>
      </div>
      <span class="bm-divider"></span>
      <button class="bm-icon-btn" id="btn-outline" title="Toggle outline">☰</button>
      <button class="bm-icon-btn" id="btn-top" title="Back to top">↑</button>
      <button class="bm-icon-btn" id="btn-export" title="Export">⤓</button>
    </div>
  </header>
  <div class="bm-progress"><div class="bm-progress-bar" id="progress-bar"></div></div>
  <div class="bm-shell">
    <aside class="bm-sidebar" id="sidebar">
      <div class="bm-sidebar-title">Outline</div>
      <nav class="bm-toc" id="toc"></nav>
    </aside>
    <main class="bm-main" id="main">
      <article class="bm-article" id="article"></article>
    </main>
  </div>
  <div id="seed" hidden>${seed}</div>
  <script>
    const params = new URLSearchParams(location.search);
    const theme = params.get('theme') || 'paper';
    const kind = theme === 'midnight' ? 'dark' : 'light';
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        if (message.type !== 'ready') return;
        window.postMessage({
          type: 'init',
          config: { theme, fontSize: 16, lineHeight: 1.75, width: 'comfortable', showOutline: true, syncScroll: true, mermaid: true },
          themeKind: kind,
          mermaidUri: '/vendor/mermaid.min.js',
        }, '*');
        setTimeout(() => {
          const seed = document.getElementById('seed');
          const headings = Array.from(seed.querySelectorAll('h1,h2,h3')).map((node) => ({
            level: Number(node.tagName[1]),
            text: node.textContent.trim(),
            id: node.id,
          }));
          window.postMessage({
            type: 'update',
            html: seed.innerHTML,
            headings,
            stats: { words: 282, chars: 1535, readingMinutes: 2 },
            title: 'design-notes.md',
          }, '*');
        }, 80);
      },
    });
  </script>
  <script src="/webview.js"></script>
  <script>
    if (params.get('diag')) {
      const errors = [];
      window.addEventListener('error', (event) => errors.push(String(event.message)));
      window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
      setTimeout(() => {
        const article = document.getElementById('article');
        const style = (node, prop) => node ? getComputedStyle(node).getPropertyValue(prop) : 'n/a';
        const toolbar = document.querySelector('.bm-toolbar');
        const sidebar = document.getElementById('sidebar');
        const copy = article.querySelector('.bm-btn-copy');
        const diag = {
          bodyClass: document.body.className,
          theme: document.body.getAttribute('data-bm-theme'),
          stats: document.getElementById('stats').textContent,
          article: {
            fontSize: style(article, 'font-size'),
            lineHeight: style(article, 'line-height'),
            maxWidth: style(article, 'max-width'),
            color: style(article, 'color'),
            padding: style(article, 'padding'),
            background: style(document.body, 'background-color'),
          },
          toolbar: { height: style(toolbar, 'height'), background: style(toolbar, 'background-color') },
          sidebar: { width: style(sidebar, 'width'), display: style(sidebar, 'display') },
          tocLinks: document.querySelectorAll('#toc a').length,
          tocActive: document.querySelectorAll('#toc a.is-active').length,
          dataLineNodes: article.querySelectorAll('[data-line]').length,
          h1Size: style(article.querySelector('h1'), 'font-size'),
          h2Size: style(article.querySelector('h2'), 'font-size'),
          inlineCodeBg: style(article.querySelector('p code'), 'background-color'),
          codeBlockBg: style(article.querySelector('.bm-code'), 'background-color'),
          copyDisplay: style(copy, 'display'),
          calloutBg: style(article.querySelector('.bm-callout'), 'background-color'),
          calloutBorder: style(article.querySelector('.bm-callout'), 'border-left-color'),
          tableHeadBg: style(article.querySelector('th'), 'background-color'),
          katexNodes: article.querySelectorAll('.katex').length,
          katexStyleAttr: !!article.querySelector('.katex [style]'),
          mermaidSvg: article.querySelectorAll('.bm-diagram svg').length,
          mermaidNodes: article.querySelectorAll('pre.mermaid').length,
          progressWidth: style(document.getElementById('progress-bar'), 'width'),
          overflowX: article.scrollWidth > article.clientWidth,
          errors,
        };
        document.body.innerHTML = '<pre id="diag">' + JSON.stringify(diag, null, 2).replace(/</g, '&lt;') + '</pre>';
        document.body.style.overflow = 'auto';
        document.body.style.height = 'auto';
      }, 2500);
    }
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('mock written to /tmp/mock/index.html');
