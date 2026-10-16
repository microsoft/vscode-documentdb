/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FALLBACK_MAX_DEADLINE_MS, isSrvConnectionString, resolveSrvForDriver } from '@documentdb-js/srv-resolver';
import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { getConnectionTimeoutMs } from '../../utils/workspacUtils';
import { createSrvResolutionSummary } from './srvResolutionSummary';
import { applySrvResolutionReport } from './srvResolutionTelemetry';

import { type SrvFallbackMode, type SrvResolutionPath, type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type MongoClientOptions } from 'mongodb';
import { type SrvResolutionSummary } from './srvResolutionSummary';
import { type SrvResolutionTelemetry } from './srvResolutionTelemetry';

export type SrvResolutionSurface = 'extension' | 'shell' | 'playground';

export interface PrepareDriverConnectionStringInput {
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly surface: SrvResolutionSurface;
    readonly correlation: Readonly<Record<string, string | undefined>>;
    readonly abortSignal?: AbortSignal;
    readonly startupTelemetry?: SrvResolutionTelemetry;
}

export interface PreparedDriverConnectionString {
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly srvResolution: 'notSrv' | SrvResolutionPath;
    readonly summary?: SrvResolutionSummary;
}

function fallbackMode(): SrvFallbackMode {
    if (process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK === '1') {
        return 'off';
    }
    return process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK === '1' ? 'force' : 'auto';
}

async function sendSrvResolutionEvent(
    report: SrvResolutionReport,
    input: PrepareDriverConnectionStringInput,
): Promise<void> {
    await callWithTelemetryAndErrorHandling('connect.srvResolution', async (context): Promise<void> => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.maskEntireErrorMessage = true;
        applySrvResolutionReport(context.telemetry, report, input.surface, input.correlation);
        // Throwing sets the event's result; the real error never enters telemetry.
        if (report.outcome === 'cancelled') {
            throw new UserCancelledError('srvResolution');
        }
        if (report.outcome === 'failed') {
            throw new Error('SRV resolution failed');
        }
    });
}

/**
 * Returns the connection string to hand to the driver: the original one, or for a `mongodb+srv://`
 * string whose DNS reply Node.js rejects, a transient `mongodb://` equivalent. Never persist it.
 */
export async function prepareDriverConnectionString(
    input: PrepareDriverConnectionStringInput,
): Promise<PreparedDriverConnectionString> {
    if (input.abortSignal?.aborted) {
        throw new UserCancelledError('srvResolution');
    }
    if (!isSrvConnectionString(input.connectionString)) {
        if (input.startupTelemetry) {
            input.startupTelemetry.properties.srvResolution = 'notSrv';
        }
        return { connectionString: input.connectionString, options: input.options, srvResolution: 'notSrv' };
    }
    const correlationId = input.correlation.startupCorrelationId ?? 'unknown';
    const startedAt = Date.now();
    // Widened so control flow does not narrow it to undefined; onReport assigns it.
    let report = undefined as SrvResolutionReport | undefined;
    try {
        const result = await resolveSrvForDriver({
            connectionString: input.connectionString,
            options: input.options,
            fallback: fallbackMode(),
            deadlineMs: Math.min(FALLBACK_MAX_DEADLINE_MS, getConnectionTimeoutMs()),
            signal: input.abortSignal,
            logger: { trace: (message: string): void => ext.outputChannel?.trace(message) },
            logPrefix: `[SrvResolution] startup=${correlationId}`,
            logContext: `surface=${input.surface}`,
            onReport: (resolved): void => {
                report = resolved;
            },
        });
        if (input.abortSignal?.aborted) {
            throw new UserCancelledError('srvResolution');
        }
        return {
            connectionString: result.connectionString,
            options: result.options,
            srvResolution: result.path,
            summary: result.report ? createSrvResolutionSummary(result.report) : undefined,
        };
    } catch (error) {
        if (input.abortSignal?.aborted) {
            throw new UserCancelledError('srvResolution');
        }
        throw error;
    } finally {
        if (input.startupTelemetry) {
            input.startupTelemetry.measurements.srvResolutionDurationMs = Date.now() - startedAt;
            if (report) {
                input.startupTelemetry.properties.srvResolution = report.path;
            }
        }
        if (report) {
            await sendSrvResolutionEvent(report, input);
        }
    }
}
