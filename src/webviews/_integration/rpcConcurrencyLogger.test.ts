/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ProcedureLogEntry } from '@microsoft/vscode-ext-webview/host';
import { callWithAccumulatingTelemetry } from '../../utils/callWithAccumulatingTelemetry';
import { WEBVIEW_CONFIG } from './configuration';
import { rpcConcurrencyLogger } from './rpcConcurrencyLogger';

// Mock the two runtime dependencies so the logger can be exercised without
// pulling in the real package (which imports `vscode`) or the telemetry pipeline.
const consoleLog = jest.fn();
jest.mock('@microsoft/vscode-ext-webview/host', () => ({
    consoleProcedureLogger: { log: (entry: unknown) => consoleLog(entry) },
}));
jest.mock('../../utils/callWithAccumulatingTelemetry', () => ({
    callWithAccumulatingTelemetry: jest.fn(),
}));

describe('rpcConcurrencyLogger (R766-S04)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

        // Run the callback against a telemetry stub to assert what it writes.
        const callback = (callWithAccumulatingTelemetry as jest.Mock).mock.calls[0][1] as (ctx: unknown) => void;
        const telemetry = { properties: {}, measurements: {} as Record<string, number>, distributions: {} as Record<string, number> };
        callback({ telemetry });

        expect(telemetry.distributions).toEqual({ concurrentRpcOps: 3 });
        expect(telemetry.measurements).toEqual({ dispatch: 1 });
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
});
