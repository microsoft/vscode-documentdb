/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Minimal `vscode` module for the package probes. The Node probes install it as
// `node_modules/vscode`; the Vitest probe reaches it through a `vscode` alias instead.
'use strict';

module.exports = {
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    Uri: { file: (fsPath) => ({ fsPath, toString: () => `file://${fsPath}` }) },
    ViewColumn: { Active: -1, One: 1 },
    l10n: { t: (message) => message, bundle: {} },
    window: {},
};
