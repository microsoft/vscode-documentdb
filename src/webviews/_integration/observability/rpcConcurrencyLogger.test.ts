/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ProcedureLogEntry } from '@microsoft/vscode-ext-webview/host';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { callWithAccumulatingTelemetry } from '../../../utils/callWithAccumulatingTelemetry';
import { WEBVIEW_CONFIG } from '../configuration';
import { rpcConcurrencyLogger } from './rpcConcurrencyLogger';

// Mock the two runtime dependencies so the logger can be exercised without
// pulling in the real package (which imports `vscode`) or the telemetry pipeline.
const consoleLog = jest.fn();
jest.mock('@microsoft/vscode-ext-webview/host', () => ({
    consoleProcedureLogger: { log: (entry: unknown) => consoleLog(entry) },
}));
jest.mock('../../../utils/callWithAccumulatingTelemetry', () => ({
    callWithAccumulatingTelemetry: jest.fn(),
}));

/**
 * Point `ext.context.extensionMode` at the given mode for a test. The logger
 * reads it per call (R766-P05) to decide whether to emit the console line.
 */
function setExtensionMode(mode: vscode.ExtensionMode): void {
    // `ext.context` is a partial stub in tests; only `extensionMode` is read here.
    (ext as { context: { extensionMode: vscode.ExtensionMode } }).context = { extensionMode: mode };
}

describe('rpcConcurrencyLogger (R766-S04)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default to a non-production mode so the console line is exercised.
        setExtensionMode(vscode.ExtensionMode.Development);
    });

    it('delegates to the console logger and records the concurrency gauge + dispatch counter', () => {
        const entry: ProcedureLogEntry = {
            type: 'query',
            path: 'greet',
            durationMs: 5,
            ok: true,
            aborted: false,
            concurrent: 3,
        };

        rpcConcurrencyLogger.log(entry);

        expect(consoleLog).toHaveBeenCalledWith(entry);
        expect(callWithAccumulatingTelemetry).toHaveBeenCalledWith(
            WEBVIEW_CONFIG.telemetry.rpcConcurrencyEvent,
            expect.any(Function),
        );

        // Run the callback against a sample-bag stub to assert what it writes.
        const callback = (callWithAccumulatingTelemetry as jest.Mock).mock.calls[0][1] as (sample: unknown) => void;
        const sample = {
            properties: {},
            measurements: {} as Record<string, number>,
            distributions: {} as Record<string, number>,
        };
        callback(sample);

        expect(sample.distributions).toEqual({ concurrentRpcOps: 3 });
        expect(sample.measurements).toEqual({ dispatch: 1 });
    });

    it('records no telemetry when the entry carries no concurrent count', () => {
        const entry: ProcedureLogEntry = {
            type: 'mutation',
            path: 'save',
            durationMs: 2,
            ok: true,
            aborted: false,
        };

        rpcConcurrencyLogger.log(entry);

        expect(consoleLog).toHaveBeenCalledWith(entry);
        expect(callWithAccumulatingTelemetry).not.toHaveBeenCalled();
    });

    it('logs the console line in the Test mode too (any non-production mode)', () => {
        setExtensionMode(vscode.ExtensionMode.Test);

        rpcConcurrencyLogger.log({ type: 'query', path: 'greet', durationMs: 1, ok: true, aborted: false });

        expect(consoleLog).toHaveBeenCalledTimes(1);
    });

    it('does NOT emit the console line in Production, but still records the concurrency gauge (R766-P05)', () => {
        setExtensionMode(vscode.ExtensionMode.Production);

        const entry: ProcedureLogEntry = {
            type: 'query',
            path: 'greet',
            durationMs: 5,
            ok: true,
            aborted: false,
            concurrent: 7,
        };

        rpcConcurrencyLogger.log(entry);

        // Console line is gated out on a shipped build ...
        expect(consoleLog).not.toHaveBeenCalled();

        // ... but the telemetry gauge is unconditional, so production still samples.
        expect(callWithAccumulatingTelemetry).toHaveBeenCalledWith(
            WEBVIEW_CONFIG.telemetry.rpcConcurrencyEvent,
            expect.any(Function),
        );
        const callback = (callWithAccumulatingTelemetry as jest.Mock).mock.calls[0][1] as (sample: unknown) => void;
        const sample = {
            properties: {},
            measurements: {} as Record<string, number>,
            distributions: {} as Record<string, number>,
        };
        callback(sample);
        expect(sample.distributions).toEqual({ concurrentRpcOps: 7 });
        expect(sample.measurements).toEqual({ dispatch: 1 });
    });
});
