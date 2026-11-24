/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerConnectionSurface, type ConnectionSurface } from './connectionSurfaces';
import { commitTeardown, confirmTeardown, latchForTeardown, teardownConnection } from './connectionTeardown';

const mocks = vi.hoisted(() => ({
    getSetting: vi.fn(),
    getConflictingTasks: vi.fn(),
    getLatchReason: vi.fn(),
    latch: vi.fn(),
    deleteClient: vi.fn(),
    clearLastVerifiedIdentity: vi.fn(),
    deleteCredentials: vi.fn(),
    clearEntraTokenFailure: vi.fn(),
    getRegisteredShellTerminals: vi.fn(),
    getPlaygroundEvaluators: vi.fn(),
    stopPlaygroundEvaluator: vi.fn(),
    event: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
    callWithTelemetryAndErrorHandling: async (
        event: string,
        callback: (context: { telemetry: object; errorHandling: object }) => Promise<void>,
    ): Promise<void> => {
        const telemetry = { properties: {}, measurements: {} };
        try {
            await callback({ telemetry, errorHandling: {} });
        } finally {
            mocks.event(event, telemetry);
        }
    },
}));
vi.mock('../services/SettingsService', () => ({ SettingsService: { getSetting: mocks.getSetting } }));
vi.mock('../services/taskService/taskService', () => ({ TaskService: { getConflictingTasks: mocks.getConflictingTasks } }));
vi.mock('./ClustersClient', () => ({ ClustersClient: { ...mocks, exists: () => true } }));
vi.mock('./CredentialCache', () => ({ CredentialCache: { deleteCredentials: mocks.deleteCredentials } }));
vi.mock('./auth/entraErrors/entraTokenFailures', () => ({ clearEntraTokenFailure: mocks.clearEntraTokenFailure }));
vi.mock('./shell/ShellTerminalLinkProvider', () => ({ getRegisteredShellTerminals: mocks.getRegisteredShellTerminals }));
vi.mock('../commands/playground/executePlaygroundCode', () => ({
    getPlaygroundEvaluators: mocks.getPlaygroundEvaluators,
    stopPlaygroundEvaluator: mocks.stopPlaygroundEvaluator,
}));

const clusterId = 'example-cluster';
const otherId = 'other-cluster';
const refreshTree = vi.fn();
const showWarning = vi.mocked(vscode.window.showWarningMessage);
const showError = vi.mocked(vscode.window.showErrorMessage);
const registrations: vscode.Disposable[] = [];

function register(kind: ConnectionSurface['kind'], dirty = false, target = clusterId): ConnectionSurface {
    const surface = { clusterId: target, kind, isDirty: () => dirty, disable: vi.fn(), dispose: vi.fn() };
    registrations.push(registerConnectionSurface(surface));
    return surface;
}

