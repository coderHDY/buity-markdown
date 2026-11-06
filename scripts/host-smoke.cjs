/* Loads the compiled extension with a stubbed `vscode` API and exercises
   activation, the preview handshake, live editing round trips and image drops. */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/* --------------------------------------------------------------- fake fs */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buity-host-'));
const docPath = path.join(tmpRoot, 'notes.md');
const initialText = [
  '# Hello Buity',
  '',
  'Some **bold** text with $x^2$ math.',
  '',
  '::: tip Nice',
  'Content here.',
  ':::',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
].join('\n');
fs.writeFileSync(docPath, initialText);

/* ----------------------------------------------------------- fake vscode */

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  translate(lineDelta = 0, charDelta = 0) {
    return new Position(this.line + lineDelta, this.character + charDelta);
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
  isBefore(other) {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }
}

class Range {
  constructor(a, b, c, d) {
    this.start = typeof a === 'number' ? new Position(a, b) : a;
    this.end = typeof c === 'number' ? new Position(c, d) : b;
  }
}

class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    this.active = this.end;
    this.anchor = this.start;
  }
  get isEmpty() {
    return this.start.isEqual(this.end);
  }
}

const messages = [];
const posted = [];
let panelHtml = '';

let documentText = initialText;
const document = {
  uri: { scheme: 'file', path: docPath, fsPath: docPath, toString: () => `file://${docPath}` },
  languageId: 'markdown',
  get lineCount() {
    return documentText.split('\n').length;
  },
  getText: (range) => {
    if (!range) return documentText;
    const lines = documentText.split('\n');
    if (range.start.line === range.end.line) return lines[range.start.line].slice(range.start.character, range.end.character);
    const out = [lines[range.start.line].slice(range.start.character)];
    for (let line = range.start.line + 1; line < range.end.line; line++) out.push(lines[line]);
    out.push(lines[range.end.line].slice(0, range.end.character));
    return out.join('\n');
  },
  lineAt: (line) => {
    const text = documentText.split('\n')[line] ?? '';
    return { text, range: new Range(new Position(line, 0), new Position(line, text.length)) };
  },
  positionAt: (offset) => {
    const before = documentText.slice(0, offset);
    const lines = before.split('\n');
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  },
  offsetAt: (position) => {
    const lines = documentText.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) offset += lines[i].length + 1;
    return offset + position.character;
  },
};

function applyTextEdit(range, text) {
  const lines = documentText.split('\n');
  const startOffset =
    lines.slice(0, range.start.line).reduce((total, line) => total + line.length + 1, 0) + range.start.character;
  const endOffset =
    lines.slice(0, range.end.line).reduce((total, line) => total + line.length + 1, 0) + range.end.character;
  documentText = documentText.slice(0, startOffset) + text + documentText.slice(endOffset);
}

const appliedEdits = [];

class WorkspaceEdit {
  constructor() {
    this.ops = [];
  }
  replace(uri, range, text) {
    this.ops.push({ kind: 'replace', range, text });
  }
  insert(uri, position, text) {
    this.ops.push({ kind: 'insert', range: new Range(position, position), text });
  }
}

const editor = {
  document,
  selection: new Selection(0, 0, 0, 0),
  selections: [new Selection(0, 0, 0, 0)],
  edit: (callback) => {
    const builder = { replace: () => {}, insert: () => {} };
    callback(builder);
    return Promise.resolve(true);
  },
  revealRange() {},
};

const webview = {
  cspSource: 'vscode-webview://mock',
  asWebviewUri: (uri) => ({ toString: () => `vscode-webview://mock${uri.path}` }),
  postMessage: (message) => {
    posted.push(message);
    return Promise.resolve(true);
  },
  onDidReceiveMessage: (handler) => {
    messages.push(handler);
    return { dispose() {} };
  },
  set html(value) {
    panelHtml = value;
  },
  get html() {
    return panelHtml;
  },
};

const panel = {
  webview,
  title: '',
  iconPath: undefined,
  onDidDispose: () => ({ dispose() {} }),
  reveal: (viewColumn) => panelCalls.push({ kind: 'reveal', viewColumn }),
  dispose() {},
};

  const commands = new Map();
  const dropProviders = [];
  const panelCalls = [];
  const openedUris = [];
