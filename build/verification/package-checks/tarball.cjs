/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Minimal reader and writer for npm's gzipped tarballs, so the package checks need neither `tar`
// (absent or GNU tar on Windows agents) nor npm to look inside an archive.
'use strict';

const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { gunzipSync, gzipSync } = require('node:zlib');

const BLOCK = 512;

/**
 * Reads a `.tgz`. File paths are relative to the archive's top folder (`package/` for npm).
 * Rejects a member whose size field is not octal or overruns the archive, and a path that
 * occurs twice: npm installs the last copy, so reading the first could check other bytes.
 * @param {string} file
 * @returns {{ sha256: string, bytes: number, files: { path: string, data: Buffer }[] }}
 */
function readTarball(file) {
    const archive = readFileSync(file);
    const data = gunzipSync(archive);
    const files = [];
    const seen = new Set();
    let longPath;
    for (let offset = 0; offset + BLOCK <= data.length; ) {
        const header = data.subarray(offset, offset + BLOCK);
        if (header.every((byte) => byte === 0)) break;
        const field = (start, length) => header.toString('utf8', start, start + length).replace(/\0[\s\S]*$/, '');
        const sizeField = header
            .toString('latin1', 124, 136)
            .replace(/[\0 ]+$/, '')
            .trimStart();
        if (!/^[0-7]{1,11}$/.test(sizeField)) {
            throw new Error(`${path.basename(file)}: invalid tar size field ${JSON.stringify(sizeField)} at ${offset}`);
        }
        const size = parseInt(sizeField, 8);
        const end = offset + BLOCK + Math.ceil(size / BLOCK) * BLOCK;
        if (end > data.length) {
            throw new Error(
                `${path.basename(file)}: tar member at ${offset} declares ${size} bytes, past the end of the archive`,
            );
        }
        const type = field(156, 1) || '0';
        const body = data.subarray(offset + BLOCK, offset + BLOCK + size);
        offset = end;
        if (type === 'x') {
            longPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1] ?? longPath;
        } else if (type === 'L') {
            longPath = body.toString('utf8').replace(/\0[\s\S]*$/, '');
        } else if (type === 'g' || type === '5') {
            longPath = undefined;
        } else if (type === '0') {
            const prefix = field(345, 155);
            const name = longPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
            longPath = undefined;
            const member = name.slice(name.indexOf('/') + 1);
            const key = path.posix.normalize(member.replaceAll('\\', '/'));
            if (seen.has(key)) throw new Error(`${path.basename(file)}: duplicate tar member ${member}`);
            seen.add(key);
            files.push({ path: member, data: Buffer.from(body) });
        } else {
            throw new Error(`${path.basename(file)}: unsupported tar entry type '${type}'`);
        }
    }
    return { sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.length, files };
}

/**
 * Writes the files under `destination`, refusing any path that would leave it.
 * @param {{ path: string, data: Buffer }[]} files
 * @param {string} destination
 */
function extractFiles(files, destination) {
    const root = path.resolve(destination);
    for (const file of files) {
        const target = path.resolve(root, file.path);
        if (path.isAbsolute(file.path) || !target.startsWith(root + path.sep)) {
            throw new Error(`Refusing to extract ${file.path} outside ${root}`);
        }
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.data);
    }
}

/**
 * Writes a `.tgz` with every file under `package/`, as `npm pack` does.
 * @param {string} file
 * @param {{ path: string, data: Buffer | string }[]} files
 */
function writeTarball(file, files) {
    const blocks = [];
    for (const entry of files) {
        const name = `package/${entry.path}`;
        const data = Buffer.from(entry.data);
        // ustar splits long paths into a prefix (155 bytes) and a name (100 bytes).
        const split = name.length > 100 ? name.lastIndexOf('/', 155) : -1;
        if (name.length > 100 && (split < 0 || name.length - split - 1 > 100)) {
            throw new Error(`Path too long for a ustar header: ${name}`);
        }
        const header = Buffer.alloc(BLOCK);
        header.write(split < 0 ? name : name.slice(split + 1), 0, 100);
        header.write('0000644\0', 100);
        header.write('0000000\0', 108);
        header.write('0000000\0', 116);
        header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
        header.write('00000000000\0', 136);
        header.write('        ', 148);
        header.write('0', 156);
        header.write('ustar\0', 257);
        header.write('00', 263);
        if (split >= 0) header.write(name.slice(0, split), 345, 155);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
        blocks.push(header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
    }
    blocks.push(Buffer.alloc(2 * BLOCK));
    writeFileSync(file, gzipSync(Buffer.concat(blocks)));
}

module.exports = { readTarball, extractFiles, writeTarball };
