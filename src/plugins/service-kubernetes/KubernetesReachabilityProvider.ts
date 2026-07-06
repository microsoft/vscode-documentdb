/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ConnectionReachabilityProvider } from '../../services/connectionReachabilityService';
import { getKubernetesPortForwardMetadata } from './portForwardMetadata';

/**
 * {@link ConnectionReachabilityProvider} for Kubernetes ClusterIP targets reached through a local
 * port-forward tunnel.
 *
 * A saved Kubernetes ClusterIP connection stores its connection string as `127.0.0.1:<localPort>`
 * plus port-forward metadata. That string only works while the tunnel is up, so before connecting
 * we re-establish the tunnel if needed.
 *
 * Only {@link portForwardMetadata} (a dependency-light module) is imported statically so registering
 * this provider at activation stays cheap; the heavy tunnel machinery (which pulls in
 * `@kubernetes/client-node`) is imported lazily inside {@link ensureReachable}.
 */
export class KubernetesReachabilityProvider implements ConnectionReachabilityProvider {
    public readonly id = 'kubernetes-port-forward';

    public appliesTo(connectionProperties: Record<string, unknown> | undefined): boolean {
        return getKubernetesPortForwardMetadata(connectionProperties) !== undefined;
    }

    public async ensureReachable(connectionProperties: Record<string, unknown>): Promise<void> {
        const metadata = getKubernetesPortForwardMetadata(connectionProperties);
        if (!metadata) {
            return;
        }

        const { ensureKubernetesPortForward } = await import('./ensureKubernetesPortForward');
        await ensureKubernetesPortForward(metadata);
    }
}
