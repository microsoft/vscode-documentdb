/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync, inflateRawSync } = require('node:zlib');

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function validatePath(filename) {
    if (
        !filename ||
        filename.includes('\\') ||
        filename.includes(':') ||
        filename.includes('\0') ||
        path.posix.isAbsolute(filename) ||
        filename.split('/').some((part) => part === '..' || part === '.') ||
        /^[a-z]:/i.test(filename)
    ) {
        throw new Error(`Unsafe VSIX path: ${filename}`);
    }
}

function readVsix(filename) {
    const archive = fs.readFileSync(filename);
    let end = -1;
    for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset--) {
        if (
            archive.readUInt32LE(offset) === 0x06054b50 &&
            offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
        ) {
            end = offset;
            break;
        }
    }
    if (end < 0) {
        throw new Error('Invalid VSIX: ZIP end directory not found');
    }
    const count = archive.readUInt16LE(end + 10);
    const size = archive.readUInt32LE(end + 12);
    let cursor = archive.readUInt32LE(end + 16);
    const directoryEnd = cursor + size;
    if (
        archive.readUInt16LE(end + 4) !== 0 ||
        archive.readUInt16LE(end + 6) !== 0 ||
        archive.readUInt16LE(end + 8) !== count ||
        count === 0xffff ||
        directoryEnd !== end
    ) {
        throw new Error('Invalid or unsupported VSIX: multipart/ZIP64 directory');
    }
    const files = new Map();
    let totalBytes = 0;
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > directoryEnd || archive.readUInt32LE(cursor) !== 0x02014b50) {
            throw new Error('Invalid VSIX central directory entry');
        }
        const flags = archive.readUInt16LE(cursor + 8);
        const method = archive.readUInt16LE(cursor + 10);
        const checksum = archive.readUInt32LE(cursor + 16);
        const compressedSize = archive.readUInt32LE(cursor + 20);
        const uncompressedSize = archive.readUInt32LE(cursor + 24);
        const nameSize = archive.readUInt16LE(cursor + 28);
        const extraSize = archive.readUInt16LE(cursor + 30);
        const commentSize = archive.readUInt16LE(cursor + 32);
        const localOffset = archive.readUInt32LE(cursor + 42);
        const next = cursor + 46 + nameSize + extraSize + commentSize;
        if (next > directoryEnd) {
            throw new Error('Truncated VSIX directory entry');
        }
        const name = archive.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8');
        validatePath(name);
        if ((flags & 1) !== 0 || ![0, 8].includes(method) || uncompressedSize > 128 * 1024 * 1024) {
            throw new Error(`Unsupported or oversized VSIX entry: ${name}`);
        }
        if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
            throw new Error(`Invalid local VSIX entry: ${name}`);
        }
        const localNameSize = archive.readUInt16LE(localOffset + 26);
        const localExtraSize = archive.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameSize + localExtraSize;
        if (start + compressedSize > archive.readUInt32LE(end + 16)) {
            throw new Error(`Truncated VSIX payload: ${name}`);
        }
        const compressed = archive.subarray(start, start + compressedSize);
        const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 128 * 1024 * 1024 }) : compressed;
        totalBytes += data.length;
        if (data.length !== uncompressedSize || totalBytes > 512 * 1024 * 1024 || crc32(data) !== checksum) {
            throw new Error(`Corrupt or oversized VSIX payload: ${name}`);
        }
        if (!name.endsWith('/')) {
            if (files.has(name)) {
                throw new Error(`Duplicate VSIX entry: ${name}`);
            }
            files.set(name, data);
        }
        cursor = next;
    }
    if (cursor !== directoryEnd || !files.has('extension/package.json')) {
        throw new Error('Invalid VSIX: missing extension manifest or inconsistent directory');
    }
    return files;
}

function extractVsix(filename, destination) {
    for (const [name, content] of readVsix(filename)) {
        if (!name.startsWith('extension/')) {
            continue;
        }
        const target = path.join(destination, name.slice('extension/'.length));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
}

/**
 * Writes a ZIP archive. Entries are stored unless `compress` is set; then each entry is deflated
 * when that is smaller, so proof variants keep a VSIX size comparable to `vsce` output.
 */
function writeVsix(filename, files, { compress = false } = {}) {
    const parts = [];
    const directory = [];
    let offset = 0;
    for (const [name, data] of files) {
        validatePath(name);
        const encoded = Buffer.from(name);
        const checksum = crc32(data);
        const deflated = compress ? deflateRawSync(data) : undefined;
        const method = deflated && deflated.length < data.length ? 8 : 0;
        const payload = method === 8 ? deflated : data;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x800, 6);
        header.writeUInt16LE(method, 8);
        header.writeUInt32LE(checksum, 14);
        header.writeUInt32LE(payload.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(encoded.length, 26);
        parts.push(header, encoded, payload);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(encoded.length, 28);
        central.writeUInt32LE(offset, 42);
        directory.push(central, encoded);
        offset += header.length + encoded.length + payload.length;
    }
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.size, 8);
    end.writeUInt16LE(files.size, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    fs.writeFileSync(filename, Buffer.concat([...parts, central, end]));
}

module.exports = { readVsix, extractVsix, writeVsix };
