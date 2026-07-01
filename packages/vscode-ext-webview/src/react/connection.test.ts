/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VsCodeApiLike } from '../webview/connectTrpc';
import { getWebviewConnection } from './connection';

/**
 * Build a minimal fake `vscodeApi`. Each call returns a distinct object so it
 * stands in for a separate webview.
 */
function makeApi(): VsCodeApiLike {
    return { postMessage: () => {} };
}

describe('getWebviewConnection', () => {
    it('returns one shared { client, events } instance per vscodeApi', () => {
        const api = makeApi();

        const first = getWebviewConnection(api);
        const second = getWebviewConnection(api);

        // Both hooks resolve through this helper, so client and events must come
        // from the very same connection for a given webview.
        expect(second).toBe(first);
        expect(second.client).toBe(first.client);
        expect(second.events).toBe(first.events);
    });

    it('gives different webviews (distinct vscodeApi) independent connections', () => {
        const first = getWebviewConnection(makeApi());
        const second = getWebviewConnection(makeApi());

        expect(second).not.toBe(first);
        expect(second.client).not.toBe(first.client);
        expect(second.events).not.toBe(first.events);
    });
});
