# Buity Markdown

**A calm, editorial place to write Markdown in VS Code.**

Buity Markdown is an editor + live preview for people who actually *read* what they write.
Warm typography, a real outline, scroll that stays in sync, callouts, math, diagrams and a
one-click export — all offline, all local.

![Buity Markdown — paper theme](docs/preview-paper.png)

---

## Why another Markdown preview?

Because the default one is a technical document renderer, not a reading experience. Buity adds:

- **An opinionated page** — warm paper / midnight palettes, a measured column width,
  optical heading scale, hanging anchors, animated underlines.
- **A live preview panel** with its own toolbar: theme switch, text size, outline,
  reading progress, and "back to top".
- **Two-way scroll sync** — scroll either side and the other follows, anchored by source lines.
- **Components that belong together** — callouts, math, diagrams, tables, code with copy buttons,
  task lists that write back to your file.
- **A standalone HTML export** with images embedded as data URIs, so a single file is shareable.

## The live preview

| Paper | Midnight |
| --- | --- |
| ![paper](docs/preview-paper.png) | ![midnight](docs/preview-midnight.png) |

Open it with <kbd>⌘</kbd><kbd>K</kbd> <kbd>B</kbd> (<kbd>Ctrl</kbd><kbd>K</kbd> <kbd>B</kbd> on Windows/Linux),
the preview button in the editor title bar, or **Buity Markdown: Open Preview to the Side**.

Inside the panel:

- **Outline** — a live table of contents, indented by heading depth, with the current
  section highlighted as you scroll. Click to jump; the editor follows.
- **Auto / Paper / Night** — three looks, remembered in your settings.
- **A− / A+** — step the text size without touching the settings file.
- **⤓** — export a standalone HTML file.
- Code blocks and diagrams get a **Copy** button on hover.
- Task list checkboxes are clickable and update the Markdown source.
- Clicking a link opens it: external URLs in your browser, local files in the editor.

## Typography and components

Everything below is rendered by Buity in both the live panel **and** the built-in VS Code preview.

### Callouts

```markdown
::: tip Write first, format later
Markdown should never get in the way of thinking.
:::

::: warning Careful here
The `::: caution` variant uses ember red.
:::
```

Supported types: `note`, `tip`, `important`, `warning`, `caution`, `example`, `quote`
(aliases such as `info`, `warn`, `danger`, `success` also work).

GitHub alerts are converted into the same component:

```markdown
> [!NOTE]
> GitHub alerts look native here too.
```

### Math

Inline `$e^{i\pi} + 1 = 0$` and display math:

```markdown
$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$
```

Powered by KaTeX with bundled fonts — no network required.

### Diagrams

````markdown
```mermaid
flowchart LR
  A[Idea] --> B[Draft]
  B --> C{Good?}
  C -->|Yes| D[Publish]
  C -->|No| B
```
````

Mermaid is bundled and loaded lazily, only when a document actually contains a diagram.

### Also supported

`==highlight==`, `~~strikethrough~~`, footnotes, task lists, `<details>` collapsibles,
`<kbd>` keys, tables, and relative images (resolved against the file you are editing, so
`./screenshots/a.png` just works).

## Editing commands

| Command | Default shortcut |
| --- | --- |
| Open Preview to the Side | <kbd>⌘</kbd><kbd>K</kbd> <kbd>B</kbd> / <kbd>Ctrl</kbd><kbd>K</kbd> <kbd>B</kbd> |
| Export as Standalone HTML | <kbd>⌘</kbd><kbd>⌥</kbd><kbd>E</kbd> / <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>E</kbd> |

Plus formatting commands in the palette and the editor context menu: toggle bold / italic /
strikethrough / inline code / highlight, insert or remove a link, cycle heading level,
insert a callout, table, diagram, math block or fenced code block.

**Snippets** are included: type `callout`, `mermaid`, `table`, `math`, `details`, `frontmatter`,
`figure` or `tasks` in a Markdown file.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `buityMarkdown.theme` | `auto` | `auto`, `paper` or `midnight` |
| `buityMarkdown.fontSize` | `16` | Base text size (px) |
| `buityMarkdown.lineHeight` | `1.75` | Leading |
| `buityMarkdown.width` | `comfortable` | `narrow` / `comfortable` / `wide` / `full` |
| `buityMarkdown.showOutline` | `true` | Outline sidebar in the panel |
| `buityMarkdown.syncScroll` | `true` | Two-way scroll sync |
| `buityMarkdown.mermaid` | `true` | Render Mermaid diagrams |
| `buityMarkdown.math` | `true` | Render TeX math |
| `buityMarkdown.callouts` | `true` | Callouts in the built-in preview |
| `buityMarkdown.wordCount` | `true` | Word count in the status bar |
| `buityMarkdown.readingTime` | `true` | Estimated reading time |

## 中文速览

**Buity Markdown** 是一个「好看优先」的 Markdown 编辑与实时预览插件：

- `⌘K B` 打开侧边实时预览，自带大纲、阅读进度、双向滚动同步。
- 三套配色（跟随主题 / 暖纸 / 深夜），可调字号、行高与正文宽度。
- 支持 `:::` 提示块、GitHub 风格 `> [!NOTE]`、KaTeX 公式、Mermaid 图表、代码复制按钮、
  可勾选的任务清单（会直接写回源文件）。
- 内置预览（VS Code 默认预览）也会被美化，无需安装额外主题。
- 一键导出单文件 HTML，图片自动内嵌为 base64，方便分享。

## Development

```bash
npm install
npm run build          # bundle extension + webview, copy fonts & mermaid
npm run typecheck
npx vsce package       # build the .vsix
```

Source layout: `src/engine.ts` (markdown-it pipeline + sanitising), `src/preview.ts`
(webview panel and sync), `src/format.ts` (editor commands), `src/export.ts`,
`webview/main.ts` (preview client), `media/buity.css` (the design system).

## License

MIT © Buity
