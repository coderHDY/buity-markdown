/**
 * DOM -> Markdown serialisation used by the live editing mode.
 *
 * Every rendered block carries `data-line-start` / `data-line-end` (1-based,
 * inclusive). After the user edits a block in the preview we serialise the
 * block back into Markdown and replace exactly those source lines, which keeps
 * the file the single source of truth.
 */

export interface BlockEdit {
  start: number;
  end: number;
  text: string;
}

const EOL = '\n';

function attr(el: Element, name: string): string {
  return el.getAttribute(name) || '';
}

function textOf(el: Element): string {
  return (el.textContent || '').replace(/\u00a0/g, ' ');
}

function tidy(value: string): string {
  return value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function escapeTable(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

function normalizeHref(href: string): string {
  const value = href.trim();
  if (!value) return '';
  return value;
}

/* --------------------------------------------------------------- inline */

export function inlineToMarkdown(node: Node): string {
  if (node.nodeType === 3 /* text */) {
    return (node.nodeValue || '').replace(/\u00a0/g, ' ');
  }
  if (node.nodeType !== 1) return '';

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = () =>
    Array.from(el.childNodes)
      .filter((child) => !(child.nodeType === 1 && (child as Element).classList.contains('bm-anchor')))
      .map((child) => inlineToMarkdown(child))
      .join('');

  switch (tag) {
    case 'br':
      return '\n';
    case 'script':
    case 'style':
    case 'input':
      return '';
    case 'strong':
    case 'b': {
      const inner = tidy(children());
      return inner ? `**${inner}**` : '';
    }
    case 'em':
    case 'i': {
      const inner = tidy(children());
      return inner ? `*${inner}*` : '';
    }
    case 'del':
    case 's':
    case 'strike': {
      const inner = tidy(children());
      return inner ? `~~${inner}~~` : '';
    }
    case 'mark': {
      const inner = tidy(children());
      return inner ? `==${inner}==` : '';
    }
    case 'code': {
      const inner = el.textContent || '';
      if (!inner) return '';
      const fence = inner.includes('`') ? '``' : '`';
      return `${fence}${inner}${fence}`;
    }
    case 'a': {
      const inner = tidy(children());
      const href = normalizeHref(attr(el, 'href'));
      if (!inner) return '';
      if (!href) return inner;
      return `[${inner}](${href})`;
    }
    case 'img': {
      const src = attr(el, 'data-src') || attr(el, 'src');
      const alt = attr(el, 'alt');
      return `![${alt}](${src})`;
    }
    case 'kbd':
      return `<kbd>${tidy(children())}</kbd>`;
    case 'sup':
      if (el.classList.contains('footnote-ref')) {
        const link = el.querySelector('a');
        const id = link?.getAttribute('id') || '';
        const label = id.replace(/^fnref/, '') || (link?.textContent || '').replace(/[^\w-]/g, '');
        return label ? `[^${label}]` : '';
      }
      return `<sup>${tidy(children())}</sup>`;
    case 'sub':
      return `<sub>${tidy(children())}</sub>`;
    case 'u':
    case 'ins':
    case 'abbr':
      return el.outerHTML;
    case 'span': {
      // KaTeX keeps the original TeX in data-tex.
      if (el.classList.contains('katex')) {
        const host = el.closest<HTMLElement>('[data-tex]');
        const tex = (host && host.getAttribute('data-tex')) || el.getAttribute('data-tex');
        return tex ? `$${tex}$` : '';
      }
      if (el.classList.contains('bm-callout-dot')) return '';
      if (el.classList.contains('footnote-ref') || el.classList.contains('footnote-backref')) {
        return children();
      }
      return children();
    }
    case 'div':
    case 'p':
    case 'li':
      return `\n${children()}\n`;
    default:
      return children();
  }
}

function inlineChildrenToMarkdown(el: Element): string {
  const text = Array.from(el.childNodes)
    .filter((child) => !(child.nodeType === 1 && (child as Element).classList.contains('bm-anchor')))
    .map((child) => inlineToMarkdown(child))
    .join('');
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------------------------------------------------------- lists */

function listToMarkdown(list: Element, depth = 0): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const startAttr = Number(list.getAttribute('start') || '1');
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  items.forEach((item, index) => {
    const isTask = item.classList.contains('task-list-item');
    const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const marker = ordered ? `${startAttr + index}.` : '-';
    const prefix = isTask ? `${indent}${marker} [${checkbox?.checked ? 'x' : ' '}]` : `${indent}${marker}`;

    const nested: string[] = [];
    const inlineNodes: Node[] = [];
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === 1) {
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') {
          nested.push(listToMarkdown(el, depth + 1));
          continue;
        }
        if (tag === 'input') continue;
        if (tag === 'p') {
          inlineNodes.push(...Array.from(el.childNodes));
          continue;
        }
      }
      inlineNodes.push(child);
    }

    const body = inlineNodes
      .map((node) => inlineToMarkdown(node))
      .join('')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(`\n${indent}  `);

    lines.push(body ? `${prefix} ${body}` : prefix);
    for (const block of nested) {
      if (block.trim()) lines.push(block);
    }
  });

  return lines.join(EOL);
}

/* --------------------------------------------------------------- tables */

function alignmentOf(cell: Element): 'left' | 'center' | 'right' | '' {
  const style = (cell.getAttribute('style') || '').toLowerCase();
  const attrAlign = (cell.getAttribute('align') || '').toLowerCase();
  const value = /text-align\s*:\s*(left|center|right)/.exec(style)?.[1] || attrAlign;
  if (value === 'center' || value === 'right' || value === 'left') return value as any;
  return '';
}

function tableToMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return '';
  const cells = rows.map((row) => Array.from(row.children) as Element[]);
  const width = Math.max(...cells.map((row) => row.length));
  if (!width) return '';

  const header = cells[0];
  const aligns = Array.from({ length: width }, (_, i) => alignmentOf(header[i] || header[0] || document.createElement('th')));

  const renderRow = (row: Element[]) =>
    `| ${Array.from({ length: width }, (_, i) => escapeTable(row[i] ? inlineChildrenToMarkdown(row[i]) : '')).join(' | ')} |`;

  const divider = `| ${aligns
    .map((align) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'))
    .join(' | ')} |`;

  const body = cells.slice(1).map(renderRow);
  return [renderRow(header), divider, ...body].join(EOL);
}

/* --------------------------------------------------------------- blocks */

function codeBlockToMarkdown(el: Element): string {
  const lang = tidy(textOf(el.querySelector('.bm-lang') || el)).toLowerCase();
  const code = el.querySelector('pre code') || el.querySelector('pre');
  const raw = (code?.textContent || '').replace(/\n+$/, '');
  const fence = raw.includes('```') ? '````' : '```';
  return `${fence}${lang === 'text' ? '' : lang}${EOL}${raw}${EOL}${fence}`;
}

function diagramToMarkdown(el: Element): string {
  const lang = attr(el, 'data-lang') || 'mermaid';
  const raw = (attr(el, 'data-src') || el.querySelector('pre.mermaid')?.getAttribute('data-src') || '').replace(/\n+$/, '');
  return `\`\`\`${lang}${EOL}${raw}${EOL}\`\`\``;
}

function mathToMarkdown(el: Element): string {
  const tex = attr(el, 'data-tex');
  return `$$${EOL}${tex}${EOL}$$`;
}

function calloutToMarkdown(el: Element): string {
  const type = attr(el, 'data-callout') || 'note';
  const title = attr(el, 'data-callout-title');
  const alert = attr(el, 'data-callout-syntax') === 'alert';
  const body = Array.from(el.children)
    .filter((child) => !child.classList.contains('bm-callout-title'))
    .map((child) => blockToMarkdown(child) ?? '')
    .filter((block) => block.trim())
    .join('\n\n');

  if (alert) {
    const head = `> [!${type.toUpperCase()}]${title ? ` ${title}` : ''}`;
    const spacer = /^([-*+]|\d+\.|\||:{3})/.test(body) ? '>' : '';
    const quoted = body
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n');
    return [head, spacer, quoted].filter((line) => line !== '').join('\n');
  }

  const head = title ? `::: ${type} ${title}` : `::: ${type}`;
  const spacer = /^([-*+]|\d+\.|\||:{3})/.test(body) ? '\n' : '';
  return `${head}\n${spacer}${body}\n:::`;
}

function blockquoteToMarkdown(el: Element): string {
  const body = Array.from(el.children)
    .map((child) => blockToMarkdown(child) ?? '')
    .filter((block) => block.trim())
    .join('\n\n');
  return body
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function headingToMarkdown(el: Element): string {
  const level = Number(el.tagName[1]) || 1;
  const text = inlineChildrenToMarkdown(el).replace(/\n+/g, ' ');
  return `${'#'.repeat(level)} ${text}`;
}

export function blockToMarkdown(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (el.classList.contains('bm-callout')) return calloutToMarkdown(el);
  if (el.classList.contains('bm-table-wrap') || tag === 'table') {
    return tableToMarkdown(tag === 'table' ? el : el.querySelector('table') || el);
  }
  if (el.classList.contains('bm-code')) return codeBlockToMarkdown(el);
  if (el.classList.contains('bm-diagram')) return diagramToMarkdown(el);
  if (el.classList.contains('bm-math-block')) return mathToMarkdown(el);
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    return headingToMarkdown(el);
  }
  if (tag === 'ul' || tag === 'ol') return listToMarkdown(el);
  if (tag === 'blockquote') return blockquoteToMarkdown(el);
  if (tag === 'hr') return '---';
  if (tag === 'p') {
    const text = inlineChildrenToMarkdown(el);
    return text || null;
  }
  if (el.classList.contains('footnotes')) return null;
  if (tag === 'div' || tag === 'figure' || tag === 'details' || tag === 'section') {
    const inner = Array.from(el.children)
      .map((child) => blockToMarkdown(child))
      .filter((block): block is string => Boolean(block && block.trim()))
      .join('\n\n');
    if (inner) return inner;
    const html = el.innerHTML.trim();
    return html || null;
  }
  if (tag === 'pre') {
    const raw = (el.textContent || '').replace(/\n+$/, '');
    return `\`\`\`${EOL}${raw}${EOL}\`\`\``;
  }
  // unknown block: keep the text so nothing is silently dropped
  const text = inlineChildrenToMarkdown(el);
  return text || null;
}

export function serializeBlock(el: Element): BlockEdit | null {
  const startRaw = el.getAttribute('data-line-start');
  const endRaw = el.getAttribute('data-line-end');
  if (!startRaw) return null;
  const start = Number(startRaw);
  const end = Number(endRaw || startRaw);
  if (!Number.isFinite(start)) return null;
  const text = blockToMarkdown(el);
  if (text === null) return null;
  const normalized = text.replace(/[ \t]+$/gm, '');
  return { start, end: Number.isFinite(end) ? end : start, text: normalized };
}
