/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class DiagnosticsConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DiagnosticsConfigurationError';
    }
}

export class DiagnosticsCancelledError extends Error {
    constructor() {
        super('The connection diagnosis was cancelled.');
        this.name = 'AbortError';
    }
}
