import * as vscode from 'vscode';

function activeEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Buity Markdown: open a markdown file first.');
    return undefined;
  }
  return editor;
}

function toggleWrap(editor: vscode.TextEditor, open: string, close: string, placeholder: string) {
  const edits: { range: vscode.Range; text: string }[] = [];
  let primary: vscode.Selection | undefined;

  for (const selection of editor.selections) {
    const text = editor.document.getText(selection);
    if (!text) {
      edits.push({ range: new vscode.Range(selection.start, selection.start), text: `${open}${placeholder}${close}` });
      primary = primary ?? selection;
      continue;
    }
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      edits.push({ range: selection, text: text.slice(open.length, text.length - close.length) });
    } else {
      edits.push({ range: selection, text: `${open}${text}${close}` });
    }
    primary = primary ?? selection;
  }

  void editor.edit((builder) => {
    for (const edit of edits) builder.replace(edit.range, edit.text);
  }).then((applied) => {
    if (!applied || !primary) return;
    const offset = open.length;
    const start = primary.start.translate(0, 0);
    const end = primary.isEmpty
      ? start.translate(0, offset + placeholder.length)
      : primary.end.translate(0, offset);
    editor.selection = new vscode.Selection(start.translate(0, offset), end);
  });
}

export function toggleBold() {
  const editor = activeEditor();
  if (editor) toggleWrap(editor, '**', '**', 'bold');
}

export function toggleItalic() {
  const editor = activeEditor();
  if (editor) toggleWrap(editor, '_', '_', 'italic');
}

export function toggleStrike() {
  const editor = activeEditor();
  if (editor) toggleWrap(editor, '~~', '~~', 'strike');
}

export function toggleInlineCode() {
  const editor = activeEditor();
  if (editor) toggleWrap(editor, '`', '`', 'code');
}

export function toggleHighlight() {
  const editor = activeEditor();
  if (editor) toggleWrap(editor, '==', '==', 'highlight');
}

export async function toggleLink() {
  const editor = activeEditor();
  if (!editor) return;
  const selection = editor.selection;
  const text = editor.document.getText(selection) || 'link text';

  // Unwrap an existing link that covers the selection.
  const lineText = editor.document.lineAt(selection.start.line).text;
  const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(lineText))) {
    const start = match.index;
    const end = start + match[0].length;
    if (start <= selection.start.character && end >= selection.end.character && selection.start.line === selection.end.line) {
      await editor.edit((builder) =>
        builder.replace(new vscode.Range(selection.start.line, start, selection.start.line, end), match![1]),
      );
      return;
    }
  }

  const url = await vscode.window.showInputBox({
    prompt: 'Link URL',
    value: 'https://',
    placeHolder: 'https://example.com',
  });
  if (url === undefined) return;

  await editor.edit((builder) => builder.replace(selection, `[${text}](${url})`));
  const position = new vscode.Position(selection.start.line, selection.start.character + text.length + 1);
  editor.selection = new vscode.Selection(position, position);
}

export function cycleHeading() {
  const editor = activeEditor();
  if (!editor) return;
  const line = editor.selection.active.line;
  const text = editor.document.lineAt(line).text;
  const match = /^(#{1,6})\s+(.*)$/.exec(text);
  const level = match ? match[1].length : 0;
  const body = match ? match[2] : text;
  const next = level >= 6 ? 0 : level + 1;
  const updated = next === 0 ? body : `${'#'.repeat(next)} ${body}`;
  void editor.edit((builder) => builder.replace(editor.document.lineAt(line).range, updated));
}

function insertBlock(editor: vscode.TextEditor, block: string, selectPlaceholder?: string) {
  const selection = editor.selection;
  const line = editor.document.lineAt(selection.start.line);
  const prefix = selection.isEmpty ? line.text.slice(0, selection.start.character) : '';
  const atLineStart = /^\s*$/.test(prefix);
  const text = atLineStart
    ? `${prefix}${block}\n`
    : `\n${block}\n`;
  void editor.edit((builder) => builder.insert(selection.isEmpty ? selection.start : selection.start, text)).then(() => {
    if (!selectPlaceholder) return;
    const document = editor.document;
    const full = document.getText();
    const index = full.indexOf(block, document.offsetAt(selection.start));
    if (index < 0) return;
    const start = document.positionAt(index + block.indexOf(selectPlaceholder));
    const end = start.translate(0, selectPlaceholder.length);
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  });
}

const CALLOUTS = [
  { label: 'Note', type: 'note', description: 'Supplementary information' },
  { label: 'Tip', type: 'tip', description: 'Helpful advice' },
  { label: 'Important', type: 'important', description: 'Key information' },
  { label: 'Warning', type: 'warning', description: 'Things to be careful about' },
  { label: 'Caution', type: 'caution', description: 'Risk of failure or damage' },
  { label: 'Example', type: 'example', description: 'A worked example' },
  { label: 'Quote', type: 'quote', description: 'Pulled quotation' },
];

export async function insertCallout() {
  const editor = activeEditor();
  if (!editor) return;
  const picked = await vscode.window.showQuickPick(CALLOUTS, {
    placeHolder: 'Callout type',
    title: 'Insert callout',
  });
  if (!picked) return;
  const selection = editor.selection;
  const selected = editor.document.getText(selection);
  const body = selected || 'Write something worth reading.';
  insertBlock(editor, `::: ${picked.type} ${picked.label}\n${body}\n:::`, selected ? undefined : body);
}

export async function insertTable() {
  const editor = activeEditor();
  if (!editor) return;
  const size = await vscode.window.showQuickPick(
    [
      { label: '2 × 2', columns: 2, rows: 2 },
      { label: '3 × 3', columns: 3, rows: 3 },
      { label: '4 × 3', columns: 4, rows: 3 },
      { label: '5 × 4', columns: 5, rows: 4 },
    ],
    { placeHolder: 'Table size', title: 'Insert table' },
  );
  if (!size) return;
  const header = `| ${Array.from({ length: size.columns }, (_, i) => `Column ${i + 1}`).join(' | ')} |`;
  const divider = `| ${Array.from({ length: size.columns }, () => '---').join(' | ')} |`;
  const body = Array.from(
    { length: size.rows },
    () => `| ${Array.from({ length: size.columns }, () => ' ').join(' | ')} |`,
  ).join('\n');
  insertBlock(editor, [header, divider, body].join('\n'));
}

export function insertMermaid() {
  const editor = activeEditor();
  if (!editor) return;
  const block = ['```mermaid', 'flowchart LR', '  A[Idea] --> B[Draft]', '  B --> C{Good?}', '  C -->|Yes| D[Publish]', '  C -->|No| B', '```'].join('\n');
  insertBlock(editor, block);
}

export function insertMath() {
  const editor = activeEditor();
  if (!editor) return;
  const selection = editor.selection;
  const selected = editor.document.getText(selection);
  insertBlock(editor, `$$\n${selected || 'E = mc^2'}\n$$`, selected ? undefined : 'E = mc^2');
}

export async function insertCodeBlock() {
  const editor = activeEditor();
  if (!editor) return;
  const language = await vscode.window.showInputBox({
    prompt: 'Language (leave empty for plain text)',
    value: '',
    placeHolder: 'typescript',
  });
  if (language === undefined) return;
  const selection = editor.selection;
  const selected = editor.document.getText(selection);
  const body = selected || '// code';
  const fenced = `\`\`\`${language}\n${body}\n\`\`\``;
  if (selected) {
    void editor.edit((builder) => builder.replace(selection, fenced));
  } else {
    insertBlock(editor, fenced, '// code');
  }
}
