/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

import { trackDashboardLifetime, type DashboardLifetime } from './dashboardLifetimeTelemetry';

function createPanel(visible: boolean): {
    source: Parameters<typeof trackDashboardLifetime>[0];
    setVisible: (next: boolean) => void;
    close: () => void;
} {
    let viewStateListener: ((event: { webviewPanel: { visible: boolean } }) => void) | undefined;
    let disposedListener: (() => void) | undefined;
    const panel = {
        visible,
        onDidChangeViewState: (listener: typeof viewStateListener) => {
            viewStateListener = listener;
            return { dispose: vi.fn() };
        },
    };
    return {
        source: {
            panel: panel as unknown as Parameters<typeof trackDashboardLifetime>[0]['panel'],
            onDisposed: ((listener: () => void) => {
                disposedListener = listener;
                return { dispose: vi.fn() };
            }) as unknown as Parameters<typeof trackDashboardLifetime>[0]['onDisposed'],
        },
        setVisible: (next) => viewStateListener?.({ webviewPanel: { visible: next } }),
        close: () => disposedListener?.(),
    };
}

describe('trackDashboardLifetime', () => {
    it('reports open and visible time when the panel closes', () => {
        let clock = 1_000;
        const report = vi.fn<(lifetime: DashboardLifetime) => void>();
        const panel = createPanel(true);

        trackDashboardLifetime(panel.source, report, () => clock);
        clock += 2_000;
        panel.setVisible(false);
        clock += 10_000;
        panel.setVisible(true);
        clock += 3_000;
        panel.close();

        expect(report).toHaveBeenCalledWith({ openMs: 15_000, visibleMs: 5_000, shownAgainCount: 1 });
    });

    it('reports no visible time for a panel opened and closed behind another editor', () => {
        let clock = 0;
        const report = vi.fn<(lifetime: DashboardLifetime) => void>();
        const panel = createPanel(false);

        trackDashboardLifetime(panel.source, report, () => clock);
        clock += 60_000;
        panel.close();

        expect(report).toHaveBeenCalledWith({ openMs: 60_000, visibleMs: 0, shownAgainCount: 0 });
    });
});
