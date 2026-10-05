/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTsPluginStub, TS_PLUGIN_PACKAGE_NAME, TS_PLUGIN_STUB_FILES } from './tsPluginStub';

vi.mock(import('fs'), async (importOriginal) => ({ ...(await importOriginal()) }));

describe('ensureTsPluginStub', () => {
    let extensionPath: string;
    let stubDir: string;

    beforeEach(() => {
        extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-ts-plugin-stub-'));
        stubDir = path.join(extensionPath, 'node_modules', TS_PLUGIN_PACKAGE_NAME);
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

    it.each(['created', 'replaced'] as const)(
        'publishes complete files across two interleaved writers when the stub is %s',
        (result) => {
            const previous: Record<string, string> = {
                'index.cjs': 'module.exports = require("../../playgroundTsPlugin.js");\n',
                'package.json': '{"main":"index.js","type":"commonjs"}\n',
            };
            if (result === 'replaced') {
                fs.mkdirSync(stubDir, { recursive: true });
                for (const [fileName, content] of Object.entries(previous)) {
                    fs.writeFileSync(path.join(stubDir, fileName), content);
                }
                fs.writeFileSync(path.join(stubDir, 'index.js'), previous['index.cjs']);
            }

            let observations = 0;
            const readPublishedFiles = (): void => {
                for (const [fileName, content] of Object.entries(TS_PLUGIN_STUB_FILES)) {
                    const filePath = path.join(stubDir, fileName);
                    if (fs.existsSync(filePath)) {
                        const published = fs.readFileSync(filePath, 'utf8');
                        expect([previous[fileName], content]).toContain(published);
                        if (fileName === 'package.json') {
                            expect(() => JSON.parse(published)).not.toThrow();
                        }
                        observations++;
                    }
                }
            };

            const writeFileSync = fs.writeFileSync;
            const temporaryPaths: string[] = [];
            vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options): void => {
                const filePath = String(file);
                expect(path.dirname(filePath)).toBe(stubDir);
                expect(filePath).toMatch(/(?:index\.cjs|package\.json)\.\d+\.[\da-f-]+\.tmp$/);
                expect(options).toEqual({ flag: 'wx' });
                if (typeof data !== 'string') {
                    throw new Error('Expected string stub contents');
                }
                temporaryPaths.push(filePath);
                // Observe the final names during a truncate/partial-write window.
                writeFileSync(file, data.slice(0, 5), options);
                readPublishedFiles();
                writeFileSync(file, data);
                readPublishedFiles();
            });
            const renameSync = fs.renameSync;
            const publications: string[] = [];
            vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath): void => {
                readPublishedFiles();
                renameSync(oldPath, newPath);
                publications.push(path.basename(String(newPath)));
                readPublishedFiles();
            });
            const mkdirSync = fs.mkdirSync;
            let secondWriterStarted = false;
            vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, options) => {
                if (!secondWriterStarted) {
                    // A has read its snapshot; B finishes before A resumes those stale writes.
                    secondWriterStarted = true;
                    expect(ensureTsPluginStub(extensionPath)).toBe(result);
                    readPublishedFiles();
                }
                return mkdirSync(directory, options);
            });

            expect(ensureTsPluginStub(extensionPath)).toBe(result);
            expect(publications).toEqual(['index.cjs', 'package.json', 'index.cjs', 'package.json']);
            expect(new Set(temporaryPaths).size).toBe(4);
            expect(observations).toBeGreaterThan(0);
            expect(stubFiles()).toEqual(['index.cjs', 'package.json']);
            for (const [fileName, content] of Object.entries(TS_PLUGIN_STUB_FILES)) {
                expect(fs.readFileSync(path.join(stubDir, fileName), 'utf8')).toBe(content);
            }
            expect(ensureTsPluginStub(extensionPath)).toBe('existed');
        },
    );

    it.each([
        { fileName: 'index.cjs', code: 'EACCES' },
        { fileName: 'package.json', code: 'EROFS' },
        { fileName: 'package.json', code: 'EPERM' },
        { fileName: 'package.json', code: 'EBUSY' },
    ])('cleans up and propagates $code when publishing $fileName fails', ({ fileName, code }) => {
        ensureTsPluginStub(extensionPath);
        const previousEntry = 'module.exports = {};\n';
        const previousManifest = '{"main":"index.js"}\n';
        fs.writeFileSync(path.join(stubDir, 'index.cjs'), previousEntry);
        fs.writeFileSync(path.join(stubDir, 'package.json'), previousManifest);
        fs.writeFileSync(path.join(stubDir, 'index.js'), previousEntry);
        const failure = Object.assign(new Error('Cannot replace stub file'), { code });
        const renameSync = fs.renameSync;
        vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath): void => {
            if (newPath === path.join(stubDir, fileName)) {
                throw failure;
            }
            renameSync(oldPath, newPath);
        });

        let caught: unknown;
        try {
            ensureTsPluginStub(extensionPath);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBe(failure);
        expect(stubFiles()).toEqual(['index.cjs', 'index.js', 'package.json']);
        expect(fs.readFileSync(path.join(stubDir, 'package.json'), 'utf8')).toBe(previousManifest);
        expect(fs.readFileSync(path.join(stubDir, 'index.cjs'), 'utf8')).toBe(
            fileName === 'index.cjs' ? previousEntry : TS_PLUGIN_STUB_FILES['index.cjs'],
        );
    });

    it('removes a partial temporary file when writing fails', () => {
        const failure = Object.assign(new Error('Cannot write stub file'), { code: 'EROFS' });
        const writeFileSync = fs.writeFileSync;
        vi.spyOn(fs, 'writeFileSync').mockImplementation((file, _data, options): void => {
            writeFileSync(file, 'partial', options);
            throw failure;
        });

        expect(() => ensureTsPluginStub(extensionPath)).toThrow(failure);
        expect(stubFiles()).toEqual([]);
    });

    it('preserves the publication error even if temporary-file cleanup fails', () => {
        const failure = Object.assign(new Error('Cannot rename stub file'), { code: 'EACCES' });
        vi.spyOn(fs, 'renameSync').mockImplementation((): never => {
            throw failure;
        });
        vi.spyOn(fs, 'rmSync').mockImplementation((): never => {
            throw new Error('Cannot clean up temporary file');
        });

        let caught: unknown;
        try {
            ensureTsPluginStub(extensionPath);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBe(failure);
    });
});
