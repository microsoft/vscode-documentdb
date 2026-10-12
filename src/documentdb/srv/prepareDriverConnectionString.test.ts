/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as SrvResolver from '@documentdb-js/srv-resolver';
import { resolveSrvForDriver } from '@documentdb-js/srv-resolver';
import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { getConnectionTimeoutMs } from '../../utils/workspacUtils';
import { prepareDriverConnectionString } from './prepareDriverConnectionString';

import { type ResolveSrvForDriverResult, type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type PrepareDriverConnectionStringInput } from './prepareDriverConnectionString';
import { type SrvResolutionTelemetry } from './srvResolutionTelemetry';

interface RecordedEvent {
    readonly eventName: string;
    readonly context: IActionContext;
    error?: unknown;
}

const mockEvents: RecordedEvent[] = [];

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
                    context.telemetry.properties.result =
                        error instanceof actual.UserCancelledError ? 'Canceled' : 'Failed';
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
jest.mock('../../extensionVariables', () => ({ ext: { outputChannel: { trace: jest.fn() } } }));
jest.mock('../../utils/workspacUtils', () => ({ getConnectionTimeoutMs: jest.fn().mockReturnValue(30000) }));

const host = 'x.global.mongocluster.cosmos.azure.com';
const uri = `mongodb+srv://user:S3cr3t%40pw@${host}/`;
const baseReport: SrvResolutionReport = {
    srvHost: host,
    path: 'fallback',
    outcome: 'succeeded',
    nodeErrorCode: 'EBADRESP',
    fallbackOutcome: 'succeeded',
    fallbackTransport: 'tcp',
    txtSource: 'fallback',
    txtOptionsApplied: [],
    dnsServers: ['192.168.1.1:53'],
    srvTargetCount: 2,
    forcedFallback: false,
    aresVersion: '1.34.8',
    nodeRuntimeVersion: '22.0.0',
};

function input(overrides: Partial<PrepareDriverConnectionStringInput> = {}): PrepareDriverConnectionStringInput {
    return {
        connectionString: uri,
        options: {},
        surface: 'extension',
        correlation: { connectionCorrelationId: 'connect-id' },
        ...overrides,
    };
}

function resolveWith(report: SrvResolutionReport, failure?: Error): void {
    jest.mocked(resolveSrvForDriver).mockImplementation(async (args): Promise<ResolveSrvForDriverResult> => {
        args.onReport?.(report);
        if (failure) {
            throw failure;
        }
        return { connectionString: 'mongodb://resolved.example.com', options: {}, path: report.path, report };
    });
}

describe('prepareDriverConnectionString', (): void => {
    beforeEach((): void => {
        jest.clearAllMocks();
        mockEvents.length = 0;
        delete process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
        delete process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK;
        resolveWith(baseReport);
    });

    afterAll((): void => {
        delete process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
        delete process.env.DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK;
    });

    it('returns a non-SRV string unchanged without an event', async (): Promise<void> => {
        const telemetry: SrvResolutionTelemetry = { properties: {}, measurements: {} };
        const result = await prepareDriverConnectionString(
            input({ connectionString: 'mongodb://localhost', startupTelemetry: telemetry }),
        );
        expect(result).toMatchObject({ connectionString: 'mongodb://localhost', srvResolution: 'notSrv' });
        expect(telemetry.properties.srvResolution).toBe('notSrv');
        expect(resolveSrvForDriver).not.toHaveBeenCalled();
        expect(mockEvents).toHaveLength(0);
    });

    it('returns the resolved string, a summary and one host-free event', async (): Promise<void> => {
        const telemetry: SrvResolutionTelemetry = { properties: {}, measurements: {} };
        const result = await prepareDriverConnectionString(input({ startupTelemetry: telemetry }));
        expect(result).toMatchObject({
            connectionString: 'mongodb://resolved.example.com',
            srvResolution: 'fallback',
            summary: { path: 'fallback', nodeErrorCode: 'EBADRESP', srvTargetCount: 2 },
        });
        expect(telemetry.properties.srvResolution).toBe('fallback');
        expect(telemetry.measurements.srvResolutionDurationMs).toEqual(expect.any(Number));
        expect(mockEvents).toHaveLength(1);
        expect(mockEvents[0].eventName).toBe('connect.srvResolution');
        expect(mockEvents[0].context.telemetry.properties).toMatchObject({
            result: 'Succeeded',
            path: 'fallback',
            connectionCorrelationId: 'connect-id',
        });
        const data = JSON.stringify(mockEvents[0].context.telemetry);
        for (const secret of [host, '192.168.1.1', 'S3cr3t']) {
            expect(data).not.toContain(secret);
        }
    });

    it.each([
        [undefined, undefined, 'auto'],
        ['1', undefined, 'off'],
        [undefined, '1', 'force'],
        ['1', '1', 'off'],
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

    it('bounds the fallback by the connection timeout', async (): Promise<void> => {
        jest.mocked(getConnectionTimeoutMs).mockReturnValueOnce(5000);
        await prepareDriverConnectionString(input());
        expect(jest.mocked(resolveSrvForDriver).mock.calls[0][0]).toMatchObject({
            deadlineMs: 5000,
            logPrefix: '[SrvResolution] connect-id',
        });
    });

    it('rethrows the original failure and records a masked failed event', async (): Promise<void> => {
        const failure = new Error(`querySrv EBADRESP ${host}`);
        resolveWith({ ...baseReport, outcome: 'failed', fallbackErrorCode: 'ETIMEOUT' }, failure);
        await expect(prepareDriverConnectionString(input())).rejects.toBe(failure);
        expect(mockEvents[0].context.telemetry.properties).toMatchObject({
            result: 'Failed',
            fallbackErrorCode: 'ETIMEOUT',
        });
        expect((mockEvents[0].error as Error).message).toBe('SRV resolution failed');
    });

    it('maps an abort to UserCancelledError and a canceled event', async (): Promise<void> => {
        const controller = new AbortController();
        jest.mocked(resolveSrvForDriver).mockImplementation(async (args): Promise<never> => {
            controller.abort();
            args.onReport?.({ ...baseReport, outcome: 'cancelled' });
            throw new Error('aborted');
        });
        await expect(
            prepareDriverConnectionString(input({ abortSignal: controller.signal })),
        ).rejects.toBeInstanceOf(UserCancelledError);
        expect(mockEvents[0].context.telemetry.properties.result).toBe('Canceled');
    });

    it('rejects an already-aborted call before resolving', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            prepareDriverConnectionString(input({ abortSignal: controller.signal })),
        ).rejects.toBeInstanceOf(UserCancelledError);
        expect(resolveSrvForDriver).not.toHaveBeenCalled();
    });
});
