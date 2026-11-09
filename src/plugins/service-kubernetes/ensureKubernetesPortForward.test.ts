/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSource = vi.fn();
const mockLoadConfiguredKubeConfig = vi.fn();
const mockCreateCoreApi = vi.fn();
const mockStartTunnel = vi.fn();
const mockReadNamespacedEndpoints = vi.fn();

vi.mock('vscode', () => ({
    l10n: {
        t: vi.fn((message: string, ...values: string[]) =>
            values.reduce<string>((acc, v, i) => acc.replace(`{${String(i)}}`, v), message),
        ),
    },
}));

vi.mock('./sources/sourceStore', () => ({
    getSource: (...args: unknown[]) => mockGetSource(...(args as [string])),
}));

vi.mock('./kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
}));

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { appendLine: vi.fn() } },
}));

vi.mock('./portForwardTunnel', async (importOriginal) => {
    const original = await importOriginal<typeof import('./portForwardTunnel')>();
    return {
        ...original,
        PortForwardTunnelManager: {
            getInstance: () => ({
                startTunnel: mockStartTunnel,
            }),
        },
    };
});

import { LocalPortInUseError } from '../../services/connectionReachabilityService';
import { ensureKubernetesPortForward } from './ensureKubernetesPortForward';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';
import { KubernetesNoReadyBackendError } from './portForwardTunnel';

function makeMetadata(overrides: Partial<KubernetesPortForwardMetadata> = {}): KubernetesPortForwardMetadata {
    return {
        kind: 'kubernetesClusterIpPortForward',
        sourceId: 'src-uuid-1',
        sourceLabel: 'team.yaml',
        contextName: 'my-ctx',
        namespace: 'app',
        serviceName: 'svc-1',
        servicePort: 27017,
        servicePortName: undefined,
        localPort: 27017,
        ...overrides,
    };
}

beforeEach(() => {
    mockGetSource.mockReset();
    mockLoadConfiguredKubeConfig.mockReset();
    mockCreateCoreApi.mockReset();
    mockStartTunnel.mockReset();
    mockReadNamespacedEndpoints.mockReset();
});

