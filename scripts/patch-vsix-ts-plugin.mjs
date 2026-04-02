/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Injects the TS server plugin node_modules stub into a VSIX file.
 *
 * Background: vsce's file collection uses glob with a hardcoded
 * `ignore: 'node_modules/**'` pattern, which means node_modules entries
 * are excluded before .vscodeignore patterns are applied. This prevents
 * the TS plugin stub from being included via .vscodeignore negation.
 *
 * This script adds the stub after vsce packaging.
 *
 * Usage: node scripts/patch-vsix-ts-plugin.mjs <path-to.vsix>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const vsixPath = path.resolve(process.argv[2]);
if (!vsixPath || !fs.existsSync(vsixPath)) {
    console.error(`VSIX file not found: ${vsixPath}`);
    process.exit(1);
}

const stubPath = path.join(projectRoot, 'dist', 'node_modules', 'documentdb-scratchpad-ts-plugin', 'package.json');
if (!fs.existsSync(stubPath)) {
    console.error(`TS plugin stub not found: ${stubPath}`);
    console.error('Run webpack build first.');
    process.exit(1);
}

const stubContent = fs.readFileSync(stubPath, 'utf8');
const vsixBuffer = fs.readFileSync(vsixPath);

const zip = await JSZip.loadAsync(vsixBuffer);
zip.file('extension/node_modules/documentdb-scratchpad-ts-plugin/package.json', stubContent);

const patched = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
});

fs.writeFileSync(vsixPath, patched);
console.log(`Injected TS plugin stub into ${path.basename(vsixPath)}`);
