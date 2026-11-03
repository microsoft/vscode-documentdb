/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type TroubleshootTarget } from '../../../troubleshooter/types';
import { isFeedbackPermitted } from '../../../utils/feedbackPermission';
import {
    type AppWebviewController,
    type OpenAppWebviewOptions,
    openAppWebview,
} from '../../_integration/openAppWebview';
import { openConnectivityTroubleshooter } from './connectivityTroubleshooterController';
import { type RouterContext } from './connectivityTroubleshooterRouter';
import { type ConnectivityTroubleshooterConfiguration } from './connectivityTroubleshooterTypes';

vi.mock('../../_integration/openAppWebview', () => ({ openAppWebview: vi.fn() }));
vi.mock('../../../utils/feedbackPermission', () => ({ isFeedbackPermitted: vi.fn(() => true) }));
vi.mock('../../../extensionVariables', async () => {
    const vscodeMock = await import('vscode');
    return { ext: { context: { extensionUri: vscodeMock.Uri.file('/fixture/extension') } } };
});

interface OpenedPanel {
    readonly context: RouterContext;
    readonly config: ConnectivityTroubleshooterConfiguration;
    readonly reveal: ReturnType<typeof vi.fn>;
    dispose(): void;
}

const opened: OpenedPanel[] = [];

function target(clusterId: string, treeId = clusterId): TroubleshootTarget & { readonly treeId: string } {
    return {
        clusterId,
        treeId,
        displayName: `Connection ${clusterId}`,
        sourceView: 'connections',
        getCredentials: vi.fn(),
    };
}

function open(clusterId: string, treeId?: string): ReturnType<typeof openConnectivityTroubleshooter> {
    return openConnectivityTroubleshooter({ target: target(clusterId, treeId), entryPoint: 'contextMenu' });
}

describe('openConnectivityTroubleshooter', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
        opened.length = 0;
        vi.mocked(openAppWebview).mockImplementation(
            <T>(options: OpenAppWebviewOptions<T>): AppWebviewController<T> => {
                const listeners = new Set<() => void>();
                const reveal = vi.fn();
                let disposed = false;
                const panel: OpenedPanel = {
                    context: options.context as RouterContext,
                    config: options.config as ConnectivityTroubleshooterConfiguration,
                    reveal,
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
                    panel: { reveal },
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
        expect(second).toEqual({ panelAction: 'focused', troubleshooterSessionId: first.troubleshooterSessionId });
        expect(first.panelAction).toBe('created');
        expect(opened[0].reveal).toHaveBeenCalledOnce();
        expect((await offer).value).toEqual({ type: 'offerRerun' });
        const third = open('second');
        expect(third.panelAction).toBe('created');
        expect(third.troubleshooterSessionId).not.toBe(first.troubleshooterSessionId);
        expect(openAppWebview).toHaveBeenCalledTimes(2);
        subscription.abort();
        expect((await events.next()).done).toBe(true);
    });

    it('wires a safe configuration, host-only context and DocumentDB panel metadata', (): void => {
        const result = open('fixture');
        expect(opened[0].config).toEqual({
            connectionName: 'Connection fixture',
            troubleshooterSessionId: result.troubleshooterSessionId,
            feedbackPermitted: true,
        });
        expect(opened[0].context).toMatchObject({
            target: { clusterId: 'fixture' },
            entryPoint: 'contextMenu',
            webviewName: 'connectivityTroubleshooter',
        });
        expect(openAppWebview).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Diagnose: Connection fixture',
                panelViewType: 'vscode-documentdb-connectivity-troubleshooter',
                webviewName: 'connectivityTroubleshooter',
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
        const second = open('fixture');
        expect(second.panelAction).toBe('created');
        expect(second.troubleshooterSessionId).not.toBe(first.troubleshooterSessionId);
        expect(openAppWebview).toHaveBeenCalledTimes(2);
    });

    it('keys panels by stable clusterId when treeId changes or is shared by different clusters', (): void => {
        const first = open('stable-cluster', 'folder-a/cluster');
        expect(open('stable-cluster', 'folder-b/cluster')).toEqual({
            panelAction: 'focused',
            troubleshooterSessionId: first.troubleshooterSessionId,
        });
        expect(open('other-stable-cluster', 'folder-a/cluster').panelAction).toBe('created');
        expect(openAppWebview).toHaveBeenCalledTimes(2);
        expect(opened[0].reveal).toHaveBeenCalledOnce();
    });
});
