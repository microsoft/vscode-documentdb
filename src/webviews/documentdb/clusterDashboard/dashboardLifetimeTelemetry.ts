/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';

/** The parts of a dashboard panel the lifetime measurement reads. */
export interface DashboardLifetimeSource {
    readonly panel: Pick<vscode.WebviewPanel, 'visible' | 'onDidChangeViewState'>;
    readonly onDisposed: vscode.Event<void>;
}

export interface DashboardLifetime {
    /** From opening to closing. */
    openMs: number;
    /** How much of that the panel was on screen. */
    visibleMs: number;
    /** How often the panel came back on screen after being hidden behind another editor. */
    shownAgainCount: number;
}

/**
 * Measures how long a dashboard stayed open and on screen, and reports it when the panel closes.
 *
 * The dashboard opens itself after every connection, so its events alone cannot tell a page
 * someone kept beside their work from one closed at once or left behind another tab. That is
 * the question behind keeping automatic opening on by default. The report is best effort: a
 * window closing with the panel open may not deliver it.
 */
export function trackDashboardLifetime(
    source: DashboardLifetimeSource,
    report: (lifetime: DashboardLifetime) => void,
    now: () => number = Date.now,
): void {
    const openedAt = now();
    let visibleSince: number | undefined = source.panel.visible ? openedAt : undefined;
    let visibleMs = 0;
    let shownAgainCount = 0;

    const viewStateSubscription = source.panel.onDidChangeViewState((event) => {
        const visible = event.webviewPanel.visible;
        if (visible && visibleSince === undefined) {
            visibleSince = now();
            shownAgainCount++;
        } else if (!visible && visibleSince !== undefined) {
            visibleMs += now() - visibleSince;
            visibleSince = undefined;
        }
    });

    source.onDisposed(() => {
        viewStateSubscription.dispose();
        const closedAt = now();
        if (visibleSince !== undefined) {
            visibleMs += closedAt - visibleSince;
        }
        report({ openMs: closedAt - openedAt, visibleMs, shownAgainCount });
    });
}

/** Reports a dashboard's lifetime as `clusterDashboard.closed`, joined to the open by `dashboardSessionId`. */
export function reportDashboardClosed(
    lifetime: DashboardLifetime,
    session: { viewId: string; dashboardSessionId?: string; journeyCorrelationId?: string },
): void {
    void callWithTelemetryAndErrorHandling('clusterDashboard.closed', (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.viewId = session.viewId;
        if (session.dashboardSessionId) {
            context.telemetry.properties.dashboardSessionId = session.dashboardSessionId;
        }
        if (session.journeyCorrelationId) {
            context.telemetry.properties.journeyCorrelationId = session.journeyCorrelationId;
        }
        context.telemetry.measurements.openMs = lifetime.openMs;
        context.telemetry.measurements.visibleMs = lifetime.visibleMs;
        context.telemetry.measurements.shownAgainCount = lifetime.shownAgainCount;
    });
}
