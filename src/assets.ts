import * as vscode from 'vscode';

/** Folder created next to the markdown file the first time an image is dropped in. */
export const ASSET_DIR = '_assets';

export interface SavedAsset {
  uri: vscode.Uri;
  /** Path to write into the markdown, e.g. `./_assets/photo.png` */
  relative: string;
  name: string;
}

function sanitizeName(name: string, mime?: string): string {
  const fallback = mime?.startsWith('image/') ? `image.${mime.slice(6).split('+')[0]}` : 'image.png';
  const base = (name || fallback).replace(/^.*[\\/]/, '').trim();
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '-').replace(/\s+/g, '-');
  if (!cleaned) return fallback;
  return cleaned.includes('.') ? cleaned : `${cleaned}.png`;
}

async function uniqueName(dir: vscode.Uri, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let index = 1; index < 500; index++) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, candidate));
      candidate = `${stem}-${index}${ext}`;
    } catch {
      return candidate;
    }
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Writes image bytes into `_assets` next to the document (creating the folder
 * when needed) and returns the relative path to reference in Markdown.
 */
export async function saveAssetBeside(
  documentUri: vscode.Uri,
  fileName: string,
  data: Uint8Array,
  mime?: string,
  folderName: string = ASSET_DIR,
): Promise<SavedAsset> {
  if (documentUri.scheme !== 'file') {
    throw new Error('Images can only be stored next to files on disk.');
  }
  const folder = vscode.Uri.joinPath(documentUri, '..', folderName);
  try {
    await vscode.workspace.fs.stat(folder);
  } catch {
    await vscode.workspace.fs.createDirectory(folder);
  }
  const name = await uniqueName(folder, sanitizeName(fileName, mime));
  const uri = vscode.Uri.joinPath(folder, name);
  await vscode.workspace.fs.writeFile(uri, data);
  return { uri, relative: `./${folderName}/${encodeURI(name)}`, name };
}

/** Copies a file from disk into `_assets`. */
export async function copyFileToAssets(
  documentUri: vscode.Uri,
  source: vscode.Uri,
  folderName: string = ASSET_DIR,
): Promise<SavedAsset> {
  const data = await vscode.workspace.fs.readFile(source);
  const name = source.path.split('/').pop() || 'image.png';
  return saveAssetBeside(documentUri, name, data, undefined, folderName);
}

export function isImageFile(file: vscode.Uri): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(file.path);
}
