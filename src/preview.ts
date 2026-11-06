import * as vscode from 'vscode';
import { createEngine, Engine, RenderResult } from './engine';
import { BuityConfig, readConfig, themeKind } from './config';
import { ASSET_DIR, saveAssetBeside } from './assets';
import { log } from './log';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function isRemote(src: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)/i.test(src);
}

export class BuityPreview {
  private static readonly panels = new Map<string, BuityPreview>();

  private readonly disposables: vscode.Disposable[] = [];
  private readonly docUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private engine: Engine;
  private ready = false;
  private disposed = false;
  private loggedRender = false;
  private loggedDiagrams = false;
  private renderTimer: NodeJS.Timeout | undefined;
  private lastOutgoingScroll = 0;
  private lastIncomingScroll = 0;
  private lastResult: RenderResult | undefined;
  private config: BuityConfig;

  static show(context: vscode.ExtensionContext, document: vscode.TextDocument, viewColumn: vscode.ViewColumn): BuityPreview {
    const key = document.uri.toString();
    const existing = BuityPreview.panels.get(key);
    if (existing) {
      existing.panel.reveal(viewColumn, true);
      existing.scheduleRender(0);
      return existing;
    }
    const preview = new BuityPreview(context, document, viewColumn);
    BuityPreview.panels.set(key, preview);
    return preview;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: vscode.TextDocument,
    viewColumn: vscode.ViewColumn,
  ) {
    this.docUri = document.uri;
    this.config = readConfig();
    this.engine = this.createEngine();

    this.panel = vscode.window.createWebviewPanel(
      'buityMarkdown.preview',
      `Preview  ·  ${document.uri.path.split('/').pop()}`,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(document.uri, '..'),
          ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
        ],
      },
    );
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'panel-icon-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'panel-icon-dark.svg'),
    };
    this.panel.webview.html = this.buildHtml();
    log().info(`preview panel created for ${document.uri.toString()}`);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => void this.onMessage(message), null, this.disposables);

    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.toString() !== this.docUri.toString()) return;
        this.scheduleRender(140);
      },
      null,
      this.disposables,
    );

    vscode.window.onDidChangeTextEditorVisibleRanges(
      (event) => this.onVisibleRanges(event),
      null,
      this.disposables,
    );

    vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (!event.affectsConfiguration('buityMarkdown')) return;
        this.config = readConfig();
        this.engine = this.createEngine();
        this.postConfig(true);
        this.scheduleRender(0);
      },
      null,
      this.disposables,
    );

    vscode.window.onDidChangeActiveColorTheme(
      () => this.postConfig(false),
      null,
      this.disposables,
    );
  }

  private createEngine(): Engine {
    return createEngine({
      math: this.config.math,
      callouts: this.config.callouts,
      highlight: true,
      mermaid: this.config.mermaid,
      resolveImage: (src) => this.resolveImage(src),
    });
  }

  private resolveImage(src: string): string {
    if (!src || isRemote(src) || src.startsWith('#')) return src;
    if (this.docUri.scheme !== 'file') return src;
    try {
      const clean = decodeURI(src.split('?')[0]);
      const resource = clean.startsWith('/')
        ? vscode.Uri.file(clean)
        : vscode.Uri.joinPath(vscode.Uri.joinPath(this.docUri, '..'), clean.replace(/^\.\//, ''));
      return this.panel.webview.asWebviewUri(resource).toString();
    } catch {
      return src;
    }
  }

  /* ------------------------------------------------------------- rendering */

  private scheduleRender(delay: number) {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), delay);
  }

  private render() {
    if (!this.ready) return;
    try {
      const result = this.engine.render(this.document.getText());
      this.lastResult = result;
      this.panel.title = `Preview  ·  ${this.document.uri.path.split('/').pop()}`;
      void this.panel.webview.postMessage({
        type: 'update',
        html: result.html,
        headings: result.headings,
        hasDiagram: result.hasDiagram,
        stats: {
          words: result.words,
          chars: result.chars,
          readingMinutes: this.config.readingTime ? result.readingMinutes : 0,
        },
        title: this.document.uri.path.split('/').pop() || 'Preview',
      });
    } catch (error) {
      log().error(`render failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    }
  }

  /* -------------------------------------------------------------- messages */

  private async onMessage(message: any) {
    switch (message?.type) {
      case 'ready':
        this.ready = true;
        log().info('webview ready');
        await this.panel.webview.postMessage({
          type: 'init',
          config: this.config,
          themeKind: themeKind(),
          mermaidUri: this.panel.webview
            .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mermaid.min.js'))
            .toString(),
        });
        this.render();
        break;

      case 'scroll':
        this.revealLine(Number(message.line), true);
        break;

      case 'revealLine':
        this.revealLine(Number(message.line), false);
        break;

      case 'openLink':
        await this.openLink(String(message.href));
        break;

      case 'toggleTask':
        await this.toggleTask(Number(message.line), Boolean(message.checked));
        break;

      case 'export':
        await vscode.commands.executeCommand('buityMarkdown.exportHtml', this.docUri);
        break;

      case 'setConfig':
        await this.persistConfig(message.patch || {});
        break;

      case 'applyEdit':
        await this.applySourceEdit(Number(message.start), Number(message.end), String(message.text ?? ''));
        break;

      case 'attachImage':
        await this.attachImage(String(message.name || 'image.png'), String(message.data || ''), String(message.mime || ''), Number(message.line) || 0);
        break;

      case 'rendered':
        if (message.nodes === 0) {
          if (!this.loggedDiagrams && message.diagrams > 0) {
            this.loggedDiagrams = true;
            log().info(`diagram engine ok: ${message.diagrams} diagram(s) rendered`);
          }
        } else if (!this.loggedRender) {
          this.loggedRender = true;
          log().info(
            `rendered: ${message.nodes} nodes, ${message.headings} headings, ${message.katex} math, ${message.diagrams} diagrams`,
          );
        }
        break;

      case 'error':
        log().error(`webview error: ${String(message.message).slice(0, 800)}`);
        break;
    }
  }

  private async persistConfig(patch: Record<string, unknown>) {
    const config = vscode.workspace.getConfiguration('buityMarkdown');
    for (const [key, value] of Object.entries(patch)) {
      if (['theme', 'fontSize', 'lineHeight', 'width', 'showOutline', 'syncScroll', 'liveEdit'].includes(key)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }
  }

  /* --------------------------------------------------------- live editing */

  private async applySourceEdit(start: number, end: number, text: string) {
    const document = this.document;
    const lineCount = document.lineCount;
    const from = Math.min(Math.max(0, start - 1), Math.max(0, lineCount - 1));
    const to = Math.min(Math.max(from, end - 1), Math.max(0, lineCount - 1));
    const range = new vscode.Range(from, 0, to, document.lineAt(to).text.length);
    const current = document.getText(range);
    if (current === text) return;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.docUri, range, text);
    try {
      await vscode.workspace.applyEdit(edit);
    } catch (error) {
      log().error(`applyEdit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async attachImage(name: string, base64: string, mime: string, line: number) {
    try {
      const data = Buffer.from(base64, 'base64');
      const saved = await saveAssetBeside(this.docUri, name, new Uint8Array(data), mime);
      const alt = saved.name.replace(/\.[^.]+$/, '');
      const markdown = `\n\n![${alt}](${saved.relative})\n`;
      // `line` is the 1-based last line of the block the image was dropped on;
      // insert right after it so the picture becomes its own paragraph.
      const anchorLine = Math.min(
        this.document.lineCount - 1,
        Math.max(0, (Number.isFinite(line) && line > 0 ? line : this.document.lineCount) - 1),
      );
      const position = new vscode.Position(anchorLine, this.document.lineAt(anchorLine).text.length);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(this.docUri, position, markdown);
      await vscode.workspace.applyEdit(edit);
      log().info(`image stored at ${saved.relative}`);
      void vscode.window.setStatusBarMessage(`$(check) Image saved to ${ASSET_DIR}/${saved.name}`, 3000);
    } catch (error) {
      log().error(`attachImage failed: ${error instanceof Error ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(
        `Buity Markdown: could not save the image — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private postConfig(redrawDiagrams: boolean) {
    if (!this.ready) return;
    void this.panel.webview.postMessage({
      type: 'config',
      config: this.config,
      themeKind: themeKind(),
      redrawDiagrams,
    });
  }

  private revealLine(line: number, fromPreview: boolean) {
    const editor = vscode.window.visibleTextEditors.find(
      (candidate) => candidate.document.uri.toString() === this.docUri.toString(),
    );
    if (!editor) return;
    const target = Math.max(0, (Number.isFinite(line) ? line : 1) - 1);
    const position = new vscode.Position(Math.min(target, editor.document.lineCount - 1), 0);
    if (fromPreview) this.lastIncomingScroll = Date.now();
    else this.lastOutgoingScroll = Date.now();
    editor.revealRange(
      new vscode.Range(position, position),
      fromPreview ? vscode.TextEditorRevealType.AtTop : vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private onVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent) {
    if (!this.ready || !this.config.syncScroll) return;
    if (event.textEditor.document.uri.toString() !== this.docUri.toString()) return;
    if (Date.now() - this.lastIncomingScroll < 350) return;
    const range = event.visibleRanges[0];
    if (!range) return;
    void this.panel.webview.postMessage({ type: 'scrollTo', line: range.start.line + 1 });
  }

  private async openLink(href: string) {
    if (!href) return;
    if (/^(https?:|mailto:)/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    if (/^file:/i.test(href)) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(href));
      return;
    }
    if (href.startsWith('#')) return;
    if (this.docUri.scheme !== 'file') return;
    const base = vscode.Uri.joinPath(this.docUri, '..');
    const pathPart = href.split('#')[0];
    const target = pathPart.startsWith('/')
      ? vscode.Uri.file(decodeURI(pathPart))
      : vscode.Uri.joinPath(base, decodeURI(pathPart));
    try {
      await vscode.workspace.fs.stat(target);
      if (/\.(md|markdown|mdx)$/i.test(target.path)) {
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc, { preview: true });
      } else {
        await vscode.commands.executeCommand('vscode.open', target);
      }
    } catch {
      void vscode.window.showWarningMessage(`Buity Markdown: cannot open “${href}”.`);
    }
  }

  private async toggleTask(line: number, checked: boolean) {
    const index = Math.max(0, line - 1);
    if (index >= this.document.lineCount) return;
    const text = this.document.lineAt(index).text;
    const updated = text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/, (_m, head: string, _state: string, tail: string) =>
      `${head}${checked ? 'x' : ' '}${tail}`,
    );
    if (updated === text) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.docUri,
      new vscode.Range(index, 0, index, text.length),
      updated,
    );
    await vscode.workspace.applyEdit(edit);
  }

  /* ------------------------------------------------------------------ html */

  private buildHtml(): string {
    const webview = this.panel.webview;
    const uri = (path: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...path.split('/'))).toString();
    const scriptNonce = nonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: https: http:`,
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${scriptNonce}' ${webview.cspSource}`,
      `media-src ${webview.cspSource} https:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en" data-bm-theme="auto">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${uri('katex.css')}" />
<link rel="stylesheet" href="${uri('buity.css')}" />
<link rel="stylesheet" href="${uri('webview.css')}" />
<title>Buity Markdown</title>
</head>
<body class="bm-body bm-interactive vscode-dark" data-bm-theme="auto">
  <header class="bm-toolbar">
    <div class="bm-title">
      <span class="bm-title-dot"></span>
      <span class="bm-title-text" id="title-text">Preview</span>
      <span class="bm-stats" id="stats"></span>
    </div>
    <div class="bm-tools">
      <button class="bm-icon-btn" id="btn-font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
      <button class="bm-icon-btn" id="btn-font-inc" title="Larger text" aria-label="Larger text">A+</button>
      <span class="bm-divider"></span>
      <button class="bm-icon-btn" id="btn-edit" title="Live edit — click any block to edit it in place" aria-label="Toggle live edit" aria-pressed="false">✎</button>
      <span class="bm-divider"></span>
      <div class="bm-seg" id="theme-seg" role="group" aria-label="Theme">
        <button data-theme="auto" title="Follow VS Code theme">Auto</button>
        <button data-theme="paper" title="Paper theme">Paper</button>
        <button data-theme="midnight" title="Midnight theme">Night</button>
      </div>
      <span class="bm-divider"></span>
      <button class="bm-icon-btn" id="btn-outline" title="Toggle outline" aria-label="Toggle outline" aria-pressed="true">☰</button>
      <button class="bm-icon-btn" id="btn-top" title="Back to top" aria-label="Back to top">↑</button>
      <button class="bm-icon-btn" id="btn-export" title="Export as standalone HTML" aria-label="Export as standalone HTML">⤓</button>
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
  <script nonce="${scriptNonce}" id="buity-script" src="${uri('webview.js')}"></script>
</body>
</html>`;
  }

  /* -------------------------------------------------------------- lifecycle */

  reveal(column?: vscode.ViewColumn) {
    this.panel.reveal(column, true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    BuityPreview.panels.delete(this.docUri.toString());
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }
}
