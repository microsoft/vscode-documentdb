/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as SrvResolver from '@documentdb-js/srv-resolver';
import { resolveSrvForDriver } from '@documentdb-js/srv-resolver';
import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { getConnectionTimeoutMs } from '../../utils/workspacUtils';
import { prepareDriverConnectionString } from './prepareDriverConnectionString';
import { resetSrvFallbackPreviewNoticeForTests } from './srvFallbackPreviewNotice';

import {
    type ResolveSrvForDriverInput,
    type ResolveSrvForDriverResult,
    type SrvResolutionReport,
} from '@documentdb-js/srv-resolver';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type PrepareDriverConnectionStringInput } from './prepareDriverConnectionString';
import { type SrvResolutionTelemetry } from './srvResolutionTelemetry';

interface RecordedEvent {
    readonly eventName: string;
    readonly context: IActionContext;
    error?: unknown;
}

const mockEvents: RecordedEvent[] = [];
let mockReplaceError = false;

jest.mock('@microsoft/vscode-azext-utils', () => {
    const actual = jest.requireActual<{ UserCancelledError: typeof UserCancelledError }>(
        '@microsoft/vscode-azext-utils',
    );
    return {
        ...actual,
        callWithTelemetryAndErrorHandling: jest.fn(
            async (eventName: string, callback: (context: IActionContext) => Promise<void>): Promise<void> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: {},
                    valuesToMask: [],
                } as unknown as IActionContext;
                const event: RecordedEvent = { eventName, context };
                try {
                    await callback(context);
                    context.telemetry.properties.result = 'Succeeded';
                } catch (error) {
                    event.error = error;
                    if (error instanceof actual.UserCancelledError) {
                        context.telemetry.properties.result = 'Canceled';
                        return;
                    }
                    context.telemetry.properties.result = 'Failed';
                    if (context.errorHandling.rethrow) {
                        throw mockReplaceError ? new Error('framework replacement') : error;
                    }
                } finally {
                    mockEvents.push(event);
                }
            },
        ),
    };
});

jest.mock('@documentdb-js/srv-resolver', () => ({
    ...jest.requireActual<typeof SrvResolver>('@documentdb-js/srv-resolver'),
    resolveSrvForDriver: jest.fn(),
}));
jest.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { trace: jest.fn(), error: jest.fn(), debug: jest.fn() } },
}));
jest.mock('../../utils/workspacUtils', () => ({ getConnectionTimeoutMs: jest.fn().mockReturnValue(30000) }));

const host = 'x.global.mongocluster.cosmos.azure.com';
const uri = `mongodb+srv://user:S3cr3t%40pw@${host}/?appName=@x@`;
const baseReport: SrvResolutionReport = {
    srvHost: host,
    srvServiceName: 'mongodb',
    path: 'fallback',
    outcome: 'succeeded',
    nodeErrorCode: 'EBADRESP',
    fallbackOutcome: 'succeeded',
    fallbackTransport: 'tcp',
    targetCompressed: true,
    txtSource: 'fallback',
    txtOptionsApplied: ['replicaSet', 'authSource'],
    tlsAdded: true,
    dnsServers: ['192.168.1.1:53'],
    fallbackServersTried: 1,
    srvTargetCount: 2,
    nodeProbeDurationMs: 4,
    fallbackDurationMs: 10,
    forcedFallback: false,
    aresVersion: '1.34.8',
    nodeRuntimeVersion: '22.0.0',
};

function input(overrides: Partial<PrepareDriverConnectionStringInput> = {}): PrepareDriverConnectionStringInput {
    return {
        connectionString: uri,
        options: {},
        surface: 'extension',
        correlation: {
            connectionCorrelationId: 'connect-id',
            startupCorrelationId: 'startup-id',
            shellSessionId: 'shell-id',
        },
        ...overrides,
    };
}

function startup(): SrvResolutionTelemetry {
    return { properties: {}, measurements: {} };
}

function returnReport(report: SrvResolutionReport): void {
    jest.mocked(resolveSrvForDriver).mockImplementation(async (args): Promise<ResolveSrvForDriverResult> => {
        args.logger?.trace(`${args.logPrefix} start srvHost=${report.srvHost} ${args.logContext}`);
        args.onReport?.(report);
        return { connectionString: 'mongodb://resolved.example.com', options: {}, path: report.path, report };
    });
}

