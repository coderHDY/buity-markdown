import * as vscode from 'vscode';

export interface BuityConfig {
  theme: 'auto' | 'paper' | 'midnight';
  fontSize: number;
  lineHeight: number;
  width: 'narrow' | 'comfortable' | 'wide' | 'full';
  showOutline: boolean;
  syncScroll: boolean;
  mermaid: boolean;
  math: boolean;
  callouts: boolean;
  wordCount: boolean;
  readingTime: boolean;
  liveEdit: boolean;
  imageFolder: string;
}

export const CONFIG_SECTION = 'buityMarkdown';

export function readConfig(): BuityConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    theme: config.get<'auto' | 'paper' | 'midnight'>('theme', 'auto'),
    fontSize: config.get<number>('fontSize', 16),
    lineHeight: config.get<number>('lineHeight', 1.75),
    width: config.get<BuityConfig['width']>('width', 'comfortable'),
    showOutline: config.get<boolean>('showOutline', true),
    syncScroll: config.get<boolean>('syncScroll', true),
    mermaid: config.get<boolean>('mermaid', true),
    math: config.get<boolean>('math', true),
    callouts: config.get<boolean>('callouts', true),
    wordCount: config.get<boolean>('wordCount', true),
    readingTime: config.get<boolean>('readingTime', true),
    liveEdit: config.get<boolean>('liveEdit', false),
    imageFolder: config.get<string>('imageFolder', '_assets'),
  };
}

export function themeKind(): 'light' | 'dark' {
  const kind = vscode.window.activeColorTheme?.kind ?? vscode.ColorThemeKind.Dark;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}
