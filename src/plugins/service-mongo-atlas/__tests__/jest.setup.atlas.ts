/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Global Jest setup for Atlas service tests */

// Mock digest-fetch (ESM) with a simple constructor returning an object containing fetch.
// Allows tests to override behavior by redefining the returned fetch if needed.
jest.mock('digest-fetch', () => {
    return function MockDigestClient() {
        return {
            fetch: (_url: string, _init?: Record<string, unknown>) =>
                ({
                    ok: false,
                    status: 401,
                    text: () => Promise.resolve('Unauthorized'),
                }) as Response,
        };
    };
});
