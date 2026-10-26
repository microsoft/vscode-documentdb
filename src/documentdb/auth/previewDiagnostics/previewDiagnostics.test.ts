/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { type MongoClient } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { ConnectionDiagnosticsService } from '../../../services/connectionDiagnosticsService';
import { type AuthTraceContext } from '../../../utils/authTrace';
import { type CachedClusterCredentials } from '../../CredentialCache';
import { AuthMethodId } from '../AuthMethod';
import { type ResolvedTokenResource, TokenResourceResolutionError } from '../documentdbTokenResource';
import {
    previewAcquireToken, previewConnectionResult, previewResolve, resetPreviewDiagnosticsForTests,
    runPostConnectProbes, showPreviewDialog,
} from './previewDiagnostics';
import { formatPreviewReport, type PreviewReport } from './report';

vi.mock('../../../extensionVariables', () => ({
    ext: {
        context: { extension: { packageJSON: { version: '1.2.3' } } },
        outputChannel: { error: vi.fn() },
    },
}));

const credentials: CachedClusterCredentials = {
    clusterId: 'cluster', connectionString: 'mongodb://private-host/',
    authMechanism: AuthMethodId.MicrosoftEntraID,
};
const resolved: ResolvedTokenResource = {
    resource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
    scope: 'https://ossrdbms-aad.database.usgovcloudapi.net/.default',
    cloudCategory: 'usgov', reason: 'setting', details: { hostCloud: 'AzureUSGovernment' },
};
const context: AuthTraceContext = {
    startupCorrelationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', surface: 'extension',
};
const report: PreviewReport = {
    step: 1, surface: 'extension', extensionVersion: '1.2.3', vscodeVersion: '1.100.0',
    platform: 'linux', arch: 'x64', timestamp: '2026-10-26T10:09:16.000Z', resolved,
};
const never = new Promise<string | undefined>(() => undefined);

function client(command = vi.fn().mockResolvedValue({ ok: 1 })): MongoClient {
    return { db: vi.fn().mockReturnValue({ command }) } as unknown as MongoClient;
}

beforeEach((): void => {
    vi.clearAllMocks();
    resetPreviewDiagnosticsForTests();
    vi.mocked(vscode.window.showInformationMessage).mockReset().mockResolvedValue('Continue' as never);
    Object.defineProperty(vscode.env, 'clipboard', {
        configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
});

describe('preview dialog lifecycle', () => {
    it('deduplicates per cluster, surface and step without collisions', async () => {
        await showPreviewDialog('cluster', report, true);
        await showPreviewDialog('cluster', report, true);
        await showPreviewDialog('cluster', { ...report, surface: 'shell' }, false);
        await showPreviewDialog('cluster', { ...report, surface: 'playground' }, false);
        await showPreviewDialog('cluster', { ...report, step: 2 }, true);
        await showPreviewDialog('another-cluster', report, true);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(5);
    });

    it('returns before an unresolved nonblocking modal, even if cancellable', async () => {
        vi.mocked(vscode.window.showInformationMessage).mockReturnValue(never as never);
        await expect(showPreviewDialog('cluster', report, false, true)).resolves.toBeUndefined();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
    });

    it('copies fenced Markdown, toasts briefly and reopens the same dialog', async () => {
        vi.mocked(vscode.window.showInformationMessage)
            .mockResolvedValueOnce('Copy report' as never)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('Continue' as never);
        await showPreviewDialog('cluster', report, true, true);
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(formatPreviewReport(report));
        expect(vscode.window.showInformationMessage).toHaveBeenNthCalledWith(2, 'Report copied.');
        const calls = vi.mocked(vscode.window.showInformationMessage).mock.calls;
        expect(calls[0]).toEqual(calls[2]);
    });

    it('does not turn UI, clipboard or toast failures into auth failures or leak their messages', async () => {
        const error = new Error('secret-token mongodb://private-host/ user@example.invalid');
        vi.mocked(vscode.window.showInformationMessage).mockRejectedValueOnce(error);
        await expect(showPreviewDialog('a', report, true, true)).resolves.toBeUndefined();
        vi.mocked(vscode.window.showInformationMessage)
            .mockResolvedValueOnce('Copy report' as never).mockResolvedValueOnce('Continue' as never);
        vi.mocked(vscode.env.clipboard.writeText).mockRejectedValueOnce(error);
        await expect(showPreviewDialog('b', report, true)).resolves.toBeUndefined();
        vi.mocked(vscode.env.clipboard.writeText).mockResolvedValue(undefined);
        vi.mocked(vscode.window.showInformationMessage)
            .mockResolvedValueOnce('Copy report' as never).mockRejectedValueOnce(error).mockResolvedValueOnce('Continue' as never);
        await expect(showPreviewDialog('c', report, true)).resolves.toBeUndefined();
        vi.mocked(vscode.window.showInformationMessage).mockRejectedValueOnce(error);
        await showPreviewDialog('d', report, false);
        await Promise.resolve();
        expect(ext.outputChannel.error).toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(ext.outputChannel.error).mock.calls)).not.toContain(error.message);
    });

    it('throws repository cancellation only when blocking step 1 is dismissed', async () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
        await expect(showPreviewDialog('a', report, true, true)).rejects.toBeInstanceOf(UserCancelledError);
        await expect(showPreviewDialog('b', { ...report, step: 2 }, true)).resolves.toBeUndefined();
        await expect(showPreviewDialog('c', report, false, true)).resolves.toBeUndefined();
    });
});

