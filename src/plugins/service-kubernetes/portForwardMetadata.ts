/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const KUBERNETES_PORT_FORWARD_METADATA_PROPERTY = 'kubernetesPortForward';

export interface KubernetesPortForwardMetadata {
    readonly kind: 'kubernetesClusterIpPortForward';
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
    contextName: string,
    service: KubernetesPortForwardMetadataSource,
    localPort: number,
): KubernetesPortForwardMetadata {
    return {
        kind: 'kubernetesClusterIpPortForward',
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
        contextName,
        namespace,
        serviceName,
        servicePort,
        servicePortName,
        localPort,
    };
}

export function getKubernetesPortForwardIdentity(metadata: KubernetesPortForwardMetadata): string {
    return `${metadata.contextName}/${metadata.namespace}/${metadata.serviceName}:${String(metadata.servicePort)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
