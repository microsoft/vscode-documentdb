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

import { type SrvFallbackMode, type SrvResolutionPath } from '@documentdb-js/srv-resolver';
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
    const controller = new AbortController();
    const abort = (): void => controller.abort(new UserCancelledError('srvResolution'));
    input.abortSignal?.addEventListener('abort', abort, { once: true });
    const correlationId =
        input.correlation.connectionCorrelationId ??
        input.correlation.startupCorrelationId ??
        input.correlation.shellSessionId ??
        'unknown';
    let originalFailure: { error: unknown } | undefined;
    let prepared: PreparedDriverConnectionString | undefined;
    try {
        await callWithTelemetryAndErrorHandling('connect.srvResolution', async (context): Promise<void> => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = true;
            context.telemetry.maskEntireErrorMessage = true;
            const startedAt = Date.now();
            try {
                const result = await resolveSrvForDriver({
                    connectionString: input.connectionString,
                    options: input.options,
                    fallback: fallbackMode(),
                    deadlineMs: Math.min(FALLBACK_MAX_DEADLINE_MS, getConnectionTimeoutMs()),
                    signal: controller.signal,
                    logger: { trace: (message: string): void => ext.outputChannel?.trace(message) },
                    logPrefix: `[SrvResolution] ${correlationId}`,
                    logContext: `surface=${input.surface}`,
                    onReport: (report): void => {
                        applySrvResolutionReport(context.telemetry, report, input.surface, input.correlation);
                        if (input.startupTelemetry) {
                            input.startupTelemetry.properties.srvResolution = report.path;
                        }
                    },
                });
                if (controller.signal.aborted) {
                    throw controller.signal.reason;
                }
                prepared = {
                    connectionString: result.connectionString,
                    options: result.options,
                    srvResolution: result.path,
                    summary: result.report ? createSrvResolutionSummary(result.report) : undefined,
                };
            } catch (error) {
                const failure: unknown = controller.signal.aborted ? controller.signal.reason : error;
                originalFailure = { error: failure };
                if (failure instanceof UserCancelledError) {
                    throw new UserCancelledError('srvResolution');
                }
                // Framework handlers may replace errors, and masking does not redact the stack.
                const telemetryError = new Error('SRV resolution failed');
                telemetryError.stack = undefined;
                throw telemetryError;
            } finally {
                if (input.startupTelemetry) {
                    input.startupTelemetry.measurements.srvResolutionDurationMs = Date.now() - startedAt;
                }
            }
        });
    } catch (error) {
        throw originalFailure ? originalFailure.error : error;
    } finally {
        input.abortSignal?.removeEventListener('abort', abort);
    }
    // The telemetry framework swallows UserCancelledError even with rethrow enabled.
    if (originalFailure) {
        throw originalFailure.error;
    }
    if (!prepared) {
        throw new Error('SRV resolution did not return a result');
    }
    return prepared;
}