describe('real preview stage ordering', () => {
    it.each(['Continue', undefined])('preserves a resolution failure and suppresses later stages after dialog response %s', async (choice): Promise<void> => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(choice as never);
        const error = new TokenResourceResolutionError('private-value', 'cloudMismatch', {});
        await expect(previewResolve(credentials, 'extension', context, async () => { throw error; })).rejects.toBe(error);
        await previewAcquireToken(credentials.clusterId, 'extension', context, async () => 'token', (token) => token);
        const connection = client();
        await previewConnectionResult(credentials.clusterId, context, connection, 10, error);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(connection.db).not.toHaveBeenCalled();
    });

    it('reports token failure, suppresses stage 3 and never replaces a failed token request', async () => {
        await previewResolve(credentials, 'extension', context, async () => resolved);
        const error = new Error('AADSTS65002 private-host');
        await expect(previewAcquireToken(credentials.clusterId, 'extension', context, async () => {
            throw error;
        }, (token: string) => token)).rejects.toBe(error);
        const connection = client();
        await previewConnectionResult(credentials.clusterId, context, connection, 10, error);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
        expect(connection.db).not.toHaveBeenCalled();
    });

    it('shows 1 then 2 then 3 and does not repeat dialogs or probes on refresh', async () => {
        const connection = client();
        await previewResolve(credentials, 'extension', context, async () => resolved);
        await previewAcquireToken(credentials.clusterId, 'extension', context, async () => 'token', (token) => token);
        await previewConnectionResult(credentials.clusterId, context, connection, 25);
        await previewResolve(credentials, 'extension', context, async () => resolved);
        await previewAcquireToken(credentials.clusterId, 'extension', context, async () => 'refresh', (token) => token);
        await previewConnectionResult(credentials.clusterId, context, connection, 25);
        const calls = vi.mocked(vscode.window.showInformationMessage).mock.calls;
        expect(calls.map((call) => call[0])).toEqual([
            expect.stringContaining('1 of 3'), expect.stringContaining('2 of 3'), expect.stringContaining('3 of 3'),
        ]);
        expect(connection.db).toHaveBeenCalledTimes(3);
        expect(calls[2][1]).toEqual(expect.objectContaining({ detail: expect.stringContaining('What this proves') }));
    });

    it.each([
        ['extension', true], ['shell', false], ['shell', true], ['playground', false], ['playground', true],
    ] as const)('never awaits token dialogs on %s (managed identity: %s)', async (surface, managedIdentity) => {
        await previewResolve(credentials, surface, context, async () => resolved, managedIdentity);
        vi.mocked(vscode.window.showInformationMessage).mockReturnValue(never as never);
        await expect(previewAcquireToken(credentials.clusterId, surface, context,
            async () => 'token', (token) => token, undefined, managedIdentity)).resolves.toBe('token');
    });

    it.each(['shell', 'playground'] as const)('never awaits resolution or failure dialogs on %s', async (surface) => {
        vi.mocked(vscode.window.showInformationMessage).mockReturnValue(never as never);
        await expect(previewResolve(credentials, surface, context, async () => resolved)).resolves.toBe(resolved);
        const error = new Error('private-error');
        await expect(previewAcquireToken(credentials.clusterId, surface, context,
            async () => { throw error; }, (token: string) => token)).rejects.toBe(error);
    });

    it('does not let a late callback supply stage 3 to a different startup', async () => {
        await previewResolve(credentials, 'extension', context, async () => resolved);
        await previewAcquireToken(credentials.clusterId, 'extension', context, async () => 'token', (token) => token);
        const connection = client();
        await previewConnectionResult(credentials.clusterId, { ...context, startupCorrelationId: 'different' }, connection, 0);
        expect(connection.db).not.toHaveBeenCalled();
    });

    it('asks diagnostics on connect failure without probing or copying endpoint-bearing provider text', async () => {
        await previewResolve(credentials, 'extension', context, async () => resolved);
        await previewAcquireToken(credentials.clusterId, 'extension', context, async () => 'token', (token) => token);
        const explain = vi.spyOn(ConnectionDiagnosticsService, 'explain').mockResolvedValue({
            providerId: 'kubernetes-port-forward', message: 'secret-service private-host',
        });
        const error = Object.assign(new Error('private-host'), { code: 18, name: 'MongoServerError' });
        const connection = client();
        await previewConnectionResult(credentials.clusterId, context, connection, 25, error);
        expect(explain).toHaveBeenCalledWith({ clusterId: credentials.clusterId, error });
        expect(connection.db).not.toHaveBeenCalled();
        const output = JSON.stringify(vi.mocked(vscode.window.showInformationMessage).mock.calls);
        expect(output).toContain('rejected authentication');
        expect(output).not.toContain('private-host');
        expect(output).not.toContain('secret-service');
        explain.mockRestore();
    });
});

