/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DOCUMENTDB_PORTS } from './config';

// Lazy-load @kubernetes/client-node to avoid impacting extension startup.
// Only type imports are used at the top level — they disappear at runtime.
import {
    type CoreV1Api,
    type KubeConfig,
    type V1Namespace,
    type V1Node,
    type V1Service,
} from '@kubernetes/client-node';

/**
 * Information about a Kubernetes context extracted from kubeconfig.
 */
export interface KubeContextInfo {
    /** Context name as defined in kubeconfig */
    readonly name: string;
    /** Cluster name referenced by this context */
    readonly cluster: string;
    /** User name referenced by this context */
    readonly user: string;
    /** Cluster server URL */
    readonly server: string;
}

/**
 * Information about a discovered Kubernetes service.
 */
export interface KubeServiceInfo {
    /** Service name */
    readonly name: string;
    /** Namespace the service belongs to */
    readonly namespace: string;
    /** Service type: ClusterIP, NodePort, LoadBalancer, ExternalName */
    readonly type: string;
    /** Target port (the container port) */
    readonly port: number;
    /** NodePort (only for NodePort services) */
    readonly nodePort?: number;
    /** External IP or hostname (only for LoadBalancer services) */
    readonly externalAddress?: string;
    /** Cluster IP */
    readonly clusterIP?: string;
    /** Credentials from a linked DocumentDB CR secret (auto-resolved) */
    readonly credentials?: { username: string; password: string };
    /** Extra connection string parameters (e.g. TLS, authMechanism) */
    readonly connectionParams?: string;
}

/**
 * Resolved endpoint for connecting to a Kubernetes service.
 */
export interface KubeServiceEndpoint {
    /** The MongoDB connection string, if resolvable */
    readonly connectionString?: string;
    /** Whether the service is reachable from outside the cluster */
    readonly isReachable: boolean;
    /** Reason why the service is not reachable (for ClusterIP without port-forward) */
    readonly unreachableReason?: string;
}

/**
 * Resolves kubeconfig file path(s), expanding `~` and supporting KUBECONFIG path lists.
 * Returns the first valid path from the KUBECONFIG env var (which can be colon-separated on
 * Unix or semicolon-separated on Windows), or falls back to ~/.kube/config.
 */
function resolveKubeconfigPath(kubeconfigPath?: string): string {
    if (kubeconfigPath) {
        if (kubeconfigPath.startsWith('~')) {
            return path.join(os.homedir(), kubeconfigPath.slice(1));
        }
        return kubeconfigPath;
    }

    // KUBECONFIG env var can be a path list (colon-separated on Unix, semicolon-separated on Windows)
    const envValue = process.env.KUBECONFIG;
    if (envValue) {
        const separator = process.platform === 'win32' ? ';' : ':';
        const paths = envValue.split(separator).filter((p) => p.length > 0);
        if (paths.length > 0) {
            const first = paths[0];
            if (first.startsWith('~')) {
                return path.join(os.homedir(), first.slice(1));
            }
            return first;
        }
    }

    return path.join(os.homedir(), '.kube', 'config');
}

/**
 * Loads a KubeConfig from the specified path (or default locations).
 *
 * @param kubeconfigPath Optional path to a kubeconfig file. Defaults to KUBECONFIG env or ~/.kube/config.
 * @returns A loaded KubeConfig instance
 * @throws Error if the kubeconfig file cannot be loaded or parsed
 */
