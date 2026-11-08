#!/usr/bin/env node
/**
 * Publish the packaged VSIX to Open VSX.
 *
 * Usage:
 *   OVSX_PAT=<token> npm run publish:openvsx
 *
 * The token comes from https://open-vsx.org/user-settings/tokens (GitHub login,
 * no Microsoft account involved). The namespace must match `publisher` in
 * package.json; it is created automatically the first time.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const namespace = pkg.publisher;
const vsix = path.join(root, `buity-markdown-${pkg.version}.vsix`);
const token = process.env.OVSX_PAT?.trim();

const fail = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

const ovsx = (args, { allowFailure = false } = {}) => {
  try {
    const output = execFileSync(path.join(root, 'node_modules/.bin/ovsx'), args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    if (allowFailure) return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() };
    fail(`${args[0]} failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }
};

if (!token) {
  fail(
    [
      'OVSX_PAT is not set.',
      '',
      '  1. Sign in at https://open-vsx.org with your GitHub account',
      '  2. https://open-vsx.org/user-settings/tokens → Generate New Token',
      '  3. Export it and re-run:',
      '',
      `     OVSX_PAT=<token> npm run publish:openvsx`,
    ].join('\n'),
  );
}

if (!fs.existsSync(vsix)) {
  fail(`missing ${path.basename(vsix)} — run "npm run package" first.`);
}

console.log(`→ verifying token for namespace "${namespace}"`);
const verified = ovsx(['verify-pat', namespace, '-p', token], { allowFailure: true });
if (!verified.ok) {
  console.log(`→ namespace "${namespace}" not reachable, creating it`);
  const created = ovsx(['create-namespace', namespace, '-p', token], { allowFailure: true });
  if (!created.ok) fail(`cannot create namespace "${namespace}":\n${created.output}`);
  const recheck = ovsx(['verify-pat', namespace, '-p', token], { allowFailure: true });
  if (!recheck.ok) fail(`token still rejected for "${namespace}":\n${recheck.output}`);
}
console.log('✓ token accepted');

console.log(`→ publishing ${path.basename(vsix)} (${(fs.statSync(vsix).size / 1e6).toFixed(2)} MB)`);
const published = ovsx(
  ['publish', vsix, '-p', token, '--skip-duplicate', '--no-dependencies'],
  { allowFailure: true },
);
if (!published.ok) fail(`publish failed:\n${published.output}`);

console.log(published.output ? `  ${published.output}` : '✓ published');
console.log(`\n✓ ${namespace}.${pkg.name}@${pkg.version}`);
console.log(`  https://open-vsx.org/extension/${namespace}/${pkg.name}`);
console.log(`\nInstall with:\n  cursor --install-extension ${namespace}.${pkg.name}\n`);
