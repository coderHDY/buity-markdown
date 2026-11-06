import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(root, '..');
const watch = process.argv.includes('--watch');

const log = (message) => console.log(`\x1b[38;5;209mbuity\x1b[0m ${message}`);

function copy(from, to) {
  const target = path.join(repo, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repo, from), target);
}

function copyAssets() {
  const katexDist = path.join(repo, 'node_modules/katex/dist');
  copy('node_modules/katex/dist/katex.min.css', 'media/katex.css');
  const fontDir = path.join(katexDist, 'fonts');
  const fontOut = path.join(repo, 'media/fonts');
  fs.mkdirSync(fontOut, { recursive: true });
  let fonts = 0;
  for (const file of fs.readdirSync(fontDir)) {
    if (!file.endsWith('.woff2')) continue;
    fs.copyFileSync(path.join(fontDir, file), path.join(fontOut, file));
    fonts++;
  }
  copy('node_modules/mermaid/dist/mermaid.min.js', 'media/vendor/mermaid.min.js');
  log(`assets: katex css, ${fonts} woff2 fonts, mermaid runtime`);
}

const extensionOptions = {
  entryPoints: [path.join(repo, 'src/extension.ts')],
  outfile: path.join(repo, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  external: ['vscode'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
};

const webviewOptions = {
  entryPoints: [path.join(repo, 'webview/main.ts')],
  outfile: path.join(repo, 'media/webview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome114'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(extensionOptions), esbuild.context(webviewOptions)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  copyAssets();
  log('watching…');
} else {
  const started = Date.now();
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
  copyAssets();
  const size = fs.statSync(path.join(repo, 'dist/extension.js')).size;
  const webviewSize = fs.statSync(path.join(repo, 'media/webview.js')).size;
  log(`built in ${Date.now() - started}ms — extension ${(size / 1024).toFixed(0)} KB, webview ${(webviewSize / 1024).toFixed(0)} KB`);
}
