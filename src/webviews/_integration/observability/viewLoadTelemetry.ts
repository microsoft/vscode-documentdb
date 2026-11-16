/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { WEBVIEW_CONFIG } from '../configuration';

/** The webviews whose load time is measured. Low-volume views are deliberately left out. */
export type ViewLoadKind = 'collectionView' | 'documentView' | 'clusterDashboard';

/** How a view's first load ended, as reported by the webview. */
export type ViewFirstDataOutcome = 'dataShown' | 'empty' | 'failed';

/** Every outcome the load event can carry: the webview's three plus the two the host decides on its own. */
export type ViewLoadOutcome = ViewFirstDataOutcome | 'closedBeforeData' | 'timeout';

/** A panel that has not shown its first data after this long is reported as `timeout`. */
export const VIEW_LOAD_TIMEOUT_MS = 120_000;

export interface ViewLoadReport {
    readonly viewKind: ViewLoadKind;
    readonly loadOutcome: ViewLoadOutcome;
    /** Whether the webview reported it had mounted before the outcome was known. */
    readonly webviewReady: boolean;
    /** Panel creation to the webview's mount, when it mounted. */
    readonly timeToWebviewReadyMs?: number;
    /** Panel creation to the first load settling (`dataShown`, `empty`, `failed`). */
    readonly timeToFirstDataMs?: number;
    /** Panel creation to whichever outcome was reported, for every outcome. */
    readonly timeToOutcomeMs: number;
    /** The webview's own timing of the request(s) that produced its first data. */
    readonly firstDataRpcMs?: number;
}

export interface ViewLoadTrackerOptions {
    readonly timeoutMs?: number;
    readonly now?: () => number;
}

/**
 * Measures how long one webview panel takes to show its first data, and reports it once.
 *
 * Per-RPC events and the RPC concurrency gauge time single requests, but not what a user waits
 * for: bundle load, React mount, and the chain of requests before anything is on screen. One
 * tracker belongs to one panel instance, so the report is exactly one event per panel,
 * whichever comes first of the webview's first-data signal, the panel closing, or the timeout.
 * Later signals (a remount, a refresh, a poll) are ignored, and settling always clears the timer.
 *
 * Timing starts when the tracker is created, which `openAppWebview` does immediately
 * before it creates the panel in the extension host. Every milestone is timed with the host
 * clock when its message arrives, so the measurements include bundle load and message transit.
 */
export class ViewLoadTracker {
    private readonly startedAt: number;
    private readonly now: () => number;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private readyAt: number | undefined;
    private settled = false;

    constructor(
        private readonly viewKind: ViewLoadKind,
        private readonly report: (report: ViewLoadReport) => void,
        options: ViewLoadTrackerOptions = {},
    ) {
        this.now = options.now ?? Date.now;
        this.startedAt = this.now();
        this.timer = setTimeout(() => this.settle('timeout'), options.timeoutMs ?? VIEW_LOAD_TIMEOUT_MS);
    }

    get isSettled(): boolean {
        return this.settled;
    }

    /** The webview's React tree has mounted and can issue requests. Only the first call counts. */
    markWebviewReady(): void {
        if (this.settled || this.readyAt !== undefined) {
            return;
        }
        this.readyAt = this.now();
    }

    /** The webview's first load settled; `firstDataRpcMs` is the webview's timing of its request(s). */
    markFirstData(outcome: ViewFirstDataOutcome, firstDataRpcMs?: number): void {
        this.settle(outcome, firstDataRpcMs);
    }

    /** The panel closed. Reports `closedBeforeData` unless an outcome was already reported. */
    markDisposed(): void {
        this.settle('closedBeforeData');
    }

    /** Stops tracking without reporting, for a panel that failed to open. */
    discard(): void {
        this.settled = true;
        this.clearTimer();
    }

    private clearTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private settle(outcome: ViewLoadOutcome, firstDataRpcMs?: number): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        this.clearTimer();

        const elapsed = this.now() - this.startedAt;
        const showedFirstData = outcome === 'dataShown' || outcome === 'empty' || outcome === 'failed';
        this.report({
            viewKind: this.viewKind,
            loadOutcome: outcome,
            webviewReady: this.readyAt !== undefined,
            timeToWebviewReadyMs: this.readyAt === undefined ? undefined : this.readyAt - this.startedAt,
            timeToFirstDataMs: showedFirstData ? elapsed : undefined,
            timeToOutcomeMs: elapsed,
            firstDataRpcMs: showedFirstData && firstDataRpcMs !== undefined ? Math.round(firstDataRpcMs) : undefined,
        });
    }
}

/**
 * Sends a {@link ViewLoadReport} as `documentDB.webview.viewLoaded`.
 *
 * `correlation` carries the view's existing correlation IDs and bounded context (for example
 * `dashboardSessionId`, `journeyCorrelationId`, `collectionSessionId`, `viewId`). Never pass
 * database, collection or document names, or query text.
 */
export function reportViewLoaded(report: ViewLoadReport, correlation: Readonly<Record<string, string>> = {}): void {
    void callWithTelemetryAndErrorHandling(WEBVIEW_CONFIG.telemetry.viewLoadEvent, (context) => {
        context.errorHandling.suppressDisplay = true;
        Object.assign(context.telemetry.properties, correlation);
        context.telemetry.properties.viewKind = report.viewKind;
        context.telemetry.properties.loadOutcome = report.loadOutcome;
        context.telemetry.properties.timingStart = 'panelCreated';
        context.telemetry.properties.webviewReady = report.webviewReady ? 'true' : 'false';
        context.telemetry.measurements.timeToOutcomeMs = report.timeToOutcomeMs;
        if (report.timeToWebviewReadyMs !== undefined) {
            context.telemetry.measurements.timeToWebviewReadyMs = report.timeToWebviewReadyMs;
        }
        if (report.timeToFirstDataMs !== undefined) {
            context.telemetry.measurements.timeToFirstDataMs = report.timeToFirstDataMs;
        }
        if (report.firstDataRpcMs !== undefined) {
            context.telemetry.measurements.firstDataRpcMs = report.firstDataRpcMs;
        }
    });
}
