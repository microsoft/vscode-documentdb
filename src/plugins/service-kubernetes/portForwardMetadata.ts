/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_SOURCE_ID } from './config';

export const KUBERNETES_PORT_FORWARD_METADATA_PROPERTY = 'kubernetesPortForward';

export interface KubernetesPortForwardMetadata {
    readonly kind: 'kubernetesClusterIpPortForward';
    /**
     * Id of the {@link KubeconfigSourceRecord} this tunnel was opened against.
     * Older saved connections (pre-v2) lack this field; readers fall back to
     * {@link DEFAULT_SOURCE_ID} when absent.
     */
    readonly sourceId: string;
    /**
     * Display label of the source at the time this connection was saved. Used
     * only to produce friendlier error messages when the source has since been
     * removed (e.g. "Kubeconfig source 'team.yaml' was not found..."). The
     * authoritative identifier is still {@link sourceId}; the label may be
     * stale or absent (legacy connections).
     */
    readonly sourceLabel?: string;
    readonly contextName: string;
    readonly namespace: string;
    readonly serviceName: string;
    readonly servicePort: number;
    readonly servicePortName?: string;
    readonly localPort: number;
}

interface KubernetesPortForwardMetadataSource {
    readonly namespace: string;
    readonly serviceName: string;
    readonly port: number;
    readonly portName?: string;
}

export function createKubernetesPortForwardMetadata(
    sourceId: string,
    contextName: string,
    service: KubernetesPortForwardMetadataSource,
    localPort: number,
    sourceLabel?: string,
): KubernetesPortForwardMetadata {
    return {
        kind: 'kubernetesClusterIpPortForward',
        sourceId,
        sourceLabel,
        contextName,
        namespace: service.namespace,
        serviceName: service.serviceName,
        servicePort: service.port,
        servicePortName: service.portName,
        localPort,
    };
}

export function getKubernetesPortForwardMetadata(
    properties: Record<string, unknown> | undefined,
): KubernetesPortForwardMetadata | undefined {
    const value = properties?.[KUBERNETES_PORT_FORWARD_METADATA_PROPERTY];
    if (!isRecord(value)) {
        return undefined;
    }

    if (value.kind !== 'kubernetesClusterIpPortForward') {
        return undefined;
    }

    const contextName = value.contextName;
    const namespace = value.namespace;
    const serviceName = value.serviceName;
    const servicePort = value.servicePort;
    const servicePortName = value.servicePortName;
    const localPort = value.localPort;
    // sourceId was added in v2; legacy entries use the default source.
    const sourceIdRaw = value.sourceId;
    const sourceId = typeof sourceIdRaw === 'string' && sourceIdRaw.length > 0 ? sourceIdRaw : DEFAULT_SOURCE_ID;
    // sourceLabel is an optional display hint; reject anything that is not a non-empty string.
    const sourceLabelRaw = value.sourceLabel;
    const sourceLabel = typeof sourceLabelRaw === 'string' && sourceLabelRaw.length > 0 ? sourceLabelRaw : undefined;

    if (
        typeof contextName !== 'string' ||
        typeof namespace !== 'string' ||
        typeof serviceName !== 'string' ||
        typeof servicePort !== 'number' ||
        typeof localPort !== 'number'
    ) {
        return undefined;
    }

    if (!contextName || !namespace || !serviceName || !Number.isInteger(servicePort) || !Number.isInteger(localPort)) {
        return undefined;
    }
    if (servicePortName !== undefined && typeof servicePortName !== 'string') {
        return undefined;
    }

    return {
        kind: 'kubernetesClusterIpPortForward',
        sourceId,
        sourceLabel,
        contextName,
        namespace,
        serviceName,
        servicePort,
        servicePortName,
        localPort,
    };
}

export function getKubernetesPortForwardIdentity(metadata: KubernetesPortForwardMetadata): string {
    return `${metadata.sourceId}/${metadata.contextName}/${metadata.namespace}/${metadata.serviceName}:${String(metadata.servicePort)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
