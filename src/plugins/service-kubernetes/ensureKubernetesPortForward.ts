/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    ConnectionPreparationError,
    LocalPortInUseError,
    type ConnectionPreparationReason,
    type ConnectionReachabilityIntent,
} from '../../services/connectionReachabilityService';
import { httpStatus, networkCode } from '../../utils/connectionErrorClassification';
import { createCoreApi, loadConfiguredKubeConfig } from './kubernetesClient';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';
import {
    KubernetesNoReadyBackendError,
    PortForwardTunnelManager,
    resolveServiceBackend,
    type TunnelStartResult,
} from './portForwardTunnel';
import { getSource } from './sources/sourceStore';

export async function ensureKubernetesPortForward(
    metadata: KubernetesPortForwardMetadata,
    intent?: ConnectionReachabilityIntent,
): Promise<TunnelStartResult> {
    let reason: ConnectionPreparationReason = 'other';
    try {
        intent?.signal?.throwIfAborted();
        // Use the saved source label rather than a raw sourceId (UUID for file/inline sources).
        const sourceRecord = await getSource(metadata.sourceId);
        if (!sourceRecord) {
            reason = 'sourceMissing';
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
        intent?.signal?.throwIfAborted();

        if (intent?.verifyEndpoint) {
            await resolveServiceBackend(
                coreApi,
                metadata.namespace,
                metadata.serviceName,
                metadata.servicePort,
                metadata.servicePortName,
            );
        }
        // A late API result after cancellation or timeout must never start or reuse a tunnel.
        intent?.signal?.throwIfAborted();

        return await PortForwardTunnelManager.getInstance().startTunnel(
            {
                sourceId: metadata.sourceId,
                kubeConfig,
                coreApi,
                contextName: metadata.contextName,
                namespace: metadata.namespace,
                serviceName: metadata.serviceName,
                servicePort: metadata.servicePort,
                servicePortName: metadata.servicePortName,
                localPort: metadata.localPort,
            },
            { interactive: intent?.interactive !== false },
        );
    } catch (error) {
        intent?.signal?.throwIfAborted();
        if (
            intent?.interactive !== false ||
            error instanceof LocalPortInUseError ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            throw error;
        }
        const statusCode = httpStatus(error);
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code === 'FileNotFound' || code === 'ENOENT') {
            reason = 'sourceMissing';
        } else if (statusCode === 401 || statusCode === 403) {
            reason = 'accessDenied';
        } else if (statusCode === 404) {
            reason = 'targetNotFound';
        } else if (networkCode(error)) {
            reason = 'sourceUnreachable';
        } else if (error instanceof KubernetesNoReadyBackendError) {
            reason = 'noReadyBackend';
        }
        throw new ConnectionPreparationError(reason, error, statusCode);
    }
}