const settings = {
  'buityMarkdown.theme': 'auto',
  'buityMarkdown.fontSize': 16,
  'buityMarkdown.lineHeight': 1.75,
  'buityMarkdown.width': 'comfortable',
  'buityMarkdown.showOutline': true,
  'buityMarkdown.syncScroll': true,
  'buityMarkdown.mermaid': true,
  'buityMarkdown.math': true,
  'buityMarkdown.callouts': true,
  'buityMarkdown.wordCount': true,
  'buityMarkdown.readingTime': true,
  'buityMarkdown.liveEdit': false,
  'buityMarkdown.imageFolder': '_assets',
};

class DocumentDropEdit {
  constructor(insertText) {
    this.insertText = insertText;
  }
}

const vscode = {
  Position,
  Range,
  Selection,
  DocumentDropEdit,
  MarkdownString: class {
    constructor(value) {
      this.value = value;
    }
  },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1 },
  TextEditorRevealType: { AtTop: 3, InCenterIfOutsideViewport: 1 },
  WorkspaceEdit,
  EventEmitter: class {
    constructor() {
      this.event = () => ({ dispose() {} });
    }
  },
  Uri: {
    file: (p) => ({ scheme: 'file', path: p, fsPath: p, toString: () => `file://${p}` }),
    parse: (value) => {
      if (value.startsWith('file://')) {
        const p = decodeURI(value.replace('file://', ''));
        return { scheme: 'file', path: p, fsPath: p, toString: () => `file://${p}` };
      }
      return { scheme: value.split(':')[0], path: value, toString: () => value };
    },
    joinPath: (base, ...parts) => {
      const joined = path.posix.normalize([base.path, ...parts].join('/'));
      return { scheme: base.scheme || 'file', path: joined, fsPath: joined, toString: () => `${base.scheme || 'file'}://${joined}` };
    },
  },
  window: {
    activeTextEditor: editor,
    visibleTextEditors: [editor],
    activeColorTheme: { kind: 2 },
    createWebviewPanel: (viewType, title, viewColumn) => {
      panelCalls.push({ kind: 'create', viewColumn });
      return panel;
    },
    createOutputChannel: () => ({
      info: (...args) => console.log('[log:info]', ...args),
      warn: () => {},
      error: (...args) => console.log('[log:error]', ...args),
      debug: () => {},
      appendLine: () => {},
      dispose: () => {},
    }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: '', tooltip: '', command: '', name: '' }),
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: (message) => {
      console.log('[error message]', message);
      return Promise.resolve(undefined);
    },
    setStatusBarMessage: () => ({ dispose() {} }),
    showSaveDialog: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    showQuickPick: () => Promise.resolve(undefined),
    showOpenDialog: () => Promise.resolve(undefined),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeActiveColorTheme: () => ({ dispose() {} }),
    onDidChangeTextEditorVisibleRanges: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
  },
  workspace: {
    textDocuments: [document],
    getConfiguration: (section = 'buityMarkdown') => ({
      get: (key, fallback) => {
        const full = `${section}.${key}`;
        return full in settings ? settings[full] : fallback;
      },
      update: (key, value) => {
        settings[`${section}.${key}`] = value;
        return Promise.resolve();
      },
    }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    openTextDocument: (uri) => {
      openedUris.push(uri);
      return Promise.resolve(document);
    },
    applyEdit: (edit) => {
      appliedEdits.push(edit);
      for (const op of edit.ops) applyTextEdit(op.range, op.text);
      return Promise.resolve(true);
    },
    fs: {
      readFile: (uri) => Promise.resolve(new Uint8Array(fs.readFileSync(uri.fsPath || uri.path))),
      writeFile: (uri, data) => {
        fs.mkdirSync(path.dirname(uri.fsPath || uri.path), { recursive: true });
        fs.writeFileSync(uri.fsPath || uri.path, Buffer.from(data));
        return Promise.resolve();
      },
      stat: (uri) => {
        const target = uri.fsPath || uri.path;
        if (!fs.existsSync(target)) return Promise.reject(new Error('ENOENT'));
        return Promise.resolve({});
      },
      createDirectory: (uri) => {
        fs.mkdirSync(uri.fsPath || uri.path, { recursive: true });
        return Promise.resolve();
      },
    },
  },
  languages: {
    registerDocumentDropEditProvider: (_selector, provider) => {
      dropProviders.push(provider);
      return { dispose() {} };
    },
  },
  commands: {
    registerCommand: (id, handler) => {
      commands.set(id, handler);
      return { dispose() {} };
    },
    executeCommand: () => Promise.resolve(undefined),
  },
  env: { openExternal: () => Promise.resolve(true) },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

/* ------------------------------------------------------------------- test */

let failures = 0;
function check(ok, label, detail) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log('    ', detail);
  }
}