export async function loadKubeConfig(kubeconfigPath?: string): Promise<KubeConfig> {
    const k8s = await import('@kubernetes/client-node');
    const kc = new k8s.KubeConfig();

    if (kubeconfigPath) {
        // Explicit path — load from that file
        const resolvedPath = resolveKubeconfigPath(kubeconfigPath);
        try {
            kc.loadFromFile(resolvedPath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(
                vscode.l10n.t(
                    'Failed to load kubeconfig from "{0}": {1}. Ensure the file exists and contains valid YAML.',
                    resolvedPath,
                    errorMessage,
                ),
            );
        }
    } else {
        // No explicit path — use the client's default loading which handles:
        // - KUBECONFIG env var (including colon/semicolon-separated path lists)
        // - ~/.kube/config fallback
        // - In-cluster service account tokens
        try {
            kc.loadFromDefault();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(
                vscode.l10n.t(
                    'Failed to load kubeconfig: {0}. Ensure a kubeconfig file exists at ~/.kube/config or the KUBECONFIG environment variable is set.',
                    errorMessage,
                ),
            );
        }
    }

    return kc;
}

/**
 * Extracts context information from a loaded KubeConfig.
 *
 * @param kubeConfig A loaded KubeConfig instance
 * @returns Array of context information
 */
export function getContexts(kubeConfig: KubeConfig): KubeContextInfo[] {
    const contexts = kubeConfig.getContexts();
    return contexts.map((ctx) => {
        const cluster = kubeConfig.getCluster(ctx.cluster);
        return {
            name: ctx.name,
            cluster: ctx.cluster,
            user: ctx.user,
            server: cluster?.server ?? '',
        };
    });
}

/**
 * Creates a CoreV1Api client for the specified kubeconfig context.
 *
 * @param kubeConfig A loaded KubeConfig instance
 * @param contextName The context to use
 * @returns A CoreV1Api client
 */
export async function createCoreApi(kubeConfig: KubeConfig, contextName: string): Promise<CoreV1Api> {
    const k8s = await import('@kubernetes/client-node');
    kubeConfig.setCurrentContext(contextName);
    return kubeConfig.makeApiClient(k8s.CoreV1Api);
}

/**
 * Lists namespaces accessible in the given context.
 *
 * @param coreApi A CoreV1Api client
 * @returns Array of namespace names
 * @throws Error if the API call fails (e.g., RBAC denied)
 */
export async function listNamespaces(coreApi: CoreV1Api): Promise<string[]> {
    try {
        const response = await coreApi.listNamespace();
        const namespaces: V1Namespace[] = response.items;
        return namespaces
            .map((ns) => ns.metadata?.name)
            .filter((name): name is string => !!name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
            vscode.l10n.t(
                'Failed to list namespaces: {0}. Check that your credentials are valid and you have the required RBAC permissions.',
                errorMessage,
            ),
        );
    }
}

/**
 * Lists services in a namespace that expose DocumentDB-compatible ports.
 * Automatically resolves credentials from DocumentDB CRs when available.
 *
 * @param coreApi A CoreV1Api client
 * @param namespace The namespace to search
 * @param kubeConfig Optional KubeConfig for resolving DocumentDB CR credentials
 * @returns Array of service information for services on MongoDB/DocumentDB ports
 */
export async function listDocumentDBServices(
    coreApi: CoreV1Api,
    namespace: string,
    kubeConfig?: KubeConfig,
): Promise<KubeServiceInfo[]> {
    try {
        const response = await coreApi.listNamespacedService({ namespace });
        const services: V1Service[] = response.items;

        const result: KubeServiceInfo[] = [];

        for (const svc of services) {
            const svcName = svc.metadata?.name;
            const svcType = svc.spec?.type ?? 'ClusterIP';

            if (!svcName || !svc.spec?.ports) {
                continue;
            }

            for (const port of svc.spec.ports) {
                const targetPort = port.targetPort ?? port.port;
                const portNumber = typeof targetPort === 'number' ? targetPort : port.port;

                if (portNumber !== undefined && DOCUMENTDB_PORTS.includes(portNumber)) {
                    const externalAddress = resolveExternalAddress(svc);

                    // Try to resolve credentials from a DocumentDB CR
                    let credentials: { username: string; password: string } | undefined;
                    let connectionParams: string | undefined;
                    if (kubeConfig) {
                        const resolved = await resolveDocumentDBCredentials(coreApi, kubeConfig, namespace, svcName);
                        if (resolved) {
                            credentials = { username: resolved.username, password: resolved.password };
                            connectionParams = resolved.connectionParams;
                        }
                    }

                    result.push({
                        name: svcName,
                        namespace,
                        type: svcType,
                        port: port.port ?? portNumber,
                        nodePort: port.nodePort ?? undefined,
                        externalAddress,
                        clusterIP: svc.spec.clusterIP ?? undefined,
                        credentials,
                        connectionParams,
                    });
                    // Only include the first matching port per service
                    break;
                }
            }
        }

        return result.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
            vscode.l10n.t(
                'Failed to list services in namespace "{0}": {1}. Check your RBAC permissions.',
                namespace,
                errorMessage,
            ),
        );
    }
}

/**
 * Resolves the external address for a LoadBalancer service.
 */
function resolveExternalAddress(svc: V1Service): string | undefined {
    if (svc.spec?.type !== 'LoadBalancer') {
        return undefined;
    }

    const ingress = svc.status?.loadBalancer?.ingress;
    if (!ingress || ingress.length === 0) {
        return undefined;
    }

    // Prefer hostname over IP for DNS stability
    return ingress[0].hostname ?? ingress[0].ip ?? undefined;
}

