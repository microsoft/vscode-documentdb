/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockEnsureKubernetesPortForward = jest.fn();

// The provider imports ./ensureKubernetesPortForward lazily; mock it so the test never touches
// the real tunnel machinery (and its @kubernetes/client-node dependency).
jest.mock('./ensureKubernetesPortForward', () => ({
    ensureKubernetesPortForward: (...args: unknown[]) => mockEnsureKubernetesPortForward(...args),
}));

import { KubernetesReachabilityProvider } from './KubernetesReachabilityProvider';
import { KUBERNETES_PORT_FORWARD_METADATA_PROPERTY } from './portForwardMetadata';

const validMetadata = {
    kind: 'kubernetesClusterIpPortForward',
    sourceId: 'default',
    contextName: 'kind-documentdb-dev',
    namespace: 'default',
    serviceName: 'documentdb-service',
    servicePort: 10260,
    localPort: 10260,
};

describe('KubernetesReachabilityProvider', () => {
    beforeEach(() => {
        mockEnsureKubernetesPortForward.mockReset();
        mockEnsureKubernetesPortForward.mockResolvedValue({ outcome: 'started' });
    });

    const provider = new KubernetesReachabilityProvider();

    it('has a stable id', () => {
        expect(provider.id).toBe('kubernetes-port-forward');
    });

    it('appliesTo is true only when port-forward metadata is present', () => {
        expect(provider.appliesTo({ [KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]: validMetadata })).toBe(true);
        expect(provider.appliesTo({ somethingElse: true })).toBe(false);
        expect(provider.appliesTo(undefined)).toBe(false);
    });

    it('ensureReachable forwards the metadata to ensureKubernetesPortForward', async () => {
        await provider.ensureReachable({ [KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]: validMetadata });

        expect(mockEnsureKubernetesPortForward).toHaveBeenCalledTimes(1);
        expect(mockEnsureKubernetesPortForward).toHaveBeenCalledWith(expect.objectContaining({ localPort: 10260 }));
    });

    it('ensureReachable is a no-op when no metadata is present', async () => {
        await provider.ensureReachable({ unrelated: 'value' });

        expect(mockEnsureKubernetesPortForward).not.toHaveBeenCalled();
    });
});
