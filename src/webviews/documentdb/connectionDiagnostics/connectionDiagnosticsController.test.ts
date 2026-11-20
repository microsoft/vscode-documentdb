/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type DiagnosticsTarget } from '../../../connectionDiagnostics/types';
import { type EphemeralClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { ConnectionSourceUnavailableError } from '../../../tree/documentdb/diagnosticCredentialRead';
import { isFeedbackPermitted } from '../../../utils/feedbackPermission';
import {
    type AppWebviewController,
    type OpenAppWebviewOptions,
    openAppWebview,
} from '../../_integration/openAppWebview';
import { openConnectionDiagnostics } from './connectionDiagnosticsController';
import { type RouterContext } from './connectionDiagnosticsRouter';
import { type ConnectionDiagnosticsConfiguration } from './connectionDiagnosticsTypes';

vi.mock('../../_integration/openAppWebview', () => ({ openAppWebview: vi.fn() }));
vi.mock('../../../utils/feedbackPermission', () => ({ isFeedbackPermitted: vi.fn(() => true) }));
vi.mock('../../../extensionVariables', async () => {
    const vscodeMock = await import('vscode');
    return { ext: { context: { extensionUri: vscodeMock.Uri.file('/fixture/extension') } } };
});

interface OpenedPanel {
    readonly context: RouterContext;
    readonly config: ConnectionDiagnosticsConfiguration;
    readonly reveal: ReturnType<typeof vi.fn>;
    readonly panel: { title: string; reveal: ReturnType<typeof vi.fn> };
    dispose(): void;
}

const opened: OpenedPanel[] = [];

function target(clusterId: string, treeId = clusterId): DiagnosticsTarget & { readonly treeId: string } {
    return {
        clusterId,
        treeId,
        displayName: `Connection ${clusterId}`,
        sourceView: 'connections',
        getCredentials: vi.fn(),
    };
}

function open(clusterId: string, treeId?: string): ReturnType<typeof openConnectionDiagnostics> {
    return openConnectionDiagnostics({ target: target(clusterId, treeId), entryPoint: 'contextMenu' });
}

describe('openConnectionDiagnostics', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
        opened.length = 0;
        vi.mocked(openAppWebview).mockImplementation(
            <T>(options: OpenAppWebviewOptions<T>): AppWebviewController<T> => {
                const listeners = new Set<() => void>();
                const reveal = vi.fn();
                const webviewPanel = { title: options.title, reveal };
                let disposed = false;
                const panel: OpenedPanel = {
                    context: options.context as RouterContext,
                    config: options.config as ConnectionDiagnosticsConfiguration,
                    reveal,
                    panel: webviewPanel,
                    dispose(): void {
                        if (disposed) {
                            return;
                        }
                        disposed = true;
                        for (const listener of listeners) {
                            listener();
                        }
                    },
                };
                opened.push(panel);
                return {
                    panel: webviewPanel,
                    onDisposed: (listener: () => void): vscode.Disposable => {
                        listeners.add(listener);
                        return {
                            dispose: (): void => {
                                listeners.delete(listener);
                            },
                        };
                    },
                } as unknown as AppWebviewController<T>;
            },
        );
    });
    afterEach((): void => {
        for (const panel of opened) {
            panel.dispose();
        }
    });

    it('keeps one panel per clusterId, focuses it and offers a re-run, while another cluster gets another panel', async (): Promise<void> => {
        const first = open('first');
        const subscription = new AbortController();
        const events = opened[0].context.session.events(subscription.signal);
        const offer = events.next();
        const second = open('first');
        expect(second).toEqual({ panelAction: 'focused', diagnosticsSessionId: first.diagnosticsSessionId });
        expect(first.panelAction).toBe('created');
        expect(opened[0].reveal).toHaveBeenCalledOnce();
        expect((await offer).value).toEqual({ type: 'offerRerun', connectionName: 'Connection first' });
        const third = open('second');
        expect(third.panelAction).toBe('created');
        expect(third.diagnosticsSessionId).not.toBe(first.diagnosticsSessionId);
        expect(openAppWebview).toHaveBeenCalledTimes(2);
        subscription.abort();
        expect((await events.next()).done).toBe(true);
    });

    it('wires a safe configuration, host-only context and DocumentDB panel metadata', (): void => {
        const result = open('fixture');
        expect(opened[0].config).toEqual({
            connectionName: 'Connection fixture',
            diagnosticsSessionId: result.diagnosticsSessionId,
            feedbackPermitted: true,
        });
        expect(opened[0].context).toMatchObject({
            session: { subject: { target: { clusterId: 'fixture' }, entryPoint: 'contextMenu' } },
            webviewName: 'connectionDiagnostics',
        });
        expect(opened[0].context).not.toHaveProperty('target');
        expect(opened[0].context).not.toHaveProperty('entryPoint');
        expect(openAppWebview).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Diagnose: Connection fixture',
                panelViewType: 'vscode-documentdb-connection-diagnostics',
                webviewName: 'connectionDiagnostics',
                viewColumn: vscode.ViewColumn.Active,
                icon: {
                    light: vscode.Uri.file(
                        '/fixture/extension/resources/icons/vscode-documentdb-icon-light-themes.svg',
                    ),
                    dark: vscode.Uri.file('/fixture/extension/resources/icons/vscode-documentdb-icon-dark-themes.svg'),
                },
            }),
        );
    });

    it('passes a withdrawn feedback permission to the panel', (): void => {
        vi.mocked(isFeedbackPermitted).mockReturnValueOnce(false);
        open('fixture');
        expect(opened[0].config.feedbackPermitted).toBe(false);
    });

    it.each([false, true])(
        'reuses the panel with replacement credentials when availability was %s',
        async (initiallyAvailable): Promise<void> => {
            const credentials: EphemeralClusterCredentials = {
                connectionString: 'mongodb://replacement.example/',
                availableAuthMethods: [],
            };
            const unavailable = new ConnectionSourceUnavailableError('atlas', undefined, 'notConnectable');
            const availableReader = vi.fn<DiagnosticsTarget['getCredentials']>().mockResolvedValue(credentials);
            const unavailableReader = vi.fn<DiagnosticsTarget['getCredentials']>().mockRejectedValue(unavailable);
            const original = {
                ...target('stable'),
                getCredentials: initiallyAvailable ? availableReader : unavailableReader,
            };
            const replacement = {
                ...target('stable'),
                displayName: 'Renamed connection',
                getCredentials: initiallyAvailable ? unavailableReader : availableReader,
                correlation: {
                    connectionCorrelationId: 'replacement-connection',
                    failedStartupCorrelationId: 'new-failure',
                },
            };
            const first = openConnectionDiagnostics({ target: original, entryPoint: 'contextMenu' });
            const { session } = opened[0].context;
            const initialRun = session.startRun('first-run', 'first-request');
            const read = { signal: initialRun.abortController.signal };
            if (initiallyAvailable) {
                await expect(initialRun.subject.target.getCredentials(read)).resolves.toBe(credentials);
            } else {
                await expect(initialRun.subject.target.getCredentials(read)).rejects.toBe(unavailable);
            }

            const reopened = openConnectionDiagnostics({ target: replacement, entryPoint: 'errorNode' });
            expect(reopened).toEqual({ panelAction: 'focused', diagnosticsSessionId: first.diagnosticsSessionId });
            expect(openAppWebview).toHaveBeenCalledOnce();
            expect(session.currentRun).toBe(initialRun);
            expect(initialRun.abortController.signal.aborted).toBe(false);
            expect(initialRun.subject.target).toBe(original);
            expect(initialRun.subject.entryPoint).toBe('contextMenu');
            expect(session.subject).toEqual({ target: replacement, entryPoint: 'errorNode' });
            expect(opened[0].panel.title).toBe('Diagnose: Renamed connection');
            expect(opened[0].reveal).toHaveBeenCalledOnce();
            expect(original.getCredentials).toHaveBeenCalledOnce();
            expect(replacement.getCredentials).not.toHaveBeenCalled();

            const nextRun = session.startRun('next-run', 'next-request');
            expect(nextRun.subject).toBe(session.subject);
            const nextRead = { signal: nextRun.abortController.signal };
            if (initiallyAvailable) {
                await expect(nextRun.subject.target.getCredentials(nextRead)).rejects.toBe(unavailable);
            } else {
                await expect(nextRun.subject.target.getCredentials(nextRead)).resolves.toBe(credentials);
            }
            expect(original.getCredentials).toHaveBeenCalledOnce();
            expect(replacement.getCredentials).toHaveBeenCalledOnce();
            expect(initialRun.cancelReason).toBe('rerun');
        },
    );

    it('replays only the latest replacement name when panel events subscribe late or reload', async (): Promise<void> => {
        open('stable');
        const { session } = opened[0].context;
        for (const displayName of ['First rename', 'Latest rename']) {
            openConnectionDiagnostics({
                target: { ...target('stable'), displayName },
                entryPoint: 'commandPalette',
            });
        }
        const expected = { type: 'offerRerun', connectionName: 'Latest rename' };
        const events = session.events();
        expect((await events.next()).value).toEqual(expected);
        await events.return();
        const reloaded = session.events();
        expect((await reloaded.next()).value).toEqual(expected);
        await reloaded.return();
        expect(openAppWebview).toHaveBeenCalledOnce();
        expect(session.runIndex).toBe(0);
    });

    it('disposal aborts with panelClosed, ends panel events and removes the map entry', async (): Promise<void> => {
        const first = open('fixture');
        const session = opened[0].context.session;
        const run = session.startRun('active-run', 'active-request');
        const events = session.events();
        const waiting = events.next();
        opened[0].dispose();
        expect(run.abortController.signal.aborted).toBe(true);
        expect(run.cancelReason).toBe('panelClosed');
        expect((await waiting).done).toBe(true);
        expect(session.completedRun).toBeUndefined();
        const subject = session.subject;
        session.retarget({ target: target('replacement'), entryPoint: 'errorNode' });
        session.offerRerun();
        expect(session.subject).toBe(subject);
        expect((await session.events().next()).done).toBe(true);
        const second = open('fixture');
        expect(second.panelAction).toBe('created');
        expect(second.diagnosticsSessionId).not.toBe(first.diagnosticsSessionId);
        expect(openAppWebview).toHaveBeenCalledTimes(2);
    });

    it('keys panels by stable clusterId when treeId changes or is shared by different clusters', (): void => {
        const first = open('stable-cluster', 'folder-a/cluster');
        expect(open('stable-cluster', 'folder-b/cluster')).toEqual({
            panelAction: 'focused',
            diagnosticsSessionId: first.diagnosticsSessionId,
        });
        expect(open('other-stable-cluster', 'folder-a/cluster').panelAction).toBe('created');
        expect(openAppWebview).toHaveBeenCalledTimes(2);
        expect(opened[0].reveal).toHaveBeenCalledOnce();
        expect(opened[0].context.session.subject.target).toMatchObject({
            clusterId: 'stable-cluster',
            treeId: 'folder-b/cluster',
        });
        expect(opened[1].context.session.subject.target).toMatchObject({
            clusterId: 'other-stable-cluster',
            treeId: 'folder-a/cluster',
        });
    });
});
