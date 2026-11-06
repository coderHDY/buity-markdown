import * as vscode from 'vscode';
import { BuityPreview } from './preview';
import { countText, extendMarkdownIt } from './engine';
import { exportHtml } from './export';
import { readConfig, themeKind } from './config';
import { log } from './log';
import * as format from './format';

function activeMarkdownDocument(): vscode.TextDocument | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  return editor.document.languageId === 'markdown' ? editor.document : undefined;
}

function showPreview(context: vscode.ExtensionContext, column: vscode.ViewColumn) {
  const document = activeMarkdownDocument();
  if (!document) {
    void vscode.window.showInformationMessage('Buity Markdown: open a markdown file to preview it.');
    return;
  }
  BuityPreview.show(context, document, column);
}

export function activate(context: vscode.ExtensionContext): { extendMarkdownIt(md: any): any } {
  const version = context.extension?.packageJSON?.version ?? '0.1.0';
  log().info(`Buity Markdown ${version} activated`);

  const register = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register('buityMarkdown.openPreview', () => showPreview(context, vscode.ViewColumn.Beside));  register('buityMarkdown.openPreviewToSide', () => showPreview(context, vscode.ViewColumn.Beside));
  register('buityMarkdown.exportHtml', (uri?: vscode.Uri) => exportHtml(context, uri instanceof vscode.Uri ? uri : undefined));

  register('buityMarkdown.toggleBold', format.toggleBold);
  register('buityMarkdown.toggleItalic', format.toggleItalic);
  register('buityMarkdown.toggleStrike', format.toggleStrike);
  register('buityMarkdown.toggleInlineCode', format.toggleInlineCode);
  register('buityMarkdown.toggleHighlight', format.toggleHighlight);
  register('buityMarkdown.toggleLink', format.toggleLink);
  register('buityMarkdown.cycleHeading', format.cycleHeading);
  register('buityMarkdown.insertCallout', format.insertCallout);
  register('buityMarkdown.insertTable', format.insertTable);
  register('buityMarkdown.insertMermaid', format.insertMermaid);
  register('buityMarkdown.insertMath', format.insertMath);
  register('buityMarkdown.insertCodeBlock', format.insertCodeBlock);
  register('buityMarkdown.toggleTask', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') return;
    const line = editor.selection.active.line;
    const text = editor.document.lineAt(line).text;
    const updated = text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/, (_m, head: string, state: string, tail: string) => {
      return `${head}${state === ' ' ? 'x' : ' '}${tail}`;
    });
    if (updated !== text) {
      void editor.edit((builder) => builder.replace(editor.document.lineAt(line).range, updated));
    }
  });

  /* ------------------------------------------------------------ status bar */

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 120);
  status.name = 'Buity Markdown';
  status.command = 'buityMarkdown.openPreviewToSide';
  context.subscriptions.push(status);

  let statusTimer: NodeJS.Timeout | undefined;
  const updateStatus = () => {
    const config = readConfig();
    const document = activeMarkdownDocument();
    if (!document || !config.wordCount) {
      status.hide();
      return;
    }
    const { words, chars, readingMinutes } = countText(document.getText());
    status.text = `$(book) ${words.toLocaleString('en-US')} words`;
    const parts = [`${chars.toLocaleString('en-US')} characters`, `~${readingMinutes} min read`];
    status.tooltip = new vscode.MarkdownString(
      `**Buity Markdown**\n\n${parts.join('  ·  ')}\n\n$(link-external) Click to open the live preview.`,
    );
    status.tooltip.isTrusted = false;
    status.show();
  };
  const scheduleStatus = () => {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(updateStatus, 250);
  };

  updateStatus();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) scheduleStatus();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('buityMarkdown')) updateStatus();
    }),
  );

  return {
    extendMarkdownIt(md: any) {
      const config = readConfig();
      return extendMarkdownIt(md, { math: config.math, callouts: config.callouts });
    },
  };
}

export function deactivate(): void {
  /* nothing to clean up */
}

// re-exported for tests / diagnostics
export { themeKind };