/** Allowed MongoDB connection string parameter names for security */
const ALLOWED_CONNECTION_PARAMS = new Set([
    'directConnection',
    'authMechanism',
    'authSource',
    'tls',
    'tlsAllowInvalidCertificates',
    'tlsAllowInvalidHostnames',
    'replicaSet',
    'retryWrites',
    'w',
    'readPreference',
]);

/**
 * Builds a MongoDB connection string WITHOUT credentials (credentials go in nativeAuthConfig).
 * Connection parameters are validated against an allowlist to prevent injection.
 */
function buildConnectionString(host: string, port: number, service: KubeServiceInfo): string {
    let paramPart = '';
    if (service.connectionParams) {
        // Validate each parameter against the allowlist
        const params = new URLSearchParams(service.connectionParams);
        const validParams = new URLSearchParams();
        for (const [key, value] of params.entries()) {
            if (ALLOWED_CONNECTION_PARAMS.has(key)) {
                validParams.set(key, value);
            }
        }
        const validated = validParams.toString();
        if (validated) {
            paramPart = `?${validated}`;
        }
    }
    return `mongodb://${host}:${String(port)}/${paramPart}`;
}

/**
 * Prompts the user to confirm or change the local port for port-forwarding a ClusterIP service.
 * Defaults to the service port itself.
 */
async function promptForLocalPort(service: KubeServiceInfo): Promise<number> {
    const input = await vscode.window.showInputBox({
        title: vscode.l10n.t('Port Forward: {0}', service.name),
        prompt: vscode.l10n.t(
            'This ClusterIP service requires port-forwarding. Enter the local port to use.\n\nRun: kubectl port-forward svc/{0} <localPort>:{1} -n {2}',
            service.name,
            String(service.port),
            service.namespace,
        ),
        value: String(service.port),
        validateInput: (value: string) => {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 65535) {
                return vscode.l10n.t('Enter a valid port number (1-65535)');
            }
            return undefined;
        },
    });

    if (input === undefined) {
        // User cancelled — fall back to service port
        return service.port;
    }

    return parseInt(input, 10);
}

/**
 * Resolves the connection endpoint for a Kubernetes service.
 *
 * @param service The service to resolve
 * @param coreApi A CoreV1Api client (needed for NodePort to fetch node IPs)
 * @returns The resolved endpoint information
 */
export async function resolveServiceEndpoint(
    service: KubeServiceInfo,
    coreApi: CoreV1Api,
): Promise<KubeServiceEndpoint> {
    switch (service.type) {
        case 'LoadBalancer': {
            if (service.externalAddress) {
                return {
                    connectionString: buildConnectionString(service.externalAddress, service.port, service),
                    isReachable: true,
                };
            }
            // LoadBalancer without external IP — fall back to NodePort behavior.
            // LoadBalancer services always get a nodePort allocated automatically.
            // This handles local clusters (kind, minikube) where external IPs are never assigned.
            if (service.nodePort) {
                const nodeAddress = await getFirstNodeAddress(coreApi);
                if (nodeAddress) {
                    return {
                        connectionString: buildConnectionString(nodeAddress, service.nodePort, service),
                        isReachable: true,
                    };
                }
            }
            return {
                isReachable: false,
                unreachableReason: vscode.l10n.t(
                    'LoadBalancer external IP is not yet assigned and no NodePort fallback is available. The service may still be provisioning.',
                ),
            };
        }

        case 'NodePort': {
            if (service.nodePort) {
                const nodeAddress = await getFirstNodeAddress(coreApi);
                if (nodeAddress) {
                    return {
                        connectionString: buildConnectionString(nodeAddress, service.nodePort, service),
                        isReachable: true,
                    };
                }
            }
            return {
                isReachable: false,
                unreachableReason: vscode.l10n.t(
                    'Could not determine a node address for NodePort service. Check that cluster nodes are accessible.',
                ),
            };
        }

        case 'ClusterIP': {
            // ClusterIP services are only reachable via port-forward.
            // Return a localhost connection string — the user is expected to run:
            //   kubectl port-forward svc/<name> <localPort>:<servicePort> -n <namespace>
            // We prompt the user to confirm the local port.
            const localPort = await promptForLocalPort(service);
            return {
                connectionString: buildConnectionString('localhost', localPort, service),
                isReachable: true,
            };
        }

        case 'ExternalName': {
            // ExternalName services rely on external DNS — not commonly used for DocumentDB.
            // We don't have the raw V1Service object here, so we can't resolve the external name.
            return {
                isReachable: false,
                unreachableReason: vscode.l10n.t(
                    'ExternalName services are not directly supported. Use the external DNS name to connect manually.',
                ),
            };
        }

        default:
            return {
                isReachable: false,
                unreachableReason: vscode.l10n.t('Unsupported service type: {0}', service.type),
            };
    }
}

