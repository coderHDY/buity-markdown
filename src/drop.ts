import * as vscode from 'vscode';
import { copyFileToAssets, isImageFile, saveAssetBeside } from './assets';
import { readConfig } from './config';
import { log } from './log';

export interface DroppedAsset {
  relative: string;
  alt: string;
}

async function readFileData(transferFile: { data(): Thenable<Uint8Array>; name: string; uri?: vscode.Uri }, folder: string, document: vscode.TextDocument, mime?: string): Promise<DroppedAsset | null> {
  try {
    const data = await transferFile.data();
    const saved = await saveAssetBeside(document.uri, transferFile.name, data, mime, folder);
    return { relative: saved.relative, alt: saved.name.replace(/\.[^.]+$/, '') };
  } catch (error) {
    log().error(`could not store dropped image: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Turns whatever the user dropped on the editor into images stored inside the
 * document's asset folder. Supports OS file drops (`text/uri-list`), raw image
 * payloads and inline base64 images.
 */
export async function collectDroppedImages(
  document: vscode.TextDocument,
  dataTransfer: vscode.DataTransfer,
): Promise<DroppedAsset[]> {
  const folder = readConfig().imageFolder || '_assets';
  const results: DroppedAsset[] = [];

  // 1. OS file drops are exposed as a uri list.
  const uriItem = dataTransfer.get('text/uri-list') || dataTransfer.get('application/vnd.code.uri-list');
  if (uriItem) {
    const raw = await uriItem.asString();
    for (const line of raw.split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith('#')) continue;
      try {
        const uri = vscode.Uri.parse(value);
        if (uri.scheme !== 'file' || !isImageFile(uri)) continue;
        const saved = await copyFileToAssets(document.uri, uri, folder);
        results.push({ relative: saved.relative, alt: saved.name.replace(/\.[^.]+$/, '') });
      } catch (error) {
        log().error(`dropped uri failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // 2. Raw image data (dragging an image out of a browser or another app).
  for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
    const item = dataTransfer.get(mime);
    if (!item) continue;
    const file = item.asFile?.();
    if (file) {
      const saved = await readFileData(file, folder, document, mime);
      if (saved) results.push(saved);
      continue;
    }
    try {
      const text = await item.asString();
      const base64 = text.includes('base64,') ? text.split('base64,')[1] : text;
      const ext = mime.split('/')[1].replace('svg+xml', 'svg');
      const saved = await saveAssetBeside(
        document.uri,
        `image-${Date.now()}.${ext}`,
        new Uint8Array(Buffer.from(base64, 'base64')),
        mime,
        folder,
      );
      results.push({ relative: saved.relative, alt: saved.name.replace(/\.[^.]+$/, '') });
    } catch (error) {
      log().error(`dropped image payload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Local file paths typed as plain text.
  if (!results.length) {
    const textItem = dataTransfer.get('text/plain');
    if (textItem) {
      const raw = await textItem.asString();
      for (const candidate of raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
        if (!/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(candidate)) continue;
        try {
          const uri = candidate.startsWith('file:') ? vscode.Uri.parse(candidate) : vscode.Uri.file(candidate);
          if (uri.scheme !== 'file') continue;
          const saved = await copyFileToAssets(document.uri, uri, folder);
          results.push({ relative: saved.relative, alt: saved.name.replace(/\.[^.]+$/, '') });
        } catch {
          /* not a real path */
        }
      }
    }
  }

  return results;
}

/** `Buity Markdown: Insert Image` — pick a file, it lands in the asset folder. */
export async function attachImageCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Buity Markdown: open a markdown file first.');
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Insert',
    filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'] },
  });
  if (!picked || !picked.length) return;

  const folder = readConfig().imageFolder || '_assets';
  const lines: string[] = [];
  for (const uri of picked) {
    const saved = await copyFileToAssets(editor.document.uri, uri, folder);
    lines.push(`![${saved.name.replace(/\.[^.]+$/, '')}](${saved.relative})`);
  }

  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.insert(selection.active, lines.join('\n'));
    }
  });
}
