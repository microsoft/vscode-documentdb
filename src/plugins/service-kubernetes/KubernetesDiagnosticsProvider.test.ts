/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    KubernetesDiagnosticsProvider,
    rememberKubernetesCluster,
    resetKubernetesClustersForTests,
} from './KubernetesDiagnosticsProvider';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';

const hasTunnel = vi.fn();

vi.mock('./portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: (): { hasTunnel: Mock } => ({ hasTunnel }),
    },
}));

const metadata: KubernetesPortForwardMetadata = {
    kind: 'kubernetesClusterIpPortForward',
    sourceId: 'source-1',
    contextName: 'my-context',
    namespace: 'databases',
    serviceName: 'documentdb',
    servicePort: 10260,
    localPort: 51234,
};

describe('KubernetesDiagnosticsProvider', () => {
    beforeEach(() => {
        resetKubernetesClustersForTests();
        hasTunnel.mockReset();
    });

    it('stays silent for a cluster that was never prepared by the reachability provider', async () => {
        const result = await new KubernetesDiagnosticsProvider().explain({
            clusterId: 'unknown-cluster',
            error: new Error('connect ECONNREFUSED 127.0.0.1:51234'),
        });

        expect(result).toBeUndefined();
        expect(hasTunnel).not.toHaveBeenCalled();
    });

    it('reports a tunnel that is no longer up', async () => {
        rememberKubernetesCluster('k8s-cluster', metadata);
        hasTunnel.mockReturnValue(false);

        const result = await new KubernetesDiagnosticsProvider().explain({
            clusterId: 'k8s-cluster',
            error: new Error('connect ECONNREFUSED 127.0.0.1:51234'),
        });

        expect(result?.message).toContain('port-forward tunnel');
        expect(result?.message).toContain('documentdb');
        expect(result?.message).toContain('51234');
        // R4: the service and namespace the text names are returned as identifiers to hide.
        expect(result?.identifiers).toEqual([
            { kind: 'service', value: 'documentdb' },
            { kind: 'namespace', value: 'databases' },
        ]);
        expect(hasTunnel).toHaveBeenCalledWith('source-1', 'my-context', 'databases', 'documentdb', 51234);
    });

    it('points past a live tunnel when the service does not answer', async () => {
        rememberKubernetesCluster('k8s-cluster', metadata);
        hasTunnel.mockReturnValue(true);

        const result = await new KubernetesDiagnosticsProvider().explain({
            clusterId: 'k8s-cluster',
            error: new Error('connect ECONNREFUSED 127.0.0.1:51234'),
        });

        expect(result?.message).toContain('looks active');
        expect(result?.identifiers).toEqual([
            { kind: 'service', value: 'documentdb' },
            { kind: 'namespace', value: 'databases' },
        ]);
    });

    it('stays silent for a live tunnel and a non-transport failure', async () => {
        rememberKubernetesCluster('k8s-cluster', metadata);
        hasTunnel.mockReturnValue(true);

        await expect(
            new KubernetesDiagnosticsProvider().explain({
                clusterId: 'k8s-cluster',
                error: new Error('bad auth : Authentication failed.'),
            }),
        ).resolves.toBeUndefined();
    });
});
