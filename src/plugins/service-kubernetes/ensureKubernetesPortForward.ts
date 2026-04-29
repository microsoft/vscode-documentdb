/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createCoreApi, loadConfiguredKubeConfig } from './kubernetesClient';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';
import { PortForwardTunnelManager, type TunnelStartResult } from './portForwardTunnel';
import { getSource } from './sources/sourceStore';

export async function ensureKubernetesPortForward(metadata: KubernetesPortForwardMetadata): Promise<TunnelStartResult> {
    // Surface a friendlier message before falling through to loadConfiguredKubeConfig,
    // which would otherwise show the raw sourceId (UUID for file/inline sources).
    // We use the sourceLabel saved with the connection when available.
    const sourceRecord = await getSource(metadata.sourceId);
    if (!sourceRecord) {
        const friendly = metadata.sourceLabel ?? metadata.sourceId;
        throw new Error(
            vscode.l10n.t(
                'Kubeconfig source "{0}" was not found. It may have been removed; reconfigure or re-add the source and try again.',
                friendly,
            ),
        );
    }

    const kubeConfig = await loadConfiguredKubeConfig(metadata.sourceId);
    const coreApi = await createCoreApi(kubeConfig, metadata.contextName);

    return await PortForwardTunnelManager.getInstance().startTunnel({
        sourceId: metadata.sourceId,
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
