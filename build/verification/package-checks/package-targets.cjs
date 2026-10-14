/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

function patternRegExp(pattern, star) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*\*|\*/g, (match) => (match === '**' ? '.*' : star))}$`);
}

/**
 * Every `main`, `module`, `types`, `typings`, `bin` and `exports` target in the packed package.json
 * must be a packed file, and every `files` entry must have packed at least one file.
 * @param {string} name
 * @param {Record<string, unknown>} manifest
 * @param {string[]} files packed paths, relative to the package root
 * @returns {string[]}
 */
function packageTargetFailures(name, manifest, files) {
    const targets = [];
    for (const field of ['main', 'module', 'types', 'typings']) {
        if (typeof manifest[field] === 'string') targets.push([field, manifest[field]]);
    }
    const bin = typeof manifest.bin === 'string' ? { [String(manifest.name)]: manifest.bin } : (manifest.bin ?? {});
    for (const [command, target] of Object.entries(bin)) targets.push([`bin.${command}`, target]);
    const walk = (value, where) => {
        if (typeof value === 'string') targets.push([where, value]);
        else if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) walk(item, `${where}[${JSON.stringify(key)}]`);
        }
    };
    walk(manifest.exports, 'exports');

    const packed = new Set(files);
    const failures = [];
    for (const [where, target] of targets) {
        const relative = target.replace(/^\.\//, '');
        // In `exports`, `*` stands for any string, including `/`.
        const found = relative.includes('*')
            ? files.some((file) => patternRegExp(relative, '.+').test(file))
            : packed.has(relative);
        if (!found) failures.push(`${name}: ${where} -> ${target} is not in the tarball`);
    }
    for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
        if (entry.startsWith('!')) continue;
        const relative = entry.replace(/^\.?\//, '').replace(/\/$/, '');
        const glob = patternRegExp(relative, '[^/]*');
        if (!files.some((file) => file === relative || file.startsWith(`${relative}/`) || glob.test(file))) {
            failures.push(`${name}: files entry "${entry}" packed nothing`);
        }
    }
    return failures;
}

module.exports = { packageTargetFailures };
