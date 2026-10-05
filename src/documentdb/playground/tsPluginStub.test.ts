/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureTsPluginStub, TS_PLUGIN_PACKAGE_NAME, TS_PLUGIN_STUB_FILES } from './tsPluginStub';

describe('ensureTsPluginStub', () => {
    let extensionPath: string;
    let stubDir: string;

    beforeEach(() => {
        extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-ts-plugin-stub-'));
        stubDir = path.join(extensionPath, 'node_modules', TS_PLUGIN_PACKAGE_NAME);
    });

    afterEach(() => {
        fs.rmSync(extensionPath, { recursive: true, force: true });
    });

    const stubFiles = (): string[] => fs.readdirSync(stubDir).sort();

    it('creates the stub when there is none', () => {
        expect(ensureTsPluginStub(extensionPath)).toBe('created');
        expect(stubFiles()).toEqual(['index.cjs', 'package.json']);
        for (const [fileName, content] of Object.entries(TS_PLUGIN_STUB_FILES)) {
            expect(fs.readFileSync(path.join(stubDir, fileName), 'utf8')).toBe(content);
        }
    });

    it('leaves an up-to-date stub untouched', () => {
        ensureTsPluginStub(extensionPath);
        const mtimes = stubFiles().map((fileName) => fs.statSync(path.join(stubDir, fileName)).mtimeMs);

        expect(ensureTsPluginStub(extensionPath)).toBe('existed');
        expect(stubFiles().map((fileName) => fs.statSync(path.join(stubDir, fileName)).mtimeMs)).toEqual(mtimes);
    });

    it('replaces the CommonJS-era stub (index.js only)', () => {
        fs.mkdirSync(stubDir, { recursive: true });
        fs.writeFileSync(path.join(stubDir, 'index.js'), 'module.exports = require("../../playgroundTsPlugin.js");\n');

        expect(ensureTsPluginStub(extensionPath)).toBe('replaced');
        expect(stubFiles()).toEqual(['index.cjs', 'package.json']);
    });

    it('rewrites a stub file whose content differs', () => {
        ensureTsPluginStub(extensionPath);
        fs.writeFileSync(path.join(stubDir, 'package.json'), '{"main":"index.js"}\n');

        expect(ensureTsPluginStub(extensionPath)).toBe('replaced');
        expect(fs.readFileSync(path.join(stubDir, 'package.json'), 'utf8')).toBe(TS_PLUGIN_STUB_FILES['package.json']);
    });

    it('loads the CommonJS plugin bundle with require() under a "type": "module" extension package', () => {
        // The shipped extension package.json declares ESM; the stub must stay CommonJS regardless.
        fs.writeFileSync(path.join(extensionPath, 'package.json'), '{"type":"module"}\n');
        fs.writeFileSync(
            path.join(extensionPath, 'playgroundTsPlugin.cjs'),
            'module.exports = function pluginModuleFactory() { return { create: () => undefined }; };\n',
        );
        ensureTsPluginStub(extensionPath);

        const requireFromExtension = createRequire(path.join(extensionPath, 'index.cjs'));
        const factory: unknown = requireFromExtension(TS_PLUGIN_PACKAGE_NAME);
        expect(typeof factory).toBe('function');
        expect((factory as () => object)()).toHaveProperty('create');
    });

    it('surfaces file system errors so callers can detect read-only installs', () => {
        fs.writeFileSync(path.join(extensionPath, 'node_modules'), 'not a directory');

        expect(() => ensureTsPluginStub(extensionPath)).toThrow();
    });
});
