/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSource = vi.fn();
const mockLoadConfiguredKubeConfig = vi.fn();
const mockCreateCoreApi = vi.fn();
const mockStartTunnel = vi.fn();

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

vi.mock('./portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: () => ({
            startTunnel: mockStartTunnel,
        }),
    },
}));

import { ensureKubernetesPortForward } from './ensureKubernetesPortForward';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';

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
        );
    });
});
