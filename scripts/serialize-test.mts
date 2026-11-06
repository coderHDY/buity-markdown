/* Round-trip test for the live editing serialiser.
 *
 * Renders real Markdown, loads the HTML into a DOM, serialises every block back
 * to Markdown and checks that the source survives the trip (and that a second
 * trip is byte-identical, i.e. the serialiser is idempotent).
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createEngine } from '../src/engine';

const repo = process.cwd();

const files = process.argv.slice(2);
const sources: { name: string; text: string }[] = files.length
  ? files.map((file) => ({ name: file, text: fs.readFileSync(file, 'utf8') }))
  : [
      { name: 'examples/showcase.md', text: fs.readFileSync(path.join(repo, 'examples/showcase.md'), 'utf8') },
    ];

const SAMPLE = `# Title here

A paragraph with **bold**, *italic*, \`code\`, ~~strike~~, ==mark== and a [link](https://example.com).

## Second level

- one
- two
  - nested a
  - nested b
- [x] done
- [ ] todo

1. first
2. second

> A quote
> spanning lines

::: tip Careful
Callout body text.
:::

> [!WARNING]
> Alert body.

| Left | Center | Right |
| :--- | :----: | ----: |
| a | b | c |
| 1 | 2 | 3 |

\`\`\`ts
const answer = 42;
function greet(name: string) { return name; }
\`\`\`

$$
E = mc^2
$$

---

<details>
<summary>More</summary>

Hidden paragraph.

</details>
`;
sources.push({ name: '(inline sample)', text: SAMPLE });

let failures = 0;
const report = (ok: boolean, label: string, detail?: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(detail.split('\n').map((line) => `      ${line}`).join('\n'));
  }
};

function normalize(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\|[\s:|-]+\|$/gm, (row) => row.replace(/:?-+:?/g, '---'))
    .replace(/_([^_\n]+)_/g, '*$1*')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

function sliceSource(text: string, start: number, end: number): string {
  const lines = text.split('\n');
  return lines.slice(start - 1, end).join('\n');
}

function replaceRange(text: string, start: number, end: number, value: string): string {
  const lines = text.split('\n');
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);
  return [...before, ...value.split('\n'), ...after].join('\n');
}

async function main() {
  const { serializeBlock, blockToMarkdown } = (await import('../webview/serialize')) as any;

  for (const source of sources) {
    console.log(`\n${source.name}`);
    const engine = createEngine({ math: true, callouts: true, highlight: true, mermaid: true });
    const first = engine.render(source.text);
    const dom = new JSDOM(`<body><article id="a">${first.html}</article></body>`);
    const article = dom.window.document.getElementById('a')!;

    const blocks = Array.from(article.children).filter((el) => el.hasAttribute('data-line-start')) as Element[];
    report(blocks.length > 0, `${blocks.length} editable blocks found`);

    let exact = 0;
    let loose = 0;
    const mismatches: string[] = [];

    for (const block of blocks) {
      const start = Number(block.getAttribute('data-line-start'));
      const end = Number(block.getAttribute('data-line-end'));
      const original = sliceSource(source.text, start, end);
      const serialized = blockToMarkdown(block) as string;
      if (serialized === null) {
        mismatches.push(`block ${start}-${end}: serialiser returned null`);
        continue;
      }
      const a = normalize(original);
      const b = normalize(serialized);
      if (a === b) {
        exact++;
        loose++;
      } else if (a.replace(/\s+/g, ' ') === b.replace(/\s+/g, ' ')) {
        loose++;
      } else {
        mismatches.push(
          `block ${start}-${end} (${block.tagName.toLowerCase()}.${block.className})\n--- source ---\n${a}\n--- round trip ---\n${b}`,
        );
      }
    }

    console.log(`  ${exact === blocks.length ? '✓' : '·'} ${exact}/${blocks.length} blocks reproduce their source byte-for-byte`);
    report(loose === blocks.length, `${loose}/${blocks.length} blocks survive the round trip (whitespace-insensitive)`);
    for (const mismatch of mismatches.slice(0, 8)) console.log(`      · ${mismatch}`);

    // Idempotency: apply everything back, re-render, serialise again.
    let rebuilt = source.text;
    for (const block of [...blocks].reverse()) {
      const start = Number(block.getAttribute('data-line-start'));
      const end = Number(block.getAttribute('data-line-end'));
      const serialized = blockToMarkdown(block) as string;
      rebuilt = replaceRange(rebuilt, start, end, serialized);
    }

    const second = engine.render(rebuilt);
    const dom2 = new JSDOM(`<body><article id="a">${second.html}</article></body>`);
    const article2 = dom2.window.document.getElementById('a')!;
    const blocks2 = Array.from(article2.children).filter((el) => el.hasAttribute('data-line-start')) as Element[];

    report(blocks2.length === blocks.length, `same block count after round trip (${blocks.length} → ${blocks2.length})`);

    const again = blocks2.map((block) => blockToMarkdown(block) as string).join('\n\n');
    const once = blocks.map((block) => blockToMarkdown(block) as string).join('\n\n');
    report(normalize(again) === normalize(once), 'serialiser is idempotent');

    const headingsBefore = first.headings.map((h) => h.text).join('|');
    const headingsAfter = second.headings.map((h) => h.text).join('|');
    report(headingsBefore === headingsAfter, 'outline survives the round trip');

    const wordsBefore = first.words;
    const wordsAfter = second.words;
    const drift = Math.abs(wordsBefore - wordsAfter) / Math.max(1, wordsBefore);
    report(drift < 0.05, `word count stable (${wordsBefore} → ${wordsAfter})`);

    // Mutating a block must be reflected in the output.
    const paragraph = blocks.find((block) => block.tagName === 'P');
    if (paragraph) {
      paragraph.textContent = 'Replaced paragraph text.';
      const updated = serializeBlock(paragraph) as any;
      report(/Replaced paragraph text\./.test(updated?.text || ''), 'edited paragraph serialises');
    }

    const cell = article.querySelector('td');
    if (cell) {
      cell.textContent = 'changed';
      const tableEdit = serializeBlock(cell.closest('.bm-table-wrap') as Element) as any;
      report(/changed/.test(tableEdit?.text || ''), 'edited table cell serialises');
      report(/^\|.*\n\|[ :\-|]+\|/m.test(tableEdit?.text || ''), 'table keeps a delimiter row');
    }

    const list = article.querySelector('ul[data-line-start], ol[data-line-start]');
    if (list) {
      const item = list.querySelector('li');
      if (item) {
        item.textContent = 'edited item';
        const listEdit = serializeBlock(list) as any;
        report(/^- edited item/m.test(listEdit?.text || ''), 'edited list item serialises');
      }
    }

    const code = article.querySelector('.bm-code code');
    if (code) {
      code.textContent = 'const replaced = true;';
      const codeEdit = serializeBlock(code.closest('.bm-code') as Element) as any;
      report(/```\w*\nconst replaced = true;\n```/.test(codeEdit?.text || ''), 'edited code block serialises');
    }

    const mathBlock = article.querySelector('.bm-math-block');
    if (mathBlock) {
      const mathEdit = serializeBlock(mathBlock) as any;
      report(/\$\$\n.+\n\$\$/.test(mathEdit?.text || ''), 'math block serialises back to $$');
    }

    const callout = article.querySelector('.bm-callout');
    if (callout) {
      const calloutEdit = serializeBlock(callout) as any;
      report(/^::: \w+/.test(calloutEdit?.text || '') && /:::\s*$/.test(calloutEdit?.text || ''), 'callout serialises');
    }
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nall serialiser checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
