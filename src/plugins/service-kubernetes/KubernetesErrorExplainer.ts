/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Error translation for Kubernetes ClusterIP connections reached through a local port-forward
 * tunnel.
 *
 * TRANSLATION ONLY. This provider must never show UI, restart a tunnel, or retry the failed
 * operation; it returns text so the user can tell a dead tunnel from a database problem.
 * See `src/services/errorExplanationService.ts` and
 * `.github/skills/error-translation/SKILL.md`.
 */

import * as l10n from '@vscode/l10n';
import {
    type ErrorExplanationProvider,
    type ErrorExplanationRequest,
    type ConnectionExplanation,
    type ExplanationIdentifier,
} from '../../services/errorExplanationService';
import { type KubernetesPortForwardMetadata } from './portForwardMetadata';

/**
 * `clusterId` to port-forward metadata, recorded by {@link KubernetesReachabilityProvider} while it
 * prepares a connection.
 *
 * The stored connection properties (where this metadata lives) never travel past the tree item, so
 * a failure raised from a webview, the shell or the playground cannot look them up. Keeping the
 * mapping inside this plugin avoids a central origin registry: the reachability provider already
 * runs at exactly the right moment and already holds both halves.
 */
const knownClusters = new Map<string, KubernetesPortForwardMetadata>();

/** Nothing answered on the socket, as opposed to a failure the server did answer with. */
const NO_ANSWER_SIGNATURES: ReadonlyArray<RegExp> = [
    /econnrefused/i,
    /connection refused/i,
    /econnreset/i,
    /etimedout/i,
    /timed? ?out/i,
    /server selection/i,
    /socket hang ?up/i,
];

export function rememberKubernetesCluster(clusterId: string, metadata: KubernetesPortForwardMetadata): void {
    knownClusters.set(clusterId, metadata);
}

/** Test-only: drops the recorded mappings so suites start from a known state. */
export function resetKubernetesClustersForTests(): void {
    knownClusters.clear();
}

export class KubernetesErrorExplainer implements ErrorExplanationProvider {
    public readonly id = 'kubernetes-port-forward';

    public async explain({
        clusterId,
        error,
    }: ErrorExplanationRequest): Promise<ConnectionExplanation | undefined> {
        const metadata = knownClusters.get(clusterId);
        if (!metadata) {
            return undefined;
        }
        // The text names the service and namespace; listing them lets a shared report hide them.
        const identifiers: ExplanationIdentifier[] = [
            { kind: 'service', value: metadata.serviceName },
            { kind: 'namespace', value: metadata.namespace },
        ];

        const target = l10n.t('"{service}" in namespace "{namespace}"', {
            service: metadata.serviceName,
            namespace: metadata.namespace,
        });

        // Heavy dependency, so it is only pulled in once we know the cluster is one of ours.
        const { PortForwardTunnelManager } = await import('./portForwardTunnel');
        const isTunnelUp = PortForwardTunnelManager.getInstance().hasTunnel(
            metadata.sourceId,
            metadata.contextName,
            metadata.namespace,
            metadata.serviceName,
            metadata.localPort,
        );

        if (!isTunnelUp) {
            return {
                message: l10n.t(
                    'We cannot find an active port-forward tunnel to {target}, so localhost:{port} very likely does not reach the cluster right now. Collapse and expand the connection again to re-establish the tunnel.',
                    { target, port: String(metadata.localPort) },
                ),
                identifiers,
            };
        }

        // The tunnel looks up, so a transport failure points past it, at the service or the pod.
        const message = error instanceof Error ? error.message : String(error);
        if (NO_ANSWER_SIGNATURES.some((signature) => signature.test(message))) {
            return {
                message: l10n.t(
                    'The port-forward tunnel to {target} looks active, but the service did not answer. The pod behind it may have restarted or been rescheduled.',
                    { target },
                ),
                identifiers,
            };
        }

        return undefined;
    }
}
