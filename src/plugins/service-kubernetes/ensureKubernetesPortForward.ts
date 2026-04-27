/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createCoreApi, loadConfiguredKubeConfig } from './kubernetesClient';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';
import { PortForwardTunnelManager, type TunnelStartResult } from './portForwardTunnel';

export async function ensureKubernetesPortForward(metadata: KubernetesPortForwardMetadata): Promise<TunnelStartResult> {
    const kubeConfig = await loadConfiguredKubeConfig();
    const coreApi = await createCoreApi(kubeConfig, metadata.contextName);

    return await PortForwardTunnelManager.getInstance().startTunnel({
        kubeConfig,
        coreApi,
        contextName: metadata.contextName,
        namespace: metadata.namespace,
        serviceName: metadata.serviceName,
        servicePort: metadata.servicePort,
        servicePortName: metadata.servicePortName,
        localPort: metadata.localPort,
    });
}