/**
 * Gets the address of the first schedulable node in the cluster.
 * Used for NodePort service resolution.
 */
async function getFirstNodeAddress(coreApi: CoreV1Api): Promise<string | undefined> {
    try {
        const response = await coreApi.listNode();
        const nodes: V1Node[] = response.items;

        for (const node of nodes) {
            const addresses = node.status?.addresses;
            if (!addresses) continue;

            // Prefer ExternalIP, fall back to InternalIP
            const externalIP = addresses.find((addr) => addr.type === 'ExternalIP');
            if (externalIP?.address) {
                return externalIP.address;
            }

            const internalIP = addresses.find((addr) => addr.type === 'InternalIP');
            if (internalIP?.address) {
                return internalIP.address;
            }
        }
    } catch {
        // If we can't list nodes, we can't resolve NodePort addresses
    }

    return undefined;
}

/**
 * Attempts to find DocumentDB custom resources in the namespace and resolve
 * credentials from the referenced Secret for services on port 10260.
 *
 * @param coreApi A CoreV1Api client
 * @param kubeConfig The KubeConfig instance (for custom object API)
 * @param namespace The namespace to search
 * @param serviceName The service name to match against DocumentDB CRs
 * @returns Credentials and connection params if a matching DocumentDB CR is found
 */
export async function resolveDocumentDBCredentials(
    coreApi: CoreV1Api,
    kubeConfig: KubeConfig,
    namespace: string,
    serviceName: string,
): Promise<{ username: string; password: string; connectionParams: string } | undefined> {
    try {
        const k8s = await import('@kubernetes/client-node');
        const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);

        // List DocumentDB custom resources in this namespace
        const response: unknown = await customApi.listNamespacedCustomObject({
            group: 'documentdb.io',
            version: 'preview',
            namespace,
            plural: 'dbs',
        });

        const responseObj = response !== null && response !== undefined && typeof response === 'object' ? response : {};
        const items = Array.isArray((responseObj as Record<string, unknown>).items)
            ? ((responseObj as Record<string, unknown>).items as unknown[])
            : undefined;
        if (!items || items.length === 0) {
            return undefined;
        }

        // Find the DocumentDB CR whose service matches this service name
        // The operator creates a service named `documentdb-service-<crName>`
        for (const item of items) {
            if (item === null || item === undefined || typeof item !== 'object') continue;
            const itemObj = item as Record<string, unknown>;
            const metadata =
                itemObj.metadata !== null && itemObj.metadata !== undefined && typeof itemObj.metadata === 'object'
                    ? (itemObj.metadata as Record<string, unknown>)
                    : undefined;
            const spec =
                itemObj.spec !== null && itemObj.spec !== undefined && typeof itemObj.spec === 'object'
                    ? (itemObj.spec as Record<string, unknown>)
                    : undefined;
            const crName = typeof metadata?.name === 'string' ? metadata.name : undefined;
            if (!crName) continue;

            // Check if this service belongs to this CR
            const expectedServiceName = `documentdb-service-${crName}`;
            if (serviceName !== expectedServiceName) continue;

            // Found a match — read credentials from the referenced secret
            const secretName =
                typeof spec?.documentDbCredentialSecret === 'string'
                    ? spec.documentDbCredentialSecret
                    : 'documentdb-credentials';
            try {
                const secret = await coreApi.readNamespacedSecret({ name: secretName, namespace });
                const data = secret.data;
                if (data?.username && data?.password) {
                    const username = Buffer.from(data.username, 'base64').toString('utf-8');
                    const password = Buffer.from(data.password, 'base64').toString('utf-8');
                    return {
                        username,
                        password,
                        connectionParams:
                            'directConnection=true&authMechanism=SCRAM-SHA-256&tls=true&tlsAllowInvalidCertificates=true&replicaSet=rs0',
                    };
                }
            } catch {
                // Secret not found or not readable
            }
        }
    } catch {
        // DocumentDB CRD not installed or RBAC denied — not an error
    }

    return undefined;
}
