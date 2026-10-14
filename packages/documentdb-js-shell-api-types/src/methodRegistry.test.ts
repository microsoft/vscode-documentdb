/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it } from 'vitest';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getShellApiDtsContent } from './index.js';
import { getMethodsByTarget, getRequiredServerCommands, SHELL_API_METHODS } from './methodRegistry.js';

describe('getShellApiDtsContent', () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    function createDeclarations(content: string): string {
        const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-shell-api-types-'));
        temporaryDirectories.push(outputDirectory);
        const typeDefsDirectory = path.join(outputDirectory, 'typeDefs');
        fs.mkdirSync(typeDefsDirectory);
        fs.writeFileSync(path.join(typeDefsDirectory, 'documentdb-shell-api.d.ts'), content);
        return typeDefsDirectory;
    }

    it('reads the real package typeDefs file by default', () => {
        const declarationsPath = path.resolve(import.meta.dirname, '..', 'typeDefs', 'documentdb-shell-api.d.ts');
        const expected = fs.readFileSync(declarationsPath, 'utf8');

        expect(getShellApiDtsContent()).toBe(expected);
        expect(expected.length).toBeGreaterThan(10_000);
        expect(expected).toContain('declare');
    });

    it('reads an explicit output-root typeDefs directory after reading the package default', () => {
        const packageContent = getShellApiDtsContent();
        const content = 'declare const bundledDocumentDB: string;\n';
        const typeDefsDirectory = createDeclarations(content);

        expect(getShellApiDtsContent(typeDefsDirectory)).toBe(content);
        expect(getShellApiDtsContent()).toBe(packageContent);
    });

    it('keeps declarations from different explicit directories separate', () => {
        const firstContent = 'declare const firstDocumentDB: string;\n';
        const secondContent = 'declare const secondDocumentDB: number;\n';
        const firstDirectory = createDeclarations(firstContent);
        const secondDirectory = createDeclarations(secondContent);

        expect(getShellApiDtsContent(firstDirectory)).toBe(firstContent);
        expect(getShellApiDtsContent(secondDirectory)).toBe(secondContent);
        expect(getShellApiDtsContent(firstDirectory)).toBe(firstContent);
    });

    it('caches the content of each resolved declarations file', () => {
        const content = 'declare const cachedDocumentDB: string;\n';
        const typeDefsDirectory = createDeclarations(content);

        expect(getShellApiDtsContent(typeDefsDirectory)).toBe(content);
        fs.unlinkSync(path.join(typeDefsDirectory, 'documentdb-shell-api.d.ts'));
        expect(getShellApiDtsContent(typeDefsDirectory)).toBe(content);
    });
});

describe('methodRegistry', () => {
    it('should have methods for all target types', () => {
        expect(getMethodsByTarget('database').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('collection').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('findCursor').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('aggregationCursor').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('global').length).toBeGreaterThan(0);
    });

    it('should have unique method names within each target', () => {
        const targets = ['database', 'collection', 'findCursor', 'aggregationCursor', 'global'] as const;
        for (const target of targets) {
            const methods = getMethodsByTarget(target);
            const names = methods.map((m) => m.name);
            const unique = new Set(names);
            expect(unique.size).toBe(names.length);
        }
    });

    it('should have non-empty server commands for non-shell-only methods', () => {
        for (const method of SHELL_API_METHODS) {
            if (!method.shellOnly) {
                expect(method.serverCommands.length).toBeGreaterThan(0);
            }
        }
    });

    it('should have empty server commands for shell-only methods', () => {
        for (const method of SHELL_API_METHODS) {
            if (method.shellOnly) {
                expect(method.serverCommands).toHaveLength(0);
            }
        }
    });

    it('should return required server commands sorted and deduplicated', () => {
        const commands = getRequiredServerCommands();
        expect(commands.length).toBeGreaterThan(0);

        // Should be sorted
        const sorted = [...commands].sort();
        expect(commands).toEqual(sorted);

        // Should be unique
        const unique = new Set(commands);
        expect(unique.size).toBe(commands.length);
    });

    it('should include expected high-level commands', () => {
        const commands = getRequiredServerCommands();
        expect(commands).toContain('find');
        expect(commands).toContain('insert');
        expect(commands).toContain('update');
        expect(commands).toContain('delete');
        expect(commands).toContain('aggregate');
        expect(commands).toContain('createIndexes');
    });
});
