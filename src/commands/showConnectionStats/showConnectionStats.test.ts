/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthMethodId } from '../../documentdb/auth/AuthMethodId';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { showConnectionStats } from './showConnectionStats';

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getDiagnosticsSnapshot: vi.fn() },
}));

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { appendLog: vi.fn(), show: vi.fn() } },
}));

afterEach(() => {
    vi.useRealTimers();
});

it.each([
    ['2026-11-24T19:02:03.000Z', '2026-11-24T19:02:03.000Z (in 25:02:03)'],
    ['2026-11-23T18:00:00.001Z', '2026-11-23T18:00:00.001Z (in 00:00:01)'],
    ['2026-11-23T18:00:00.000Z', '2026-11-23T18:00:00.000Z (expired)'],
    [undefined, 'unknown'],
])('prints the UTC expiry with remaining time or status for %s', (expiry, expected): void => {
    vi.useFakeTimers({ now: new Date('2026-11-23T18:00:00.000Z') });
    vi.mocked(ClustersClient.getDiagnosticsSnapshot).mockReturnValueOnce([
        {
            client: {
                generation: 1,
                ageMs: 1000,
                authMethod: AuthMethodId.MicrosoftEntraID,
                state: 'cached',
                socketTrace: true,
                lastEntraTokenExpiresAt: expiry,
            },
        },
    ]);

    showConnectionStats({} as IActionContext);

    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(`    lastEntraTokenExpiresAt=${expected}`);
});
