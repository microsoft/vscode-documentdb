/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DiagnosticsReport } from '@documentdb-js/connection-diagnostics';
import { type Uri } from 'vscode';
import { type RunConnectionDiagnosticsOptions } from '../../../connectionDiagnostics/runConnectionDiagnostics';
import {
    type DiagnosticsEntryPoint,
    type DiagnosticsTarget,
    type FindingCode,
} from '../../../connectionDiagnostics/types';
import { type PanelEvent } from './connectionDiagnosticsTypes';

export type CancelReason = ReturnType<NonNullable<RunConnectionDiagnosticsOptions['cancelReason']>>;

/** Bounds the Cancel requests remembered for runs whose subscription has not started yet. */
const MAX_EARLY_CANCELS = 32;

export interface DiagnosticsSubject {
    readonly target: DiagnosticsTarget;
    readonly entryPoint: DiagnosticsEntryPoint;
}

export class DiagnosticsPanelRun {
    public readonly abortController = new AbortController();
    public cancelReason: CancelReason = 'subscriptionClosed';

    public constructor(
        public readonly runId: string,
        public readonly runIndex: number,
        /** The view's identity for the subscription that started this run; Cancel must name it. */
        public readonly requestId: string,
        public readonly subject: DiagnosticsSubject,
    ) {}

    public abort(reason: CancelReason): void {
        if (!this.abortController.signal.aborted) {
            this.cancelReason = reason;
            this.abortController.abort();
        }
    }
}

interface ReportPreview {
    readonly opening: Promise<Uri>;
    uri?: Uri;
    report: DiagnosticsReport<FindingCode>;
    hideIdentifiers: boolean;
}

let reportSequence = 0;

export class DiagnosticsPanelSession {
    /** Neutral, unique labels also let the provider distinguish preview-tab lifetimes. */
    public readonly reportNumber = ++reportSequence;
    public reportPreview: ReportPreview | undefined;
    public currentRun: DiagnosticsPanelRun | undefined;
    public runId: string | undefined;
    public runIndex = 0;
    public completedRun: { readonly runId: string; readonly report: DiagnosticsReport<FindingCode> } | undefined;
    private panelEvent: PanelEvent | undefined;
    private readonly listeners = new Set<() => void>();
    private readonly earlyCancels = new Set<string>();
    private currentSubject: DiagnosticsSubject;
    private disposed = false;

    public constructor(
        public readonly diagnosticsSessionId: string,
        initialSubject: DiagnosticsSubject,
    ) {
        this.currentSubject = initialSubject;
    }

    public get subject(): DiagnosticsSubject {
        return this.currentSubject;
    }

    public retarget(nextSubject: DiagnosticsSubject): void {
        if (!this.disposed) {
            this.currentSubject = nextSubject;
        }
    }

    public startRun(runId: string, requestId: string): DiagnosticsPanelRun {
        this.currentRun?.abort('rerun');
        this.completedRun = undefined;
        this.runId = runId;
        const run = new DiagnosticsPanelRun(runId, ++this.runIndex, requestId, this.subject);
        this.currentRun = run;
        if (this.disposed) {
            run.abort('panelClosed');
        } else if (this.earlyCancels.delete(requestId)) {
            run.abort('cancelButton');
        }
        return run;
    }

    /**
     * Cancels only the run the view's request started. A Cancel for any other request never selects
     * the current run: it is either stale (its run was already replaced) or arrived before its
     * subscription started, and is then applied when that run starts.
     */
    public cancel(requestId: string): DiagnosticsPanelRun | undefined {
        if (this.currentRun?.requestId === requestId) {
            this.currentRun.abort('cancelButton');
            return this.currentRun;
        }
        this.earlyCancels.add(requestId);
        if (this.earlyCancels.size > MAX_EARLY_CANCELS) {
            const [oldest] = this.earlyCancels;
            this.earlyCancels.delete(oldest);
        }
        return undefined;
    }

    public offerRerun(): void {
        if (!this.disposed) {
            this.panelEvent = { type: 'offerRerun', connectionName: this.subject.target.displayName };
            this.wake();
        }
    }

    public async *events(signal?: AbortSignal): AsyncGenerator<PanelEvent, void, void> {
        // Replay the latest name after a reload; older offers must not restore a stale header.
        let lastEvent: PanelEvent | undefined;
        let wake: (() => void) | undefined;
        const onWake = (): void => wake?.();
        this.listeners.add(onWake);
        signal?.addEventListener('abort', onWake);
        try {
            while (!this.disposed && !signal?.aborted) {
                const event = this.panelEvent;
                if (event && event !== lastEvent) {
                    lastEvent = event;
                    yield event;
                } else {
                    await new Promise<void>((resolve): void => {
                        wake = resolve;
                    });
                    wake = undefined;
                }
            }
        } finally {
            signal?.removeEventListener('abort', onWake);
            this.listeners.delete(onWake);
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.currentRun?.abort('panelClosed');
        this.completedRun = undefined;
        this.reportPreview = undefined;
        this.panelEvent = undefined;
        this.earlyCancels.clear();
        this.wake();
    }

    private wake(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}
