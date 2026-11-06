# Changelog

## 0.2.2 — 2026-11-06

Title-bar buttons were invisible or dead-clicking. Three separate causes, all fixed:

- **Icons were painted as raw `background-image` with no theme tinting.** A path-based command
  icon is not recoloured by VS Code (unlike a codicon), so the black-on-black 0.2.1 artwork
  disappeared on dark title bars and looked like the Buity button had been removed. Both buttons
  now ship proper light/dark artwork (`media/preview-inplace-*.svg`, `media/preview-side-*.svg`)
  and the designs are distinguishable at 16 px: single page = in place, page + pane = to the side.
- **"Open Buity Preview" opened beside instead of in the current column.** It now targets
  `ViewColumn.Active`, so the title bar has two genuinely different actions again.
- **Title-bar clicks are now argument-aware.** A tab's button passes the tab URI and may run with
  no `activeTextEditor`; the command resolves the document from that URI (falling back to the
  active editor, then to any visible Markdown editor) instead of silently bailing out.
  Command failures are surfaced through an error notification and the log rather than dying quietly.
- **`package.json` had a stray top-level `keybindings` block** (schema violation) which shadowed the
  real one: `⌘⌥E` ran *Export HTML* instead of *Toggle Live Edit*. The manifest is clean again and
  the shortcuts are: `⌘K B` side preview, `⌘⌥E` live edit, `⌘⌥I` insert image, `⌘⌥H` export HTML.
- Both preview commands are contributed to `editor/title` and `activationEvents` now lists every
  command, so a window reload cannot leave the buttons unregistered.

## 0.2.1 — 2026-11-06

- New Buity icon: the editor title-bar button and the preview panel tab now use a page-with-accent-rule
  mark instead of the generic `$(preview)` codicon (which is what VS Code's own "Open as Preview" uses),
  so the Buity entry is no longer mistaken for the built-in one. The panel tab icon has light/dark
  variants.
- The title-bar button is placed after the built-in Markdown preview buttons (`navigation@3`).

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
