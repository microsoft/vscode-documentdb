/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

import { reportViewLoaded, ViewLoadTracker, type ViewLoadReport } from './viewLoadTelemetry';

describe('ViewLoadTracker', () => {
    let clock: number;
    let report: Mock<(report: ViewLoadReport) => void>;

    beforeEach(() => {
        vi.useFakeTimers();
        clock = 1_000;
        report = vi.fn<(report: ViewLoadReport) => void>();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function createTracker(): ViewLoadTracker {
        return new ViewLoadTracker('collectionView', report, { timeoutMs: 60_000, now: () => clock });
    }

    it('reports the first data once, ignoring later milestones, the timeout and the close', () => {
        const tracker = createTracker();
        clock += 400;
        tracker.markWebviewReady();
        clock += 600;
        tracker.markWebviewReady();
        tracker.markFirstData('dataShown', 350.6);
        clock += 5_000;
        tracker.markFirstData('failed', 10);
        tracker.markDisposed();
        vi.advanceTimersByTime(60_000);

        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith({
            viewKind: 'collectionView',
            loadOutcome: 'dataShown',
            webviewReady: true,
            timeToWebviewReadyMs: 400,
            timeToFirstDataMs: 1_000,
            timeToOutcomeMs: 1_000,
            firstDataRpcMs: 351,
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports closedBeforeData without first-data timings when the panel closes first', () => {
        const tracker = createTracker();
        clock += 300;
        tracker.markWebviewReady();
        clock += 2_000;
        tracker.markDisposed();
        tracker.markFirstData('dataShown', 50);

        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith({
            viewKind: 'collectionView',
            loadOutcome: 'closedBeforeData',
            webviewReady: true,
            timeToWebviewReadyMs: 300,
            timeToFirstDataMs: undefined,
            timeToOutcomeMs: 2_300,
            firstDataRpcMs: undefined,
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports timeout once when neither data nor a close arrives, even for a webview that never mounted', () => {
        const tracker = createTracker();
        clock += 60_000;
        vi.advanceTimersByTime(60_000);
        tracker.markDisposed();

        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toMatchObject({
            loadOutcome: 'timeout',
            webviewReady: false,
            timeToWebviewReadyMs: undefined,
            timeToOutcomeMs: 60_000,
        });
        expect(tracker.isSettled).toBe(true);
    });

    it('stops without reporting or leaving a timer when discarded', () => {
        const tracker = createTracker();
        tracker.discard();
        tracker.markDisposed();
        vi.advanceTimersByTime(60_000);

        expect(report).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('reportViewLoaded', () => {
    it('sends the outcome, timings and correlation as one event without error-named properties', async () => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
        } as unknown as IActionContext;
        (callWithTelemetryAndErrorHandling as Mock).mockImplementation(
            (_eventId: string, callback: (ctx: IActionContext) => unknown) => Promise.resolve(callback(context)),
        );

        reportViewLoaded(
            {
                viewKind: 'clusterDashboard',
                loadOutcome: 'empty',
                webviewReady: true,
                timeToWebviewReadyMs: 200,
                timeToFirstDataMs: 900,
                timeToOutcomeMs: 900,
                firstDataRpcMs: 500,
            },
            { dashboardSessionId: 'session-1', viewId: 'connectionsView' },
        );
        await Promise.resolve();

        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledWith(
            'documentDB.webview.viewLoaded',
            expect.any(Function),
        );
        expect(context.telemetry.properties).toEqual({
            dashboardSessionId: 'session-1',
            viewId: 'connectionsView',
            viewKind: 'clusterDashboard',
            loadOutcome: 'empty',
            timingStart: 'panelCreated',
            webviewReady: 'true',
        });
        expect(context.telemetry.measurements).toEqual({
            timeToOutcomeMs: 900,
            timeToWebviewReadyMs: 200,
            timeToFirstDataMs: 900,
            firstDataRpcMs: 500,
        });
        expect(context.errorHandling.suppressDisplay).toBe(true);
    });
});
