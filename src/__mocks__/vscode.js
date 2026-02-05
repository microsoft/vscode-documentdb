/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line no-undef,@typescript-eslint/no-require-imports
const vsCodeMock = require('jest-mock-vscode').createVSCodeMock(jest);

vsCodeMock.l10n = {
    t: jest.fn((message, ...args) => {
        // Simple template string replacement for testing
        let result = message;
        args.forEach((arg, index) => {
            result = result.replace(`{${index}}`, String(arg));
        });
        return result;
    }),
};

// CancellationTokenSource mock for AzureWizard
vsCodeMock.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
        this.token = {
            isCancellationRequested: false,
            onCancellationRequested: jest.fn(),
        };
    }
    cancel() {
        this.token.isCancellationRequested = true;
    }
    dispose() {}
};

module.exports = vsCodeMock;