function dataTransferWith(payload) {
  return {
    get: (mime) => {
      if (!(mime in payload)) return undefined;
      const value = payload[mime];
      return {
        asString: () => Promise.resolve(value),
        asFile: () => undefined,
      };
    },
  };
}

const settle = async (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return true;
    await settle(25);
  }
  return predicate();
}

(async () => {
  const extension = require(path.join(process.cwd(), 'dist/extension.js'));
  const context = {
    extensionUri: { scheme: 'file', path: process.cwd(), toString: () => process.cwd() },
    subscriptions: [],
    extension: { packageJSON: { version: '0.2.0' } },
  };

  const api = extension.activate(context);
  check(commands.size >= 17, `activated with ${commands.size} commands`);
  check(commands.has('buityMarkdown.attachImage'), 'attachImage command registered');
  check(dropProviders.length === 1, 'markdown drop provider registered');

  const MarkdownIt = require('markdown-it');
  const md = new MarkdownIt({ html: true });
  const builtIn = api.extendMarkdownIt(md).render('# Hi\n\n::: tip Yo\nbody\n:::\n\n$e=mc^2$');
  check(/bm-callout-tip/.test(builtIn) && /katex/.test(builtIn), 'built-in preview extension point works');

  await commands.get('buityMarkdown.openPreviewToSide')();
  for (const handler of messages) await handler({ type: 'ready' });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const update = posted.find((message) => message.type === 'update');
  check(Boolean(update), 'preview received initial render');
  check(/data-line-start/.test(update.html), 'blocks carry source ranges');
  check(/data-callout="tip"/.test(update.html), 'callouts carry editable metadata');

  /* ------------------------------------------------ live edit round trips */

  // Replace the paragraph on line 3.
  documentText = initialText;
  for (const handler of messages) {
    await handler({ type: 'applyEdit', start: 3, end: 3, text: 'Rewritten **paragraph** with a [link](https://example.com).' });
  }
  check(documentText.split('\n')[2] === 'Rewritten **paragraph** with a [link](https://example.com).', 'applyEdit replaced the paragraph line', documentText.split('\n')[2]);

  // Replace the whole table (as the webview does after a cell edit).
  documentText = initialText;
  const tableEdit = '| a | b |\n| --- | :---: |\n| 1 | updated |';
  for (const handler of messages) {
    await handler({ type: 'applyEdit', start: 13, end: 15, text: tableEdit });
  }
  check(documentText.includes('| 1 | updated |'), 'applyEdit replaced a multi-line table');
  check(documentText.includes('| --- | :---: |'), 'table alignment survives');

  // No-op edits must not touch the document.
  const before = appliedEdits.length;
  for (const handler of messages) await handler({ type: 'applyEdit', start: 1, end: 1, text: '# Hello Buity' });
  check(appliedEdits.length === before, 'identical edit is skipped');

  /* ------------------------------------------------------- image handling */

  documentText = initialText;
  const pngBase64 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ).toString('base64');

  for (const handler of messages) {
    await handler({ type: 'attachImage', name: 'Diagram 1.png', data: pngBase64, mime: 'image/png', line: 3 });
  }
  await waitFor(() => fs.existsSync(path.join(tmpRoot, '_assets', 'Diagram-1.png')));
  const assetsDir = path.join(tmpRoot, '_assets');
  check(fs.existsSync(assetsDir), '_assets folder created next to the document');
  const stored = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  check(stored.length === 1, `image copied into _assets (${stored.join(', ')})`);
  check(stored[0] === 'Diagram-1.png', 'file name sanitised');
  check(documentText.includes('![Diagram-1](./_assets/Diagram-1.png)'), 'relative markdown image inserted', documentText);

  // A second image with the same name must not overwrite the first.
  for (const handler of messages) {
    await handler({ type: 'attachImage', name: 'Diagram 1.png', data: pngBase64, mime: 'image/png', line: 3 });
  }
  await waitFor(() => fs.readdirSync(assetsDir).length === 2);
  const stored2 = fs.readdirSync(assetsDir).sort();
  check(stored2.length === 2 && stored2.includes('Diagram-1-1.png'), `duplicate names are suffixed (${stored2.join(', ')})`);

  const pngPath = path.join(tmpRoot, 'dropped.png');
  fs.writeFileSync(pngPath, Buffer.from(pngBase64, 'base64'));

  const dropEdit = await dropProviders[0].provideDocumentDropEdits(
    document,
    new Position(0, 0),
    dataTransferWith({ 'text/uri-list': `file://${pngPath}` }),
  );
  check(Boolean(dropEdit), 'drop provider returned an edit');
  check(/!\[dropped\]\(\.\/_assets\/dropped\.png\)/.test(String(dropEdit?.insertText || '')), 'drop inserts the asset-relative path', dropEdit?.insertText);
  check(fs.existsSync(path.join(assetsDir, 'dropped.png')), 'dropped file copied into _assets');

  const textDrop = await dropProviders[0].provideDocumentDropEdits(
    document,
    new Position(0, 0),
    dataTransferWith({ 'text/plain': pngPath }),
  );
  check(Boolean(textDrop), 'plain-text path drops are handled too');

  const ignoredDrop = await dropProviders[0].provideDocumentDropEdits(
    document,
    new Position(0, 0),
    dataTransferWith({ 'text/plain': 'just some text' }),
  );
  check(ignoredDrop === undefined, 'non-image drops are ignored');

  /* ------------------------------------------------------------- cleanup */

  for (const handler of messages) await handler({ type: 'setConfig', patch: { theme: 'paper', liveEdit: true } });
  await waitFor(() => settings['buityMarkdown.theme'] === 'paper' && settings['buityMarkdown.liveEdit'] === true);
  check(settings['buityMarkdown.theme'] === 'paper' && settings['buityMarkdown.liveEdit'] === true, 'config changes persisted');

  /* ------------------------------------------- title bar button behaviour */

  check(panelCalls.length > 0, 'preview panel was requested');
  check(
    panelCalls.every((call) => call.viewColumn === vscode.ViewColumn.Beside),
    'openPreviewToSide targets the Beside column',
    JSON.stringify(panelCalls),
  );

  // "Open Preview" must take over the active column, not open beside it.
  panelCalls.length = 0;
  await commands.get('buityMarkdown.openPreview')();
  check(
    panelCalls.length > 0 && panelCalls.every((call) => call.viewColumn === vscode.ViewColumn.Active),
    'openPreview targets the active column',
    JSON.stringify(panelCalls),
  );

  // A title-bar click passes the tab's URI and may find no active text editor.
  panelCalls.length = 0;
  openedUris.length = 0;
  const savedEditor = vscode.window.activeTextEditor;
  const savedVisible = vscode.window.visibleTextEditors;
  vscode.window.activeTextEditor = undefined;
  vscode.window.visibleTextEditors = [];
  const titleBarUri = vscode.Uri.file('/tmp/from-title-bar.md');
  await commands.get('buityMarkdown.openPreviewToSide')(titleBarUri);
  check(openedUris.some((uri) => uri && uri.path === titleBarUri.path), 'title bar URI is resolved into a document');
  check(panelCalls.length > 0, 'title bar click still opens a preview without an active editor');
  vscode.window.activeTextEditor = savedEditor;
  vscode.window.visibleTextEditors = savedVisible;

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(failures ? `\n${failures} check(s) failed` : '\nall host checks passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('failed:', error);
  process.exit(1);
});
