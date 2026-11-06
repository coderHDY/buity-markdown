import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function log(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Buity Markdown', { log: true });
  }
  return channel;
}
