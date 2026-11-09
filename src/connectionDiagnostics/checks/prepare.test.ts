/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RunContext } from '@documentdb-js/connection-diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ConnectionPreparationError,
    ConnectionReachabilityService,
    LocalPortInUseError,
} from '../../services/connectionReachabilityService';
import { type DiagnosticsSetup } from '../input';
import { type DiagnosticsTarget } from '../types';
import { createPrepareCheck } from './prepare';

const properties = { provider: true };
const setup: DiagnosticsSetup = {
    input: { connectionString: 'mongodb://private.example/' },
    chosenAuthMethod: undefined,
    credentialState: 'noMethod',
    connectionProperties: properties,
    transientCredentials: undefined,
};
const target: DiagnosticsTarget = {
    clusterId: 'stable-id',
    displayName: 'Fixture',
    sourceView: 'connections',
    getCredentials: async (): Promise<undefined> => undefined,
};
const context = {} as RunContext;

describe('prepare check', (): void => {
    afterEach((): void => {
        ConnectionReachabilityService.resetForTests();
        vi.restoreAllMocks();
    });

    it('uses an observer, stable clusterId and the preparation timeout', async (): Promise<void> => {
        const ensure = vi.spyOn(ConnectionReachabilityService, 'ensureReachable');
        const check = createPrepareCheck(target, (): DiagnosticsSetup => setup);
        const result = await check.run(context, new AbortController().signal);
        expect(check).toMatchObject({
            id: 'prepare',
            scope: 'run',
            dependsOn: ['connectionString'],
            timeout: 'preparation',
        });
        expect(result).toEqual({
            status: 'skipped',
            skippedBecause: { reason: 'notApplicable' },
            facts: {},
            findings: [],
        });
        expect(ensure).toHaveBeenCalledWith(
            properties,
            'stable-id',
            expect.objectContaining({
                onProviderStarted: expect.any(Function),
                onProviderCompleted: expect.any(Function),
                onProviderFailed: expect.any(Function),
            }),
            { interactive: false, verifyEndpoint: true, signal: expect.any(AbortSignal) },
        );
    });

    it('reports observed provider completion without claiming a newly created tunnel', async (): Promise<void> => {
        const ensure = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable: ensure,
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result).toEqual({
            status: 'pass',
            facts: { providerId: 'tunnel', elapsedMs: expect.any(Number) },
            findings: [],
        });
        expect(ensure).toHaveBeenCalledWith(properties, 'stable-id', {
            interactive: false,
            verifyEndpoint: true,
            signal: expect.any(AbortSignal),
        });
    });

    it.each(['started', 'reused'] as const)(
        'reports a %s shared tunnel as an info finding that outlives the run',
        async (tunnel): Promise<void> => {
            ConnectionReachabilityService.registerProvider({
                id: 'kubernetes-port-forward',
                appliesTo: (): boolean => true,
                ensureReachable: async () => ({ sharedTunnel: tunnel }),
            });
            const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
                context,
                new AbortController().signal,
            );
            expect(result).toEqual({
                status: 'pass',
                facts: { providerId: 'kubernetes-port-forward', elapsedMs: expect.any(Number), tunnel },
                findings: [
                    expect.objectContaining({ code: 'prepare.sharedTunnel', severity: 'info', data: { tunnel } }),
                ],
            });
        },
    );

    it.each(['otherProgram', 'otherTunnel'] as const)(
        'turns a local port held by %s into a finding instead of a dialog',
        async (holder): Promise<void> => {
            ConnectionReachabilityService.registerProvider({
                id: 'kubernetes-port-forward',
                appliesTo: (): boolean => true,
                ensureReachable: async (_properties, _clusterId, intent): Promise<void> => {
                    expect(intent).toEqual({
                        interactive: false,
                        verifyEndpoint: true,
                        signal: expect.any(AbortSignal),
                    });
                    throw new LocalPortInUseError(27017, holder, 'Port 27017 is already in use.');
                },
            });
            const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
                context,
                new AbortController().signal,
            );
            expect(result).toEqual({
                status: 'fail',
                facts: {
                    providerId: 'kubernetes-port-forward',
                    elapsedMs: expect.any(Number),
                    errorName: 'LocalPortInUseError',
                },
                findings: [
                    expect.objectContaining({
                        code: 'prepare.localPortInUse',
                        severity: 'error',
                        data: { localPort: 27017, holder },
                    }),
                ],
            });
        },
    );

    it('starts nothing when the run was cancelled before preparation', async (): Promise<void> => {
        const ensure = vi.fn();
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable: ensure,
        });
        const controller = new AbortController();
        controller.abort();
        await expect(
            createPrepareCheck(target, (): DiagnosticsSetup => setup).run(context, controller.signal),
        ).rejects.toThrow();
        expect(ensure).not.toHaveBeenCalled();
    });

    it('keeps provider failure text and the error object out of the result', async (): Promise<void> => {
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw new TypeError('secret-password on private.example');
            },
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result).toEqual({
            status: 'fail',
            facts: { providerId: 'other', elapsedMs: expect.any(Number), errorName: 'TypeError' },
            findings: [
                expect.objectContaining({
                    code: 'prepare.failed',
                    data: { providerId: 'other', reason: 'other', errorName: 'TypeError' },
                }),
            ],
        });
        expect(JSON.stringify(result)).not.toMatch(/secret-password|private.example/);
    });

    it('does not copy arbitrary error names into results', async (): Promise<void> => {
        const error = new Error('secret');
        error.name = 'secret-user';
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw error;
            },
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result.facts.errorName).toBe('unknown');
    });

    it('never copies host-only preparation evidence into the result', async (): Promise<void> => {
        const sourceError = Object.assign(new Error('secret-password on private-api'), {
            code: 403,
            body: { message: 'private-service in private-namespace' },
        });
        ConnectionReachabilityService.registerProvider({
            id: 'kubernetes-port-forward',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw new ConnectionPreparationError('accessDenied', sourceError, 403);
            },
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result.status).toBe('fail');
        expect(result).toMatchObject({
            facts: { providerId: 'kubernetes-port-forward', errorName: 'ConnectionPreparationError' },
            findings: [
                {
                    code: 'prepare.failed',
                    data: {
                        providerId: 'kubernetes-port-forward',
                        reason: 'accessDenied',
                        errorName: 'Error',
                        statusCode: 403,
                    },
                },
            ],
        });
        expect(JSON.stringify(result)).not.toMatch(/secret-password|private-|sourceError|body/);
    });

    it.each([
        'sourceUnreachable',
        'accessDenied',
        'targetNotFound',
        'noReadyBackend',
        'sourceMissing',
        'other',
    ] as const)('retains the classified %s reason and safe source evidence', async (reason): Promise<void> => {
        const source = Object.assign(new TypeError('private-service private-namespace'), { response: { status: 503 } });
        ConnectionReachabilityService.registerProvider({
            id: 'kubernetes-port-forward',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw new ConnectionPreparationError(reason, source);
            },
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result.findings).toEqual([
            expect.objectContaining({
                code: 'prepare.failed',
                data: { providerId: 'kubernetes-port-forward', reason, errorName: 'TypeError', statusCode: 503 },
            }),
        ]);
        expect(JSON.stringify(result)).not.toMatch(/private-service|private-namespace|sourceError|message|cause/);
    });

    it('bounds unknown provider IDs, unknown source names and HTTP status', async (): Promise<void> => {
        const source = Object.assign(new Error('private-service'), { name: 'private-namespace', statusCode: 700 });
        ConnectionReachabilityService.registerProvider({
            id: 'private-provider',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw new ConnectionPreparationError('sourceMissing', source);
            },
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result).toMatchObject({
            facts: { providerId: 'other', errorName: 'ConnectionPreparationError' },
            findings: [{ data: { providerId: 'other', reason: 'sourceMissing', errorName: 'unknown' } }],
        });
        expect(JSON.stringify(result)).not.toMatch(/private-|700/);
    });

    it('does not classify a generic Kubernetes error by its HTTP status', async (): Promise<void> => {
        ConnectionReachabilityService.registerProvider({
            id: 'kubernetes-port-forward',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw Object.assign(new Error('private-service private-namespace'), { status: 403 });
            },
        });
        const result = await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            context,
            new AbortController().signal,
        );
        expect(result.findings).toEqual([
            expect.objectContaining({
                code: 'prepare.failed',
                data: {
                    providerId: 'kubernetes-port-forward',
                    reason: 'other',
                    errorName: 'Error',
                    statusCode: 403,
                },
            }),
        ]);
        expect(JSON.stringify(result)).not.toMatch(/private-service|private-namespace/);
    });

    it('propagates cancellation instead of mapping a late provider failure', async (): Promise<void> => {
        const controller = new AbortController();
        ConnectionReachabilityService.registerProvider({
            id: 'kubernetes-port-forward',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                controller.abort();
                throw new ConnectionPreparationError('sourceUnreachable', new Error('private-service'));
            },
        });
        await expect(
            createPrepareCheck(target, (): DiagnosticsSetup => setup).run(context, controller.signal),
        ).rejects.toThrow();
    });

    it('does not register cleanup that could close a shared tunnel on cancellation', async (): Promise<void> => {
        const addCleanup = vi.fn();
        const controller = new AbortController();
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                controller.abort();
            },
        });
        await createPrepareCheck(target, (): DiagnosticsSetup => setup).run(
            { addCleanup } as unknown as RunContext,
            controller.signal,
        );
        expect(addCleanup).not.toHaveBeenCalled();
    });
});
