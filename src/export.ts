import * as vscode from 'vscode';
import { createEngine } from './engine';
import { readConfig, themeKind } from './config';

const KATEX_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist';
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

async function readAsset(context: vscode.ExtensionContext, ...parts: string[]): Promise<string> {
  const uri = vscode.Uri.joinPath(context.extensionUri, ...parts);
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString('utf8');
}

async function embedImages(html: string, document: vscode.TextDocument): Promise<string> {
  if (document.uri.scheme !== 'file') return html;
  const base = vscode.Uri.joinPath(document.uri, '..');
  const sources = new Set<string>();
  const pattern = /<img\b[^>]*?\bsrc="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const src = match[1];
    if (!/^(https?:|data:|vscode-)/i.test(src)) sources.add(src);
  }
  let output = html;
  for (const src of sources) {
    try {
      const cleaned = decodeURI(src.split('?')[0]);
      const resource = cleaned.startsWith('/')
        ? vscode.Uri.file(cleaned)
        : vscode.Uri.joinPath(base, cleaned);
      const data = await vscode.workspace.fs.readFile(resource);
      const ext = cleaned.split('.').pop()?.toLowerCase() || '';
      const mime = MIME[ext] || 'application/octet-stream';
      const dataUri = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
      output = output.split(`src="${src}"`).join(`src="${dataUri}"`);
    } catch {
      /* leave the original path */
    }
  }
  return output;
}

function standaloneHtml(options: {
  title: string;
  html: string;
  css: string;
  katexCss: string;
  theme: string;
  hasDiagram: boolean;
}): string {
  const katexCss = options.katexCss.replace(/url\(fonts\//g, `url(${KATEX_CDN}/fonts/`);
  const mermaid = options.hasDiagram
    ? `<script src="${MERMAID_CDN}"></script>
<script>
  mermaid.initialize({ startOnLoad: true, theme: '${options.theme === 'paper' ? 'default' : 'dark'}', securityLevel: 'strict' });
</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${options.title}</title>
<style>
${katexCss}
</style>
<style>
${options.css}
</style>
</head>
<body class="vscode-body vscode-light" data-bm-theme="${options.theme}">
${options.html}
${mermaid}
</body>
</html>
`;
}

export async function exportHtml(context: vscode.ExtensionContext, uriInput?: vscode.Uri): Promise<void> {
  let document: vscode.TextDocument | undefined;
  if (uriInput) {
    const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uriInput.toString());
    document = open ?? (await vscode.workspace.openTextDocument(uriInput));
  } else {
    document = vscode.window.activeTextEditor?.document;
  }
  if (!document) {
    void vscode.window.showInformationMessage('Buity Markdown: nothing to export.');
    return;
  }

  const config = readConfig();
  const engine = createEngine({
    math: config.math,
    callouts: config.callouts,
    highlight: true,
    mermaid: config.mermaid,
  });
  const result = engine.render(document.getText());

  const theme = config.theme === 'auto' ? (themeKind() === 'light' ? 'paper' : 'midnight') : config.theme;
  const [css, katexCss] = await Promise.all([
    readAsset(context, 'media', 'buity.css'),
    readAsset(context, 'media', 'katex.css'),
  ]);
  const html = await embedImages(result.html, document);

  const fileName = document.uri.path.split('/').pop() || 'document.md';
  const documentTitle = fileName.replace(/\.(md|markdown|mdx)$/i, '');
  const htmlText = standaloneHtml({
    title: documentTitle,
    html,
    css,
    katexCss,
    theme,
    hasDiagram: result.hasDiagram,
  });

  const target = await vscode.window.showSaveDialog({
    title: 'Export as standalone HTML',
    saveLabel: 'Export',
    filters: { HTML: ['html'] },
    defaultUri:
      document.uri.scheme === 'file'
        ? vscode.Uri.joinPath(document.uri, '..', `${documentTitle}.html`)
        : undefined,
  });
  if (!target) return;

  await vscode.workspace.fs.writeFile(target, Buffer.from(htmlText, 'utf8'));
  const action = await vscode.window.showInformationMessage(
    `Exported “${documentTitle}.html” (${(Buffer.byteLength(htmlText) / 1024).toFixed(0)} KB).`,
    'Open',
    'Show in Folder',
  );
  if (action === 'Open') {
    await vscode.env.openExternal(target);
  } else if (action === 'Show in Folder') {
    await vscode.commands.executeCommand('revealFileInOS', target);
  }
}
