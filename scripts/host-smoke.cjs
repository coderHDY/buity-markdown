/* Loads the compiled extension with a stubbed `vscode` API and exercises
   activation + the preview handshake. */
const Module = require('node:module');
const path = require('node:path');

const messages = [];
let panelHtml = '';
let panelTitle = '';
const posted = [];

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

class Emitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
  }
  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {}
}

const sampleText = `# Hello Buity\n\nSome **bold** text with $x^2$ math.\n\n::: tip Nice\nContent here.\n:::\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n![shot](./shot.png)\n`;

const document = {
  uri: { scheme: 'file', path: '/tmp/demo/notes.md', toString: () => 'file:///tmp/demo/notes.md' },
  languageId: 'markdown',
  lineCount: sampleText.split('\n').length,
  getText: () => sampleText,
  lineAt: (line) => ({ text: sampleText.split('\n')[line] || '' }),
  positionAt: (offset) => new Position(0, offset),
  offsetAt: () => 0,
};

const editor = {
  document,
  selection: new Selection(0, 0, 0, 0),
  selections: [new Selection(0, 0, 0, 0)],
  edit: (callback) => {
    const builder = { replace() {}, insert() {} };
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
  set title(value) {
    panelTitle = value;
  },
  get title() {
    return panelTitle;
  },
  iconPath: undefined,
  onDidDispose: () => ({ dispose() {} }),
  reveal() {},
  dispose() {},
};

const commands = new Map();
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
};

const vscode = {
  Position,
  Range,
  Selection,
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
  WorkspaceEdit: class {
    replace() {}
  },
  EventEmitter: Emitter,
  Uri: {
    file: (p) => ({ scheme: 'file', path: p, fsPath: p, toString: () => `file://${p}` }),
    parse: (value) => ({ scheme: 'https', path: value, toString: () => value }),
    joinPath: (base, ...parts) => {
      const joined = [base.path, ...parts].join('/').replace(/\/+/g, '/');
      return { scheme: base.scheme, path: joined, fsPath: joined, toString: () => `${base.scheme || 'file'}://${joined}` };
    },
  },
  window: {
    activeTextEditor: editor,
    visibleTextEditors: [editor],
    activeColorTheme: { kind: 2 },
    createWebviewPanel: () => panel,
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: '', tooltip: '', command: '', name: '' }),
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showSaveDialog: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    showQuickPick: () => Promise.resolve(undefined),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeActiveColorTheme: () => ({ dispose() {} }),
    onDidChangeTextEditorVisibleRanges: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
  },
  workspace: {
    textDocuments: [document],
    getConfiguration: () => ({
      get: (key, fallback) => (key in settings ? settings[key] : fallback),
      update: () => Promise.resolve(),
    }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    openTextDocument: () => Promise.resolve(document),
    applyEdit: () => Promise.resolve(true),
    fs: {
      readFile: () => Promise.resolve(Buffer.from('asset')),
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({}),
    },
  },
  commands: {
    registerCommand: (id, handler) => {
      commands.set(id, handler);
      return { dispose() {} };
    },
    executeCommand: () => Promise.resolve(undefined),
  },
  env: {
    openExternal: () => Promise.resolve(true),
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(process.cwd(), 'dist/extension.js'));
const context = {
  extensionUri: { scheme: 'file', path: process.cwd(), toString: () => process.cwd() },
  subscriptions: [],
};

(async () => {
  const api = extension.activate(context);
  console.log('✓ activated, commands:', commands.size);

  // built-in preview extension point
  const MarkdownIt = require('markdown-it');
  const md = new MarkdownIt({ html: true });
  const returned = api.extendMarkdownIt(md);
  const builtIn = returned.render('# Hi\n\n::: tip Yo\nbody\n:::\n\n$e=mc^2$\n\n- [x] done');
  console.log('✓ extendMarkdownIt:', /bm-callout-tip/.test(builtIn), /katex/.test(builtIn), /task-list-item/.test(builtIn));

  await commands.get('buityMarkdown.openPreviewToSide')();
  console.log('✓ preview panel created, title:', panelTitle, '| html length:', panelHtml.length);
  console.log('  CSP present:', /Content-Security-Policy/.test(panelHtml), '| nonce script:', /nonce=/.test(panelHtml));

  // handshake: webview -> ready
  for (const handler of messages) await handler({ type: 'ready' });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const types = posted.map((message) => message.type);
  console.log('✓ messages to webview:', types.join(', '));
  const update = posted.find((message) => message.type === 'update');
  console.log('✓ update: headings', update.headings.length, '| html', update.html.length, '| words', update.stats.words);
  console.log('  image resolved to webview uri:', /vscode-webview:\/\/mock/.test(update.html));
  console.log('  copy button kept:', /data-copy/.test(update.html));

  // webview -> host messages
  for (const handler of messages) await handler({ type: 'scroll', line: 5 });
  for (const handler of messages) await handler({ type: 'toggleTask', line: 1, checked: true });
  for (const handler of messages) await handler({ type: 'setConfig', patch: { theme: 'paper' } });
  console.log('✓ handled scroll/toggleTask/setConfig');

  // formatting commands
  for (const id of ['buityMarkdown.toggleBold', 'buityMarkdown.insertTable', 'buityMarkdown.cycleHeading']) {
    if (!commands.has(id)) throw new Error(`missing ${id}`);
    await commands.get(id)();
  }
  console.log('✓ formatting commands ran');

  console.log('\nall good');
})().catch((error) => {
  console.error('✗ failed:', error);
  process.exit(1);
});
