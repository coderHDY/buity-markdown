import { createEngine } from '../src/engine';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();

const sample = `# Buity Markdown

A quiet, editorial place to write. **Bold** ideas, *soft* emphasis, \`inline code\`,
~~struck text~~ and ==highlighted== words. Read more on [the docs](https://example.com).

## Why another preview?

Because reading should feel good. This paragraph exists to show the leading, the measure
and the rhythm of the text: thirty-five to forty characters per line, generous space
between paragraphs, and a warm neutral palette that never fights the content.

### Callouts

::: tip Write first, format later
Markdown should never get in the way of thinking.
:::

::: warning Careful here
The \`::: caution\` variant uses an ember red, and both work in the built-in preview.
:::

> [!NOTE]
> GitHub alerts are converted into the same beautiful component.

> A plain blockquote still works, with a serif quote mark and a soft tint.

### Lists and tasks

- A first point, with enough words to wrap onto a second line and show the hanging indent.
- A second point
  - Nested detail
  - Another nested detail
- [x] Ship the extension
- [ ] Write more documentation

### Code

\`\`\`typescript
export function greet(name: string): string {
  // a warm palette handles comments gracefully
  return \`Hello, \${name}!\`;
}
\`\`\`

### Math

Inline math like $e^{i\\pi} + 1 = 0$ sits nicely in a sentence.

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}
$$

### Table

| Feature | Built-in | Buity |
| --- | --- | --- |
| Custom themes | — | Paper, Midnight |
| Outline | — | Live |
| Math | plugin | bundled |
| Diagrams | plugin | bundled |

### Diagram

\`\`\`mermaid
flowchart LR
  A[Idea] --> B[Draft]
  B --> C{Good?}
  C -->|Yes| D[Publish]
  C -->|No| B
\`\`\`

---

<details>
<summary>A collapsible section</summary>

Hidden content, revealed on demand. Press <kbd>⌘</kbd> + <kbd>K</kbd> to do things.

</details>

Footnote reference.[^1]

[^1]: The footnote, quietly waiting at the bottom.
`;

const engine = createEngine({ math: true, callouts: true, highlight: true, mermaid: true });
const result = engine.render(sample);

const checks: [string, boolean][] = [
  ['callout div', result.html.includes('bm-callout-tip')],
  ['github alert', result.html.includes('bm-callout-note')],
  ['math rendered', result.html.includes('class="katex"')],
  ['math styles survive sanitizer', /class="katex"[\s\S]{0,400}style=/.test(result.html)],
  ['mermaid block', result.html.includes('<pre class="mermaid">')],
  ['table wrapper', result.html.includes('bm-table-wrap')],
  ['data-line', result.html.includes('data-line=')],
  ['task list', result.html.includes('task-list-item')],
  ['footnote', result.html.includes('footnotes')],
  ['mark', result.html.includes('<mark>')],
  ['anchor', result.html.includes('bm-anchor')],
  ['no data-line on closing', !/<\/[a-z0-9]+ data-line/.test(result.html)],
];

for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
console.log('headings:', result.headings.map((h) => `${h.level}:${h.text}#${h.id}`).join(' | '));
console.log('words:', result.words, 'chars:', result.chars, 'min:', result.readingMinutes);

console.log('\n--- katex sample ---');
const idx = result.html.indexOf('class="katex"');
console.log(result.html.slice(Math.max(0, idx - 60), idx + 700));

const css = fs.readFileSync(path.join(repo, 'media/buity.css'), 'utf8');
const katexCss = fs.readFileSync(path.join(repo, 'media/katex.css'), 'utf8').replace(
  /url\(fonts\//g,
  'url(https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/',
);

function page(theme: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" as="script">
<style>${katexCss}</style>
<style>${css}</style>
<style>body{background:var(--bm-bg)}</style>
</head>
<body class="vscode-body bm-interactive vscode-light" data-bm-theme="${theme}">
${result.html}
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'${theme === 'paper' ? 'default' : 'dark'}'});</script>
</body></html>`;
}

fs.writeFileSync('/tmp/buity-paper.html', page('paper'));
fs.writeFileSync('/tmp/buity-midnight.html', page('midnight'));
console.log('\nwrote /tmp/buity-paper.html and /tmp/buity-midnight.html');
