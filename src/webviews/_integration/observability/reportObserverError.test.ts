/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reportObserverError } from './reportObserverError';

describe('reportObserverError (R766-N05)', () => {
    let consoleErr: jest.SpyInstance;
    let originalReportError: unknown;

    beforeEach(() => {
        consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {});
        originalReportError = (globalThis as { reportError?: unknown }).reportError;
    });

    afterEach(() => {
        consoleErr.mockRestore();
        (globalThis as { reportError?: unknown }).reportError = originalReportError;
    });

    it('logs structured path/phase context and elevates to reportError() when available', () => {
        const reportError = jest.fn();
        (globalThis as { reportError?: unknown }).reportError = reportError;
        const boom = new Error('observer boom');

        reportObserverError(boom, { info: { type: 'query', path: 'documents.find' }, phase: 'error' });

        expect(consoleErr).toHaveBeenCalledWith(expect.stringContaining("'error' of 'documents.find'"), boom);
        expect(reportError).toHaveBeenCalledWith(boom);
    });

    it('wraps non-Error values and still logs when reportError is unavailable', () => {
        (globalThis as { reportError?: unknown }).reportError = undefined;

        reportObserverError('a string failure', {
            info: { type: 'mutation', path: 'documents.save' },
            phase: 'success',
        });

        expect(consoleErr).toHaveBeenCalledTimes(1);
        // Non-Error inputs are normalized to an Error before logging.
        expect(consoleErr.mock.calls[0][1]).toBeInstanceOf(Error);
        expect((consoleErr.mock.calls[0][1] as Error).message).toBe('a string failure');
    });
});
