/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

// The route a CommonJS dependency's `require('vscode')` takes: Node's loader and the setup.ts hook.
const requireFromCommonJs = createRequire(__filename);

describe('vscode mock identity (test/vitest/setup.ts)', () => {
    it('gives CommonJS require("vscode") the mock instance ESM importers get', () => {
        const required = requireFromCommonJs('vscode') as typeof vscode;

        expect(required).toBe((vscode as unknown as { default: unknown }).default);
        expect(required.window).toBe(vscode.window);
        expect(required.commands).toBe(vscode.commands);
        expect(required.workspace).toBe(vscode.workspace);
        expect(required.Uri).toBe(vscode.Uri);
    });

    it('keeps CommonJS on the shared mock when a test replaces vscode with a factory', async () => {
        const window = { showInformationMessage: vi.fn() };
        vi.doMock('vscode', () => ({ window }));
        try {
            const factoryMock = await import('vscode');

            expect(factoryMock.window).toBe(window);
            expect((requireFromCommonJs('vscode') as typeof vscode).window).toBe(vscode.window);
        } finally {
            vi.doUnmock('vscode');
        }
    });
});
