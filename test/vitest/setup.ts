/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Setup file of the `extension` Vitest project.
//
// Vite's `vscode` alias only reaches modules Vite transforms: our sources and inlined ESM
// dependencies. CommonJS dependencies in node_modules (for example @vscode/extension-telemetry,
// @microsoft/vscode-azext-azureauth, vscode-languageclient) are loaded by Node and call
// `require('vscode')` themselves, which Node cannot resolve. Jest mapped those calls to the manual
// mock; here Node's CommonJS loader returns the very object this test file's `vscode` import gets,
// so ESM and CommonJS importers share one mock instance.
//
// Every test file runs in its own worker process (`isolate: true`), so Node's `require` cache, and
// with it this hook and the mock it hands out, is per test file, as it was under Jest.
//
// A test-level `vi.mock('vscode', factory)` replaces the module for ESM importers only. CommonJS
// dependencies keep seeing the shared default mock below.

import Module from 'module';
import * as vscode from 'vscode';

const sharedVscodeMock: unknown = (vscode as unknown as { default: unknown }).default;

type Load = (request: string, parent: unknown, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Load };
const originalLoad = loader._load;

loader._load = function (this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'vscode') {
        return sharedVscodeMock;
    }
    return originalLoad.call(this, request, parent, isMain);
};