describe('prepareDriverConnectionString', (): void => {
    beforeEach((): void => {
        jest.clearAllMocks();
        resetSrvFallbackPreviewNoticeForTests();
        jest.mocked(vscode.window.showInformationMessage).mockReset().mockResolvedValue(undefined);
        mockEvents.length = 0;
        mockReplaceError = false;
        delete process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
        delete process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK;
        jest.mocked(getConnectionTimeoutMs).mockReturnValue(30000);
        returnReport(baseReport);
    });

    const previousOff = process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
    const previousForce = process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK;
    afterAll((): void => {
        if (previousOff === undefined) {
            delete process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
        } else {
            process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK = previousOff;
        }
        if (previousForce === undefined) {
            delete process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK;
        } else {
            process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK = previousForce;
        }
    });

    it('returns non-SRV unchanged with no event, package call or log', async (): Promise<void> => {
        const telemetry = startup();
        const args = input({ connectionString: 'mongodb://localhost', startupTelemetry: telemetry });
        const result = await prepareDriverConnectionString(args);
        expect(result).toEqual({
            connectionString: args.connectionString,
            options: args.options,
            srvResolution: 'notSrv',
        });
        expect(result.options).toBe(args.options);
        expect(telemetry.properties.srvResolution).toBe('notSrv');
        expect(mockEvents).toHaveLength(0);
        expect(resolveSrvForDriver).not.toHaveBeenCalled();
        expect(ext.outputChannel?.trace).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it.each(['node', 'fallback', 'nodeErrorPassthrough'] as const)(
        'emits one private event and startup summary for %s',
        async (path): Promise<void> => {
            const report: SrvResolutionReport =
                path === 'fallback'
                    ? baseReport
                    : {
                          ...baseReport,
                          path,
                          nodeErrorCode: path === 'node' ? 'none' : 'ENOTFOUND',
                          fallbackOutcome: 'notAttempted',
                          fallbackTransport: undefined,
                          targetCompressed: undefined,
                          txtSource: undefined,
                          txtOptionsApplied: [],
                          tlsAdded: undefined,
                          fallbackDurationMs: undefined,
                          fallbackServersTried: undefined,
                      };
            returnReport(report);
            const telemetry = startup();
            const result = await prepareDriverConnectionString(input({ startupTelemetry: telemetry }));
            expect(result.srvResolution).toBe(path);
            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(path === 'fallback' ? 1 : 0);
            expect(result.summary).toMatchObject({ path, srvTargetCount: 2, resolvedAt: expect.any(Number) });
            expect(result.summary).not.toHaveProperty('srvHost');
            expect(result.summary).not.toHaveProperty('connectionString');
            expect(mockEvents).toHaveLength(1);
            const event = mockEvents[0];
            expect(event.eventName).toBe('connect.srvResolution');
            expect(event.context.errorHandling).toMatchObject({ suppressDisplay: true, rethrow: true });
            expect(event.context.telemetry.maskEntireErrorMessage).toBe(true);
            expect(event.context.telemetry.properties).toMatchObject({
                result: 'Succeeded',
                surface: 'extension',
                path,
                nodeErrorCode: report.nodeErrorCode,
                fallbackOutcome: report.fallbackOutcome,
                targetCompressed: path === 'fallback' ? 'true' : 'unknown',
                txtOptionsApplied: path === 'fallback' ? 'authSource,replicaSet' : 'none',
                dnsServerClass: 'private',
                dnsServerIpFamily: 'ipv4',
                isAzureEndpoint: 'true',
                isGlobalEndpoint: 'true',
                forcedFallback: 'false',
                connectionCorrelationId: 'connect-id',
                startupCorrelationId: 'startup-id',
                shellSessionId: 'shell-id',
                aresVersion: '1.34.8',
                nodeRuntimeVersion: '22.0.0',
            });
            expect(event.context.telemetry.measurements).toMatchObject({
                nodeProbeDurationMs: 4,
                dnsServerCount: 1,
                srvTargetCount: 2,
                fallbackDurationMs: report.fallbackDurationMs,
                fallbackServersTried: report.fallbackServersTried,
            });
            const data = JSON.stringify(event.context.telemetry);
            for (const secret of [host, '192.168.1.1', 'S3cr3t', 'user:', uri]) {
                expect(data).not.toContain(secret);
            }
            expect(telemetry.properties.srvResolution).toBe(path);
            expect(telemetry.measurements.srvResolutionDurationMs).toEqual(expect.any(Number));
        },
    );

    it.each([
        [undefined, undefined, 'auto'],
        ['1', undefined, 'off'],
        [undefined, '1', 'force'],
        ['1', '1', 'off'],
        ['true', 'true', 'auto'],
        ['0', '1', 'force'],
        ['1', '0', 'off'],
    ])('maps switches off=%s force=%s to %s', async (off, force, expected): Promise<void> => {
        if (off !== undefined) {
            process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK = off;
        }
        if (force !== undefined) {
            process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK = force;
        }
        await prepareDriverConnectionString(input());
        expect(jest.mocked(resolveSrvForDriver).mock.calls[0][0].fallback).toBe(expected);
    });

    it.each([5000, 30000])('bounds the fallback by connection timeout %s', async (timeout): Promise<void> => {
        jest.mocked(getConnectionTimeoutMs).mockReturnValue(timeout);
        await prepareDriverConnectionString(input());
        expect(jest.mocked(resolveSrvForDriver).mock.calls[0][0].deadlineMs).toBe(Math.min(20000, timeout));
    });

    it.each([
        [
            { connectionCorrelationId: 'connection', startupCorrelationId: 'startup', shellSessionId: 'shell' },
            'connection',
        ],
        [{ startupCorrelationId: 'startup', shellSessionId: 'shell' }, 'startup'],
        [{ shellSessionId: 'shell' }, 'shell'],
        [{}, 'unknown'],
    ])('uses correlation %j for trace prefix %s', async (correlation, expected): Promise<void> => {
        await prepareDriverConnectionString(input({ correlation, surface: 'playground' }));
        const args = jest.mocked(resolveSrvForDriver).mock.calls[0][0];
        expect(args.logPrefix).toBe(`[SrvResolution] ${expected}`);
        expect(args.logContext).toBe('surface=playground');
        for (const [line] of jest.mocked(ext.outputChannel.trace).mock.calls) {
            for (const secret of ['S3cr3t', 'user:', 'mongodb+srv://', 'mongodb://']) {
                expect(line).not.toContain(secret);
            }
        }
        expect(ext.outputChannel?.error).not.toHaveBeenCalled();
        expect(ext.outputChannel?.debug).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'preserves original failure identity even if handlers replace it (%s)',
        async (replace): Promise<void> => {
            mockReplaceError = replace;
            const failure = Object.assign(new Error(`querySrv EBADRESP _mongodb._tcp.${host} password=S3cr3t`), {
                code: 'EBADRESP',
            });
            const telemetry = startup();
            jest.mocked(resolveSrvForDriver).mockImplementation(async (args): Promise<never> => {
                args.onReport?.({
                    ...baseReport,
                    outcome: 'failed',
                    fallbackOutcome: 'failed',
                    fallbackErrorCode: 'ETIMEOUT',
                });
                throw failure;
            });
            await expect(prepareDriverConnectionString(input({ startupTelemetry: telemetry }))).rejects.toBe(failure);
            expect(mockEvents).toHaveLength(1);
            const event = mockEvents[0];
            expect(event.error).not.toBe(failure);
            expect(event.error).toBeInstanceOf(Error);
            expect((event.error as Error).message).toBe('SRV resolution failed');
            expect((event.error as Error).stack).toBeUndefined();
            expect(failure.stack).toContain(host);
            expect(event.context.telemetry.properties).toMatchObject({
                result: 'Failed',
                fallbackErrorCode: 'ETIMEOUT',
            });
            expect(telemetry.properties.srvResolution).toBe('fallback');
            expect(telemetry.measurements.srvResolutionDurationMs).toEqual(expect.any(Number));
            expect(JSON.stringify(event.context.telemetry)).not.toContain(host);
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        },
    );

    it('maps input abort to UserCancelledError, preserving Canceled and rethrowing outside the wrapper', async (): Promise<void> => {
        const controller = new AbortController();
        const telemetry = startup();
        let packageSignal: AbortSignal | undefined;
        let started!: () => void;
        const began = new Promise<void>((resolve): void => {
            started = resolve;
        });
        jest.mocked(resolveSrvForDriver).mockImplementation(async (args): Promise<never> => {
            packageSignal = args.signal;
            started();
            return new Promise((_resolve, reject): void => {
                args.signal?.addEventListener(
                    'abort',
                    (): void => {
                        args.onReport?.({ ...baseReport, outcome: 'cancelled' });
                        reject(args.signal?.reason as Error);
                    },
                    { once: true },
                );
            });
        });
        const result = prepareDriverConnectionString(
            input({ abortSignal: controller.signal, startupTelemetry: telemetry }),
        );
        await began;
        controller.abort(new Error('private input abort reason'));
        await expect(result).rejects.toBeInstanceOf(UserCancelledError);
        await expect(result).rejects.toBe(packageSignal?.reason);
        expect(mockEvents[0].error).toBeInstanceOf(UserCancelledError);
        expect(mockEvents[0].error).not.toBe(packageSignal?.reason);
        expect(mockEvents[0].context.telemetry.properties.result).toBe('Canceled');
        expect(telemetry.properties.srvResolution).toBe('fallback');
        expect(telemetry.measurements.srvResolutionDurationMs).toEqual(expect.any(Number));
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('rejects already-aborted input before calling package or telemetry', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort();
        await expect(prepareDriverConnectionString(input({ abortSignal: controller.signal }))).rejects.toBeInstanceOf(
            UserCancelledError,
        );
        expect(resolveSrvForDriver).not.toHaveBeenCalled();
        expect(mockEvents).toHaveLength(0);
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('preserves package UserCancelledError without an input abort', async (): Promise<void> => {
        const cancellation = new UserCancelledError('package');
        jest.mocked(resolveSrvForDriver).mockRejectedValue(cancellation);
        await expect(prepareDriverConnectionString(input())).rejects.toBe(cancellation);
        expect(mockEvents[0].error).toBeInstanceOf(UserCancelledError);
        expect(mockEvents[0].context.telemetry.properties.result).toBe('Canceled');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('checks abort after package completion, even if the package fake ignores cancellation', async (): Promise<void> => {
        const controller = new AbortController();
        jest.mocked(resolveSrvForDriver).mockImplementation(
            async (args: ResolveSrvForDriverInput): Promise<ResolveSrvForDriverResult> => {
                args.onReport?.(baseReport);
                controller.abort();
                return { connectionString: uri, options: {}, path: 'node', report: baseReport };
            },
        );
        await expect(prepareDriverConnectionString(input({ abortSignal: controller.signal }))).rejects.toBeInstanceOf(
            UserCancelledError,
        );
        expect(mockEvents[0].context.telemetry.properties.result).toBe('Canceled');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('returns the prepared connection without waiting for the preview dialog', async (): Promise<void> => {
        jest.mocked(vscode.window.showInformationMessage).mockReturnValue(new Promise((): void => {}));
        await expect(prepareDriverConnectionString(input())).resolves.toMatchObject({
            connectionString: 'mongodb://resolved.example.com',
            srvResolution: 'fallback',
        });
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `Developer Preview: DNS workaround applied for ${host}`,
            expect.objectContaining({ modal: true }),
            'Copy Details',
            'Open Troubleshooting Guide',
        );
        expect(mockEvents[0].context.telemetry.properties.result).toBe('Succeeded');
    });

    it('uses the onReport callback to show the notice only after a fallback result is prepared', async (): Promise<void> => {
        jest.mocked(resolveSrvForDriver).mockImplementation(async (args): Promise<ResolveSrvForDriverResult> => {
            args.onReport?.(baseReport);
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            return { connectionString: 'mongodb://resolved.example.com', options: {}, path: 'fallback' };
        });
        await expect(prepareDriverConnectionString(input())).resolves.toMatchObject({ srvResolution: 'fallback' });
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('returns the prepared connection even if the preview dialog rejects', async (): Promise<void> => {
        jest.mocked(vscode.window.showInformationMessage).mockRejectedValue(new Error('UI rejected'));
        await expect(prepareDriverConnectionString(input())).resolves.toMatchObject({
            connectionString: 'mongodb://resolved.example.com',
            srvResolution: 'fallback',
        });
        expect(mockEvents[0].context.telemetry.properties.result).toBe('Succeeded');
    });

    it('resolves DNS on every connection while deduplicating only the notice', async (): Promise<void> => {
        await prepareDriverConnectionString(input());
        await prepareDriverConnectionString(input({ surface: 'shell' }));
        expect(resolveSrvForDriver).toHaveBeenCalledTimes(2);
        expect(mockEvents).toHaveLength(2);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('removes the linked input abort listener after completion', async (): Promise<void> => {
        const controller = new AbortController();
        await prepareDriverConnectionString(input({ abortSignal: controller.signal }));
        const signal = jest.mocked(resolveSrvForDriver).mock.calls[0][0].signal;
        controller.abort();
        expect(signal?.aborted).toBe(false);
    });
});
