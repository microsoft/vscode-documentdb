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
    [undefined, '(not available)'],
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

    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(`    Last Entra token expires at: ${expected}`);
});

it('formats host records with units, availability, and lifecycle facts', (): void => {
    vi.mocked(ClustersClient.getDiagnosticsSnapshot).mockReturnValueOnce([
        {
            client: {
                generation: 4,
                ageMs: 32000,
                authMethod: AuthMethodId.NativeAuth,
                startupId: undefined,
                state: 'cached',
                socketTrace: false,
            },
            pending: { startupId: 'pending-startup', superseded: true },
            held: 'credentialsUpdating',
            lastFailedStartupId: 'failed-startup',
        },
    ]);

    showConnectionStats({} as IActionContext);

    const output = vi.mocked(ext.outputChannel.appendLog).mock.calls.map(([line]) => line);
    expect(output).toEqual(
        expect.arrayContaining([
            '[Connection Stats]',
            '  Entries: 1',
            '  Connection 1:',
            '    Client state: cached',
            '    Generation: 4',
            '    Age (ms): 32000',
            '    Startup ID: (not available)',
            '    Socket trace: false',
            '    Pending state: superseded',
            '    Pending startup ID: pending-startup',
            '    Held reason: credentialsUpdating',
            '    Last failed startup ID: failed-startup',
        ]),
    );
});

it('does not expose values outside the diagnostics fields', (): void => {
    const snapshot = [
        {
            client: {
                generation: 1,
                ageMs: 10,
                authMethod: AuthMethodId.NativeAuth,
                state: 'cached' as const,
                socketTrace: true,
                connectionString: 'mongodb://user:password@example.test/',
                accessToken: 'secret-access-token',
            },
        },
    ];
    vi.mocked(ClustersClient.getDiagnosticsSnapshot).mockReturnValueOnce(snapshot);

    showConnectionStats({} as IActionContext);

    const output = vi.mocked(ext.outputChannel.appendLog).mock.calls.flat().join('\n');
    expect(output).not.toContain('password');
    expect(output).not.toContain('secret-access-token');
    expect(output).not.toContain('mongodb://');
});