describe('all three post-connect probes', () => {
    it('runs only admin commands and retains counts, never names or roles', async () => {
        const command = vi.fn()
            .mockResolvedValueOnce({ ok: 1 })
            .mockResolvedValueOnce({ databases: [{ name: 'private-db' }, { name: 'private-db2' }] })
            .mockResolvedValueOnce({ authInfo: { authenticatedUserRoles: [{ role: 'private-role', db: 'private-db' }] } });
        const connection = client(command);
        const probes = await runPostConnectProbes(connection);
        expect(probes).toEqual([
            { probe: 'ping', ok: true, count: undefined },
            { probe: 'listDatabases', ok: true, count: 2 },
            { probe: 'connectionStatus', ok: true, count: 1 },
        ]);
        expect(vi.mocked(connection.db).mock.calls).toEqual([['admin'], ['admin'], ['admin']]);
        expect(command.mock.calls.map((call) => call[0])).toEqual([
            { ping: 1, maxTimeMS: 5000 }, { listDatabases: 1, nameOnly: true, maxTimeMS: 5000 },
            { connectionStatus: 1, maxTimeMS: 5000 },
        ]);
        expect(JSON.stringify(probes)).not.toContain('private');
    });

    it.each([0, 1, 2])('reports probe %s failure without stopping the other probes', async (failureIndex) => {
        const command = vi.fn();
        for (let index = 0; index < 3; index++) {
            if (index === failureIndex) {
                command.mockRejectedValueOnce(Object.assign(new Error('private-host'), { code: 59, codeName: 'CommandNotFound' }));
            } else {
                command.mockResolvedValueOnce({ ok: 1 });
            }
        }
        const probes = await runPostConnectProbes(client(command));
        expect(probes.map((probe) => probe.ok)).toEqual([0, 1, 2].map((index) => index !== failureIndex));
        expect(command).toHaveBeenCalledTimes(3);
        expect(formatPreviewReport({ ...report, step: 3, probes })).not.toContain('private-host');
    });
});