describe('connection teardown', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getConflictingTasks.mockReturnValue([]);
        mocks.getRegisteredShellTerminals.mockReturnValue([]);
        mocks.getPlaygroundEvaluators.mockReturnValue(new Map());
        vi.spyOn(vscode.l10n, 't').mockImplementation(l10n.t);
    });

    afterEach(() => {
        for (const registration of registrations.splice(0)) {
            registration.dispose();
        }
        vi.restoreAllMocks();
    });

    it('skips the choice modal when there are no surfaces and leaves preflight read-only', async () => {
        await expect(confirmTeardown(clusterId, 'userDisconnected')).resolves.toEqual({
            outcome: 'confirmed',
            choice: 'close',
        });
        expect(showWarning).not.toHaveBeenCalled();
        expect(mocks.latch).not.toHaveBeenCalled();
        expect(mocks.deleteClient).not.toHaveBeenCalled();
    });

    it.each(['userDisconnected', 'connectionRemoved'] as const)(
        'always asks before discarding dirty editors for %s, even with closeAll configured',
        async (reason) => {
            const draft = register('documentView', true);
            mocks.getSetting.mockReturnValue('closeAll');
            await expect(confirmTeardown(clusterId, reason)).resolves.toEqual({ outcome: 'cancelled' });
            expect(showWarning).toHaveBeenCalledExactlyOnceWith(
                'Discard unsaved document changes?',
                expect.objectContaining({ modal: true }),
                'Discard changes',
            );
            expect(draft.dispose).not.toHaveBeenCalled();
            expect(mocks.latch).not.toHaveBeenCalled();
        },
    );

    it('honors modal cancellation without changing the connection', async () => {
        const draft = register('documentView', true);
        await expect(teardownConnection(clusterId, 'userDisconnected', refreshTree)).rejects.toBeInstanceOf(
            UserCancelledError,
        );
        expect(showWarning).toHaveBeenCalledExactlyOnceWith(
            'Disconnect?',
            expect.objectContaining({ modal: true }),
            'Close all',
            'Keep open (disabled)',
        );
        expect(draft.dispose).not.toHaveBeenCalled();
        expect(draft.disable).not.toHaveBeenCalled();
        expect(mocks.latch).not.toHaveBeenCalled();
    });

    it('names a task before asking what to do with tabs', async () => {
        register('collectionView');
        mocks.getConflictingTasks.mockReturnValue([{ taskName: 'Copy orders', taskType: 'copy' }]);
        await expect(confirmTeardown(clusterId, 'userDisconnected')).resolves.toEqual({ outcome: 'blockedByTask' });
        expect(showError).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ modal: true, detail: expect.stringContaining('Copy orders') }),
        );
        expect(showWarning).not.toHaveBeenCalled();
        expect(mocks.latch).not.toHaveBeenCalled();
    });

    it('blocks a lease started during the modal without mutating surfaces, cache or workers', async () => {
        const draft = register('documentView', true);
        showWarning.mockImplementationOnce(async (_title, _options, ...items) => {
            mocks.getConflictingTasks.mockReturnValue([{ taskName: 'Export documents', taskType: 'export' }]);
            return items[1];
        });

        await expect(teardownConnection(clusterId, 'userDisconnected', refreshTree)).rejects.toBeInstanceOf(
            UserCancelledError,
        );
        expect(showError).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ modal: true, detail: expect.stringContaining('Export documents') }),
        );
        expect(mocks.latch).not.toHaveBeenCalled();
        expect(draft.disable).not.toHaveBeenCalled();
        expect(mocks.stopPlaygroundEvaluator).not.toHaveBeenCalled();
        expect(mocks.deleteClient).not.toHaveBeenCalled();
        expect(refreshTree).not.toHaveBeenCalled();
        expect(mocks.event).toHaveBeenCalledExactlyOnceWith(
            'connection.disconnect',
            expect.objectContaining({ properties: expect.objectContaining({ blockedByTask: 'true' }) }),
        );
    });

    it('fences once, disables all matching surfaces, stops only matching workers, and keeps credentials and pin', async () => {
        const surfaces = [register('documentView', true), register('collectionView'), register('clusterDashboard')];
        const unrelated = register('documentView', true, otherId);
        const disconnect = vi.fn();
        const otherShell = vi.fn();
        mocks.getRegisteredShellTerminals.mockReturnValue([
            { info: { clusterId }, disconnect },
            { info: { clusterId: otherId }, disconnect: otherShell },
        ]);
        mocks.getPlaygroundEvaluators.mockReturnValue(new Map([[clusterId, {}]]));
        mocks.getSetting.mockReturnValue('keepOpenDisabled');

        await teardownConnection(clusterId, 'userDisconnected', refreshTree);

        expect(showWarning).not.toHaveBeenCalled();
        expect(mocks.latch).toHaveBeenCalledExactlyOnceWith(clusterId, 'userDisconnected');
        for (const surface of surfaces) {
            expect(mocks.latch).toHaveBeenCalledBefore(vi.mocked(surface.disable));
            expect(surface.disable).toHaveBeenCalledExactlyOnceWith('userDisconnected');
            expect(surface.dispose).not.toHaveBeenCalled();
        }
        expect(unrelated.disable).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledOnce();
        expect(otherShell).not.toHaveBeenCalled();
        expect(mocks.stopPlaygroundEvaluator).toHaveBeenCalledExactlyOnceWith(clusterId);
        expect(mocks.deleteClient).toHaveBeenCalledExactlyOnceWith(clusterId, { alreadyInvalidated: true });
        expect(mocks.deleteCredentials).not.toHaveBeenCalled();
        expect(mocks.clearLastVerifiedIdentity).not.toHaveBeenCalled();
        expect(mocks.clearEntraTokenFailure).toHaveBeenCalledExactlyOnceWith(clusterId);
        expect(refreshTree).toHaveBeenCalledOnce();
        expect(mocks.event).toHaveBeenCalledExactlyOnceWith('connection.disconnect', {
            properties: { source: 'command', surfacesChoice: 'keepOpenDisabled', blockedByTask: 'false' },
            measurements: { surfaceCount: 3, shellCount: 1, playgroundCount: 1 },
            maskEntireErrorMessage: true,
        });
    });

    it('closes surfaces and drops credentials only when requested, without latching a fenced target again', async () => {
        const draft = register('documentView', true);
        mocks.getLatchReason.mockReturnValue('connectionRemoved');
        await expect(
            commitTeardown(clusterId, {
                reason: 'connectionRemoved',
                choice: 'close',
                alreadyLatched: true,
                dropCredentials: true,
                refreshTree,
            }),
        ).resolves.toBe('committed');
        expect(showWarning).not.toHaveBeenCalled();
        expect(draft.dispose).toHaveBeenCalledOnce();
        expect(mocks.latch).not.toHaveBeenCalled();
        expect(mocks.deleteCredentials).toHaveBeenCalledExactlyOnceWith(clusterId);
        expect(mocks.clearLastVerifiedIdentity).toHaveBeenCalledExactlyOnceWith(clusterId);
    });

    it('does not partially latch a batch when a descendant is blocked', () => {
        mocks.getConflictingTasks.mockImplementation(({ clusterId: id }: { clusterId: string }) =>
            id === otherId ? [{ taskName: 'Import', taskType: 'import' }] : [],
        );
        expect(latchForTeardown([clusterId, otherId], 'connectionRemoved')).toBe(false);
        expect(mocks.latch).not.toHaveBeenCalled();
    });
});