describe('ensureKubernetesPortForward', () => {
    it('throws a friendly error using the saved source label when the source has been removed', async () => {
        mockGetSource.mockResolvedValue(undefined);

        await expect(ensureKubernetesPortForward(makeMetadata())).rejects.toThrow(/team\.yaml/);
        expect(mockLoadConfiguredKubeConfig).not.toHaveBeenCalled();
        expect(mockStartTunnel).not.toHaveBeenCalled();
    });

    it('falls back to the sourceId in the error when no label was saved (legacy connections)', async () => {
        mockGetSource.mockResolvedValue(undefined);

        await expect(
            ensureKubernetesPortForward(makeMetadata({ sourceLabel: undefined, sourceId: 'legacy-uuid' })),
        ).rejects.toThrow(/legacy-uuid/);
    });

    it('proceeds with the tunnel when the source still exists', async () => {
        mockGetSource.mockResolvedValue({ id: 'src-uuid-1', label: 'team.yaml', kind: 'file' });
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockCreateCoreApi.mockResolvedValue({});
        mockStartTunnel.mockResolvedValue({ outcome: 'started' });

        const result = await ensureKubernetesPortForward(makeMetadata());

        expect(result.outcome).toBe('started');
        expect(mockStartTunnel).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceId: 'src-uuid-1',
                contextName: 'my-ctx',
                namespace: 'app',
                serviceName: 'svc-1',
                servicePort: 27017,
                localPort: 27017,
            }),
            { interactive: true },
        );
        expect(mockReadNamespacedEndpoints).not.toHaveBeenCalled();
    });

    it('passes the diagnostics intent to the tunnel manager as non-interactive', async () => {
        mockGetSource.mockResolvedValue({ id: 'src-uuid-1', label: 'team.yaml', kind: 'file' });
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockCreateCoreApi.mockResolvedValue({ readNamespacedEndpoints: mockReadNamespacedEndpoints });
        mockReadNamespacedEndpoints.mockResolvedValue({
            subsets: [
                {
                    addresses: [{ targetRef: { kind: 'Pod', name: 'ready-pod' } }],
                    ports: [{ port: 27017 }],
                },
            ],
        });
        mockStartTunnel.mockResolvedValue({ outcome: 'reused' });

        await ensureKubernetesPortForward(makeMetadata(), {
            interactive: false,
            verifyEndpoint: true,
            signal: new AbortController().signal,
        });

        expect(mockStartTunnel).toHaveBeenCalledWith(expect.anything(), { interactive: false });
    });

    it('starts no tunnel when the caller gave up while the kubeconfig loaded', async () => {
        const controller = new AbortController();
        mockGetSource.mockResolvedValue({ id: 'src-uuid-1', label: 'team.yaml', kind: 'file' });
        mockLoadConfiguredKubeConfig.mockImplementation(async () => {
            controller.abort();
            return {};
        });
        mockCreateCoreApi.mockResolvedValue({});

        await expect(
            ensureKubernetesPortForward(makeMetadata(), { interactive: false, signal: controller.signal }),
        ).rejects.toThrow();
        expect(mockStartTunnel).not.toHaveBeenCalled();
    });

    describe('diagnostic backend verification', () => {
        beforeEach(() => {
            mockGetSource.mockResolvedValue({ id: 'src-uuid-1', label: 'team.yaml', kind: 'file' });
            mockLoadConfiguredKubeConfig.mockResolvedValue({});
            mockCreateCoreApi.mockResolvedValue({ readNamespacedEndpoints: mockReadNamespacedEndpoints });
            mockReadNamespacedEndpoints.mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'private-pod' } }],
                        ports: [
                            { name: 'metrics', port: 9090 },
                            { name: 'documentdb', port: 10260 },
                        ],
                    },
                ],
            });
        });

        it.each(['started', 'reused'] as const)(
            'verifies the same named service port before a tunnel is %s',
            async (outcome): Promise<void> => {
                mockStartTunnel.mockResolvedValue({ outcome });
                await expect(
                    ensureKubernetesPortForward(makeMetadata({ servicePortName: 'documentdb' }), {
                        interactive: false,
                        verifyEndpoint: true,
                    }),
                ).resolves.toEqual({ outcome });

                expect(mockReadNamespacedEndpoints).toHaveBeenCalledExactlyOnceWith({
                    name: 'svc-1',
                    namespace: 'app',
                });
                expect(mockReadNamespacedEndpoints.mock.invocationCallOrder[0]).toBeLessThan(
                    mockStartTunnel.mock.invocationCallOrder[0],
                );
                expect(mockStartTunnel).toHaveBeenCalledExactlyOnceWith(
                    expect.objectContaining({
                        coreApi: { readNamespacedEndpoints: mockReadNamespacedEndpoints },
                        servicePort: 27017,
                        servicePortName: 'documentdb',
                    }),
                    { interactive: false },
                );
            },
        );

        it.each([
            [401, 'accessDenied'],
            [403, 'accessDenied'],
            [404, 'targetNotFound'],
            [500, 'other'],
        ] as const)('classifies Kubernetes ApiException code %s as %s', async (code, reason): Promise<void> => {
            const sourceError = Object.assign(new Error('private-service on private-api'), {
                code,
                body: { message: 'private-namespace' },
                headers: {},
            });
            mockReadNamespacedEndpoints.mockRejectedValue(sourceError);
            await expect(
                ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
            ).rejects.toMatchObject({
                name: 'ConnectionPreparationError',
                message: 'Connection preparation failed',
                reason,
                statusCode: code,
                sourceError,
            });
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it.each(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'])(
            'classifies node-fetch network code %s without using its message',
            async (code): Promise<void> => {
                const sourceError = Object.assign(new Error('private-api'), { name: 'FetchError', code, errno: code });
                mockReadNamespacedEndpoints.mockRejectedValue(sourceError);
                await expect(
                    ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
                ).rejects.toMatchObject({ reason: 'sourceUnreachable', sourceError, statusCode: undefined });
                expect(mockStartTunnel).not.toHaveBeenCalled();
            },
        );

        it('classifies a typed no-ready backend failure before starting a tunnel', async (): Promise<void> => {
            mockReadNamespacedEndpoints.mockResolvedValue({ subsets: [] });
            await expect(
                ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
            ).rejects.toMatchObject({
                reason: 'noReadyBackend',
                sourceError: expect.any(KubernetesNoReadyBackendError),
            });
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it('classifies a removed source without exposing its label in the diagnostic message', async (): Promise<void> => {
            mockGetSource.mockResolvedValue(undefined);
            await expect(
                ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
            ).rejects.toMatchObject({
                reason: 'sourceMissing',
                message: 'Connection preparation failed',
                sourceError: expect.any(Error),
            });
            expect(mockLoadConfiguredKubeConfig).not.toHaveBeenCalled();
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it.each(['FileNotFound', 'ENOENT'])('classifies missing-source code %s', async (code): Promise<void> => {
            const sourceError = Object.assign(new Error('private-file'), { code });
            mockLoadConfiguredKubeConfig.mockRejectedValue(sourceError);
            await expect(
                ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
            ).rejects.toMatchObject({ reason: 'sourceMissing', sourceError });
            expect(mockReadNamespacedEndpoints).not.toHaveBeenCalled();
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it('keeps unrecognized failures bounded as other', async (): Promise<void> => {
            const sourceError = new Error('403 ECONNREFUSED private-service');
            mockReadNamespacedEndpoints.mockRejectedValue(sourceError);
            await expect(
                ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
            ).rejects.toMatchObject({ reason: 'other', sourceError, statusCode: undefined });
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it('does not verify an endpoint solely because preparation is non-interactive', async (): Promise<void> => {
            mockStartTunnel.mockResolvedValue({ outcome: 'started' });
            await ensureKubernetesPortForward(makeMetadata(), { interactive: false });
            expect(mockReadNamespacedEndpoints).not.toHaveBeenCalled();
            expect(mockStartTunnel).toHaveBeenCalledOnce();
        });

        it('does not wrap an ordinary connect failure', async (): Promise<void> => {
            const error = new Error('ordinary failure');
            mockStartTunnel.mockRejectedValue(error);
            await expect(ensureKubernetesPortForward(makeMetadata())).rejects.toBe(error);
            expect(mockReadNamespacedEndpoints).not.toHaveBeenCalled();
        });

        it.each([
            new LocalPortInUseError(27017, 'otherProgram', 'port in use'),
            new DOMException('cancelled', 'AbortError'),
        ])('does not wrap %s during diagnostic preparation', async (error): Promise<void> => {
            mockReadNamespacedEndpoints.mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'private-pod' } }],
                        ports: [{ port: 27017 }],
                    },
                ],
            });
            mockStartTunnel.mockRejectedValue(error);
            await expect(
                ensureKubernetesPortForward(makeMetadata(), { interactive: false, verifyEndpoint: true }),
            ).rejects.toBe(error);
        });

        it('does nothing when aborted before verification', async (): Promise<void> => {
            const controller = new AbortController();
            controller.abort();
            await expect(
                ensureKubernetesPortForward(makeMetadata(), {
                    interactive: false,
                    verifyEndpoint: true,
                    signal: controller.signal,
                }),
            ).rejects.toBe(controller.signal.reason);
            expect(mockGetSource).not.toHaveBeenCalled();
            expect(mockReadNamespacedEndpoints).not.toHaveBeenCalled();
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it.each([
            ['cancel', 'success'],
            ['cancel', 'failure'],
            ['timeout', 'success'],
            ['timeout', 'failure'],
        ] as const)(
            'never starts a tunnel after %s followed by a late backend %s',
            async (abort, outcome): Promise<void> => {
                const controller = new AbortController();
                let complete!: () => void;
                let entered!: () => void;
                const pending = new Promise<void>((resolve): void => {
                    entered = resolve;
                });
                mockReadNamespacedEndpoints.mockImplementation(
                    () =>
                        new Promise<unknown>((resolve, reject): void => {
                            complete = (): void => {
                                if (outcome === 'failure') {
                                    reject(Object.assign(new Error('private-api'), { code: 'ECONNREFUSED' }));
                                } else {
                                    resolve({
                                        subsets: [
                                            {
                                                addresses: [{ targetRef: { kind: 'Pod', name: 'ready-pod' } }],
                                                ports: [{ port: 27017 }],
                                            },
                                        ],
                                    });
                                }
                            };
                            entered();
                        }),
                );
                const result = ensureKubernetesPortForward(makeMetadata(), {
                    interactive: false,
                    verifyEndpoint: true,
                    signal: controller.signal,
                });
                await pending;
                controller.abort(abort === 'timeout' ? new DOMException('timed out', 'TimeoutError') : undefined);
                const assertion = expect(result).rejects.toBe(controller.signal.reason);
                complete();
                await assertion;
                expect(mockStartTunnel).not.toHaveBeenCalled();
            },
        );
    });
});
