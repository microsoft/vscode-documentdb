/**
 * Build a Node SEA (Single Executable Application) from dist/bundle.cjs.
 *
 * Steps (per https://nodejs.org/api/single-executable-applications.html):
 *   1. node --experimental-sea-config sea-config.json   -> dist/sea-prep.blob
 *   2. copy the running node binary                     -> dist/sea/documentdb-spike[.exe]
 *   3. (macOS) codesign --remove-signature
 *   4. postject inject the blob under NODE_SEA_BLOB (+ NODE_SEA segment on macOS)
 *   5. (macOS) ad-hoc re-sign so Gatekeeper will execute it locally
 *
 * SEA cannot cross-compile: this script produces a binary for the OS/arch it runs on.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const outDir = path.resolve('dist/sea');
const outBin = path.join(outDir, isWindows ? 'documentdb-spike.exe' : 'documentdb-spike');

const run = (cmd, args) => {
    console.log(`$ ${cmd} ${args.join(' ')}`);
    execFileSync(cmd, args, { stdio: 'inherit' });
};

fs.mkdirSync(outDir, { recursive: true });

// 1. Generate the SEA prep blob.
run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);

// 2. Copy the node binary.
fs.copyFileSync(process.execPath, outBin);
fs.chmodSync(outBin, 0o755);

// 3. macOS: remove the existing signature before injection.
if (isMac) {
    run('codesign', ['--remove-signature', outBin]);
}

// 4. Inject the blob with postject.
const postjectArgs = [
    path.resolve('node_modules/postject/dist/cli.js'),
    outBin,
    'NODE_SEA_BLOB',
    path.resolve('dist/sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (isMac) {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}
run(process.execPath, postjectArgs);

// 5. macOS: ad-hoc re-sign (a real release would use a Developer ID identity + notarization).
if (isMac) {
    run('codesign', ['--sign', '-', outBin]);
}

const sizeMb = (fs.statSync(outBin).size / (1024 * 1024)).toFixed(1);
console.log(`\nSEA binary ready: ${outBin} (${sizeMb} MB, node ${process.version}, ${process.platform}/${process.arch})`);
