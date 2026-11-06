# Changelog

## 0.2.0 — 2026-11-06

Live editing, image assets and a first-class development loop.

- **Live edit mode (Obsidian-style)** — click any block in the preview and edit it in
  place. Typos are fixed without leaving the rendered view; paragraphs, headings,
  lists, tables, callouts, code fences, math and diagrams all round-trip back to
  Markdown and are written into the file as you type.
- Editing niceties inside the preview: `⌘B` / `⌘I` / `⌘E` wrap the selection,
  `Enter` splits a paragraph, `Tab` moves between table cells, `Esc` leaves the block,
  and edits are deferred while a block has focus so the caret never jumps.
- **Drag & drop images** — drop or paste an image onto the preview (or drop a file on a
  Markdown editor) and it is copied into `_assets` next to the document, creating the
  folder when needed, then referenced with a relative path. Duplicate names are
  suffixed instead of overwritten. `Buity Markdown: Insert Image…` does the same from
  the command palette, and `buityMarkdown.imageFolder` changes the folder name.
- Footnote sections are read-only in live edit so definitions can never be dropped.
- Reading position is preserved by source line when the document re-renders.
- **F5 development** — `.vscode/launch.json` (four extension-host targets, including a
  watch target that auto-opens the showcase) and `.vscode/tasks.json` with build,
  watch, typecheck and package tasks.
- Three test suites: serialiser round-trip (jsdom), extension host (stubbed VS Code
  API) and a real headless-Chrome live editing session — `npm test` /
  `npm run test:browser`.

## 0.1.0 — 2026-11-06

First release.

- Live preview panel with outline sidebar, reading progress and two-way scroll sync
- Three looks: auto (follows the VS Code theme), paper, midnight; adjustable text size,
  line height and reading-width presets
- Editorial design system for both the live panel and the built-in VS Code preview
- Callouts: `::: tip` fenced containers and GitHub `> [!NOTE]` alerts
- KaTeX math (bundled fonts), Mermaid diagrams (bundled, lazily loaded)
- Syntax highlighting with copy buttons, clickable task list items that write back to the source
- Footnotes, `==highlight==`, `<kbd>`, details/summary, tables, relative images
- Standalone HTML export with images embedded as data URIs
- Editor commands and snippets for callouts, tables, diagrams, math and code blocks
- Word count and reading time in the status bar
