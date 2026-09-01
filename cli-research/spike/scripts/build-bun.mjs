/**
 * Build a self-contained executable with `bun build --compile`.
 *
 * Bun bundles TypeScript directly — no esbuild prerequisite. Pass --target to
 * cross-compile (e.g. bun-windows-x64, bun-darwin-arm64, bun-linux-x64) via:
 *   node scripts/build-bun.mjs [bun-target]
 *
 * Requires bun on PATH (locally: `curl -fsSL https://bun.sh/install | bash`;
 * CI: oven-sh/setup-bun).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const target = process.argv[2]; // optional, e.g. "bun-windows-x64"
const outDir = path.resolve('dist/bun');
fs.mkdirSync(outDir, { recursive: true });

const suffix = target?.includes('windows') || (!target && process.platform === 'win32') ? '.exe' : '';
const outBin = path.join(outDir, `documentdb-spike${target ? '-' + target : ''}${suffix}`);

// Same optional/lazy deps kept external as in the esbuild bundle (see build-bundle.mjs).
const EXTERNALS = [
    'kerberos',
    '@mongodb-js/zstd',
    '@aws-sdk/credential-providers',
    'mongodb-client-encryption',
    'snappy',
    'socks',
    'gcp-metadata',
    'aws4',
    'electron',
    'ssh2',
    'cpu-features',
    '@babel/preset-typescript',
];

const args = [
    'build',
    '--compile',
    'src/main.ts',
    '--outfile',
    outBin,
    ...EXTERNALS.flatMap((e) => ['--external', e]),
];
if (target) {
    args.push('--target', target);
}

console.log(`$ bun ${args.join(' ')}`);
execFileSync('bun', args, { stdio: 'inherit' });

const sizeMb = (fs.statSync(outBin).size / (1024 * 1024)).toFixed(1);
console.log(`\nBun binary ready: ${outBin} (${sizeMb} MB)`);
