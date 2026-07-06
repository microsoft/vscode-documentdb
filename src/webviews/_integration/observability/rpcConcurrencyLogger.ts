/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * R766-S04: dispatch logger that records webview RPC **concurrency**.
 *
 * The framework stamps every dispatch log entry with `concurrent` (the number of
 * in-flight operations at completion, including the one being logged). This
 * logger keeps the framework's console line for local visibility **in
 * non-production modes only** (R766-P05: the per-op `console.log` is dead weight
 * on a shipped build where no one is watching the host console) and, in
 * addition, feeds `concurrent` into an accumulating-telemetry distribution so we
 * can observe peak / average concurrency across the fleet. The telemetry gauge
 * runs in every mode, production included.
 *
 * Why: the transport registers one `window` `message` listener **per in-flight
 * operation** (O(N) fan-out per message). That is a sound simplicity trade for
 * interactive webviews, but only if `N` stays small. This signal turns the
 * "revisit only on evidence" recommendation into data: if `dist_concurrentRpcOps_max`
 * stays tiny we can retire the concern; if it is routinely large we build a
 * single-listener + `Map<id, observer>` multiplexer. See the R766-S04 discussion
 * in the PR-766 review for the exact thresholds.
 *
 * The event is batched by {@link callWithAccumulatingTelemetry} (default 20 calls
 * / 30 s), so per-RPC volume is negligible. On flush it emits:
 *   - `dist_concurrentRpcOps_min/max/sum/count` — the concurrency gauge (`max` is
 *     the peak; `sum / count` is the average);
 *   - `dispatch` — total operations in the flush window;
 *   - `dist_auto_duration_ms_*` — per-op latency, recorded for free.
 */

import {
    consoleProcedureLogger,
    type ProcedureLogEntry,
    type ProcedureLogger,
} from '@microsoft/vscode-ext-webview/host';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { callWithAccumulatingTelemetry } from '../../../utils/callWithAccumulatingTelemetry';
import { WEBVIEW_CONFIG } from '../configuration';

/**
 * The dispatch logger DocumentDB passes to `openAppWebview`. Delegates to the
 * framework's console logger, then records the concurrency gauge sample.
 */
export const rpcConcurrencyLogger: ProcedureLogger = {
    log(entry: ProcedureLogEntry): void {
        // R766-P05: the framework's console line is a per-op `console.log` on the
        // extension host. It is useful while debugging the extension but is dead
        // weight (string formatting + I/O) on a shipped, installed build where no
        // one is watching that console. Gate it to non-production modes so a
        // packaged extension never pays for it, while F5 / dev builds still get
        // it. Read the mode per-call: `ext.context` is always populated by the
        // time an RPC fires (the webview is open, so the extension has activated),
        // and the comparison is O(1). The telemetry gauge below stays
        // unconditional so production still records concurrency.
        if (ext.context.extensionMode !== vscode.ExtensionMode.Production) {
            consoleProcedureLogger.log(entry);
        }

        // `concurrent` is only present on entries produced by the transport's
        // dispatch pump; guard so a middleware-body entry never mis-samples.
        if (typeof entry.concurrent !== 'number') {
            return;
        }
        const concurrent = entry.concurrent;

        callWithAccumulatingTelemetry(WEBVIEW_CONFIG.telemetry.rpcConcurrencyEvent, (sample) => {
            // Gauge: reduced to min / max / sum / count across the batch.
            sample.distributions.concurrentRpcOps = concurrent;
            // Counter: total operations observed per flush window.
            sample.measurements.dispatch = 1;
        });
    },
};
