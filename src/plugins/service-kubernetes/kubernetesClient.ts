/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

// Lazy-load @kubernetes/client-node to avoid impacting extension startup.
// Only type imports are used at the top level — they disappear at runtime.
import {
    type CoreV1Api,
    type KubeConfig,
    type V1Namespace,
    type V1Node,
    type V1Service,
} from '@kubernetes/client-node';
import {
    CREDENTIAL_SECRET_ANNOTATION,
    CUSTOM_KUBECONFIG_PATH_KEY,
    DISCOVERY_ANNOTATION,
    DOCUMENTDB_PORTS,
    INLINE_KUBECONFIG_SECRET_KEY,
    KUBECONFIG_SOURCE_KEY,
    type KubeconfigSource,
} from './config';

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
    /** Inferred cluster provider (AKS, EKS, GKE, kind, minikube, etc.) */
    readonly provider?: string;
    /** Inferred region from server URL or cluster name, if detectable */
    readonly region?: string;
}

/**
 * Information about a discovered DocumentDB target in Kubernetes.
 * Targets can come from DKO-managed DocumentDB resources or a constrained
 * generic fallback for self-managed DocumentDB services.
 */
export interface KubeServiceInfo {
    /** Discovery source kind */
    readonly sourceKind: 'dko' | 'generic';
    /** Backward-compatible primary identifier (currently the backing service name) */
    readonly name: string;
    /** User-facing display label */
    readonly displayName: string;
    /** Backing Kubernetes Service name */
    readonly serviceName: string;
    /** Namespace the service belongs to */
    readonly namespace: string;
    /** Service type: ClusterIP, NodePort, LoadBalancer, ExternalName */
    readonly type: string;
    /** Service port used for client connections */
    readonly port: number;
    /** Service port name, used to map ClusterIP service ports to endpoint target ports */
    readonly portName?: string;
    /** NodePort (only for NodePort services) */
    readonly nodePort?: number;
    /** External IP or hostname (only for LoadBalancer services) */
    readonly externalAddress?: string;
    /** Cluster IP */
    readonly clusterIP?: string;
    /** DKO DocumentDB resource name when sourceKind === 'dko' */
    readonly documentDbName?: string;
    /** DKO status/health text when available */
    readonly status?: string;
    /** Whether DKO reports the gateway TLS certificate as trusted/ready */
    readonly tlsReady?: boolean;
    /** Secret name referenced by the DKO resource when available */
    readonly secretName?: string;
    /** Annotation-derived credential secret name for generic (non-DKO) services */
    readonly credentialSecretName?: string;
    /** Credentials from a linked DocumentDB CR secret (auto-resolved) */
    readonly credentials?: { username: string; password: string };
    /** Extra connection string parameters (e.g. TLS, authMechanism) */
    readonly connectionParams?: string;
}

export type KubeServiceEndpoint =
    | {
          readonly kind: 'ready';
          readonly connectionString: string;
          /**
           * Optional reachability warning — present when the resolved address may not
           * be accessible from outside the cluster (e.g. NodePort/LoadBalancer-NodePort
           * fallback using a node InternalIP).
           */
          readonly warning?: string;
      }
    | {
          readonly kind: 'needsPortForward';
          readonly serviceName: string;
          readonly namespace: string;
          readonly remotePort: number;
          readonly remotePortName?: string;
          readonly suggestedLocalPort: number;
      }
    | {
          readonly kind: 'pending' | 'unreachable';
          readonly reason: string;
      };

interface DkoDocumentDbResourceInfo {
    readonly name: string;
    readonly namespace: string;
    readonly secretName: string;
    readonly serviceName: string;
    readonly serviceType?: string;
    readonly status?: string;
    readonly tlsReady: boolean;
}

const DEFAULT_DKO_SECRET_NAME = 'documentdb-credentials';
const DKO_SERVICE_PREFIX = 'documentdb-service-';

/**
 * Returns true if `name` is a valid Kubernetes resource name (DNS subdomain rules).
 * Used to sanitize annotation values before attempting secret reads.
 *
 * Rules: 1–253 characters total. The name is split by `.` into labels; each
 * label must be 1–63 characters, start and end with a lowercase alphanumeric
 * character, and contain only lowercase alphanumeric characters or hyphens.
 * Consecutive dots (empty labels) are rejected.
 *
 * @internal Exported for testing.
 */
export function isValidKubernetesSecretName(name: string): boolean {
    if (!name || name.length > 253) {
        return false;
    }
    // Split on '.' to validate each DNS label; consecutive dots produce an empty
    // label which fails the length check below.
    const labels = name.split('.');
    return labels.every((label) => {
        if (label.length === 0 || label.length > 63) {
            return false;
        }
        return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label);
    });
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
 * @param kubeconfigContents Optional kubeconfig YAML content.
 * @returns A loaded KubeConfig instance
 * @throws Error if the kubeconfig file cannot be loaded or parsed
 */
export async function loadKubeConfig(kubeconfigPath?: string, kubeconfigContents?: string): Promise<KubeConfig> {
    const k8s = await import('@kubernetes/client-node');
    const kc = new k8s.KubeConfig();

    if (kubeconfigContents) {
        try {
            kc.loadFromString(kubeconfigContents);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(
                vscode.l10n.t(
                    'Failed to load kubeconfig from pasted YAML: {0}. Ensure the clipboard contains a valid kubeconfig document.',
                    errorMessage,
                ),
            );
        }
    } else if (kubeconfigPath) {
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

        if (isSyntheticDefaultKubeConfig(kc)) {
            throw new Error(
                vscode.l10n.t(
                    'No Kubernetes kubeconfig was found. Ensure a kubeconfig file exists at ~/.kube/config or the KUBECONFIG environment variable is set.',
                ),
            );
        }
    }

    return kc;
}

function isSyntheticDefaultKubeConfig(kubeConfig: KubeConfig): boolean {
    const contexts = kubeConfig.getContexts();
    const clusters = kubeConfig.getClusters();
    const users = kubeConfig.getUsers();

    return (
        kubeConfig.getCurrentContext() === 'loaded-context' &&
        contexts.length === 1 &&
        contexts[0]?.name === 'loaded-context' &&
        contexts[0]?.cluster === 'cluster' &&
        contexts[0]?.user === 'user' &&
        clusters.length === 1 &&
        clusters[0]?.name === 'cluster' &&
        clusters[0]?.server === 'http://localhost:8080' &&
        users.length === 1 &&
        users[0]?.name === 'user'
    );
}

export async function loadConfiguredKubeConfig(): Promise<KubeConfig> {
    const kubeconfigSource = ext.context.globalState.get<KubeconfigSource>(KUBECONFIG_SOURCE_KEY, 'default');

    switch (kubeconfigSource) {
        case 'customFile': {
            const kubeconfigPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
            if (!kubeconfigPath) {
                throw new Error(
                    vscode.l10n.t(
                        'No custom kubeconfig file is configured. Reconfigure Kubernetes discovery credentials.',
                    ),
                );
            }

            return await loadKubeConfig(kubeconfigPath);
        }
        case 'inline': {
            let kubeconfigContents: string | undefined;
            try {
                kubeconfigContents = await ext.secretStorage.get(INLINE_KUBECONFIG_SECRET_KEY);
            } catch {
                throw new Error(
                    vscode.l10n.t(
                        'Failed to read stored kubeconfig from secure storage. Reconfigure Kubernetes discovery credentials.',
                    ),
                );
            }

            if (!kubeconfigContents) {
                throw new Error(
                    vscode.l10n.t('No pasted kubeconfig YAML is stored. Reconfigure Kubernetes discovery credentials.'),
                );
            }

            return await loadKubeConfig(undefined, kubeconfigContents);
        }
        case 'default':
        default:
            return await loadKubeConfig();
    }
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
        const server = cluster?.server ?? '';
        const { provider, region } = inferClusterProvider(server, ctx.name, ctx.cluster);
        return {
            name: ctx.name,
            cluster: ctx.cluster,
            user: ctx.user,
            server,
            provider,
            region,
        };
    });
}

/**
 * Infers the Kubernetes cluster provider and region from server URL,
 * context name, and cluster name heuristics. No extra API calls needed.
 *
 * @internal Exported for testing.
 */
export function inferClusterProvider(
    server: string,
    contextName: string,
    clusterName: string,
): { provider?: string; region?: string } {
    const serverLower = server.toLowerCase();
    const nameLower = `${contextName} ${clusterName}`.toLowerCase();

    // AKS: *.azmk8s.io or *.hcp.<region>.azmk8s.io
    const aksMatch = serverLower.match(/\.(?:hcp\.)?([a-z0-9-]+)\.azmk8s\.io/);
    if (aksMatch) {
        return { provider: 'AKS', region: aksMatch[1] };
    }

    // EKS: *.eks.amazonaws.com or *.gr7.<region>.eks.amazonaws.com
    const eksMatch = serverLower.match(/\.([a-z]+-[a-z]+-\d+)\.eks\.amazonaws\.com/);
    if (eksMatch) {
        return { provider: 'EKS', region: eksMatch[1] };
    }

    // GKE: container.googleapis.com or *.gke.io
    if (serverLower.includes('container.googleapis.com') || serverLower.includes('.gke.io')) {
        return { provider: 'GKE' };
    }

    // OpenShift: api.<cluster>.<domain> with openshift in name
    if (nameLower.includes('openshift') || serverLower.includes('.openshift.')) {
        return { provider: 'OpenShift' };
    }

    // kind: context/cluster names typically start with "kind-"
    if (contextName.startsWith('kind-') || clusterName.startsWith('kind-')) {
        return { provider: 'kind' };
    }

    // minikube
    if (nameLower.includes('minikube')) {
        return { provider: 'minikube' };
    }

    // k3s / k3d
    if (nameLower.includes('k3s') || nameLower.includes('k3d')) {
        return { provider: 'k3s' };
    }

    // Docker Desktop
    if (nameLower.includes('docker-desktop') || nameLower.includes('docker desktop')) {
        return { provider: 'Docker Desktop' };
    }

    // Rancher Desktop
    if (nameLower.includes('rancher')) {
        return { provider: 'Rancher' };
    }

    return {};
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

function getDkoServiceName(documentDbName: string): string {
    const serviceName = `${DKO_SERVICE_PREFIX}${documentDbName}`;
    return serviceName.length > 63 ? serviceName.slice(0, 63) : serviceName;
}

function buildDocumentDbConnectionParams(): string {
    const params = new URLSearchParams();
    params.set('directConnection', 'true');
    params.set('authMechanism', 'SCRAM-SHA-256');
    params.set('tls', 'true');
    params.set('tlsAllowInvalidCertificates', 'true');
    params.set('replicaSet', 'rs0');
    return params.toString();
}

function getMatchingServicePort(
    service: V1Service,
    allowedPorts: readonly number[],
): { port: number; portName?: string; nodePort?: number } | undefined {
    const ports = service.spec?.ports;
    if (!ports) {
        return undefined;
    }

    for (const port of ports) {
        // Only consider TCP ports. Kubernetes defaults protocol to TCP when unspecified.
        if (port.protocol && port.protocol !== 'TCP') {
            continue;
        }
        const targetPort = port.targetPort ?? port.port;
        const candidatePort = typeof targetPort === 'number' ? targetPort : port.port;
        if (candidatePort !== undefined && allowedPorts.includes(candidatePort)) {
            return {
                port: port.port ?? candidatePort,
                portName: port.name,
                nodePort: port.nodePort ?? undefined,
            };
        }
    }

    return undefined;
}

function getPrimaryServicePort(service: V1Service): { port: number; portName?: string; nodePort?: number } | undefined {
    // Only consider TCP ports; Kubernetes defaults protocol to TCP when unspecified.
    const firstTcpPort = service.spec?.ports?.find((p) => !p.protocol || p.protocol === 'TCP');
    if (!firstTcpPort) {
        return undefined;
    }

    const targetPort = firstTcpPort.targetPort ?? firstTcpPort.port;
    const resolvedPort = typeof targetPort === 'number' ? targetPort : firstTcpPort.port;
    if (resolvedPort === undefined) {
        return undefined;
    }

    return {
        port: firstTcpPort.port ?? resolvedPort,
        portName: firstTcpPort.name,
        nodePort: firstTcpPort.nodePort ?? undefined,
    };
}

async function listDkoDocumentDbResources(
    kubeConfig: KubeConfig,
    namespace: string,
): Promise<DkoDocumentDbResourceInfo[]> {
    try {
        const k8s = await import('@kubernetes/client-node');
        const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
        const response: unknown = await customApi.listNamespacedCustomObject({
            group: 'documentdb.io',
            version: 'preview',
            namespace,
            plural: 'dbs',
        });

        const responseObj =
            response !== null && response !== undefined && typeof response === 'object'
                ? (response as Record<string, unknown>)
                : undefined;
        const items = Array.isArray(responseObj?.items) ? responseObj.items : [];
        const result: DkoDocumentDbResourceInfo[] = [];

        for (const item of items) {
            if (item === null || item === undefined || typeof item !== 'object') {
                continue;
            }

            const itemObj = item as Record<string, unknown>;
            const metadata =
                itemObj.metadata !== null && itemObj.metadata !== undefined && typeof itemObj.metadata === 'object'
                    ? (itemObj.metadata as Record<string, unknown>)
                    : undefined;
            const spec =
                itemObj.spec !== null && itemObj.spec !== undefined && typeof itemObj.spec === 'object'
                    ? (itemObj.spec as Record<string, unknown>)
                    : undefined;
            const status =
                itemObj.status !== null && itemObj.status !== undefined && typeof itemObj.status === 'object'
                    ? (itemObj.status as Record<string, unknown>)
                    : undefined;
            const exposeViaService =
                spec?.exposeViaService !== null &&
                spec?.exposeViaService !== undefined &&
                typeof spec.exposeViaService === 'object'
                    ? (spec.exposeViaService as Record<string, unknown>)
                    : undefined;
            const tlsStatus =
                status?.tls !== null && status?.tls !== undefined && typeof status.tls === 'object'
                    ? (status.tls as Record<string, unknown>)
                    : undefined;

            const resourceName = typeof metadata?.name === 'string' ? metadata.name : undefined;
            if (!resourceName) {
                continue;
            }

            result.push({
                name: resourceName,
                namespace,
                secretName:
                    typeof spec?.documentDbCredentialSecret === 'string'
                        ? spec.documentDbCredentialSecret
                        : DEFAULT_DKO_SECRET_NAME,
                serviceName: getDkoServiceName(resourceName),
                serviceType:
                    typeof exposeViaService?.serviceType === 'string' ? exposeViaService.serviceType : undefined,
                status: typeof status?.status === 'string' ? status.status : undefined,
                tlsReady: tlsStatus?.ready === true,
            });
        }

        return result.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } catch {
        // DKO CRD not installed or inaccessible — treat as no DKO resources and fall back to generic discovery.
        return [];
    }
}

function createDkoTarget(resource: DkoDocumentDbResourceInfo, service: V1Service | undefined): KubeServiceInfo {
    const servicePort = service ? getPrimaryServicePort(service) : undefined;

    return {
        sourceKind: 'dko',
        name: resource.serviceName,
        displayName: resource.name,
        serviceName: resource.serviceName,
        namespace: resource.namespace,
        type: service?.spec?.type ?? resource.serviceType ?? 'ClusterIP',
        port: servicePort?.port ?? 10260,
        portName: servicePort?.portName,
        nodePort: servicePort?.nodePort,
        externalAddress: service ? resolveExternalAddress(service) : undefined,
        clusterIP: service?.spec?.clusterIP ?? undefined,
        documentDbName: resource.name,
        status: resource.status,
        tlsReady: resource.tlsReady,
        secretName: resource.secretName,
        connectionParams: buildDocumentDbConnectionParams(),
    };
}

function createGenericDocumentDbTarget(service: V1Service): KubeServiceInfo | undefined {
    const serviceName = service.metadata?.name;
    const serviceType = service.spec?.type ?? 'ClusterIP';
    const annotations = service.metadata?.annotations ?? {};
    const labels = service.metadata?.labels ?? {};

    // Explicit opt-in via annotation OR label takes priority: any TCP port is accepted.
    const hasOptIn = annotations[DISCOVERY_ANNOTATION] === 'true' || labels[DISCOVERY_ANNOTATION] === 'true';

    // Read and validate the credential-secret annotation if present.
    const rawCredentialAnnotation = annotations[CREDENTIAL_SECRET_ANNOTATION];
    const credentialSecretName =
        rawCredentialAnnotation && isValidKubernetesSecretName(rawCredentialAnnotation)
            ? rawCredentialAnnotation
            : undefined;

    let portInfo: { port: number; portName?: string; nodePort?: number } | undefined;
    if (hasOptIn) {
        // Annotated/labelled service: include with its first service port (any TCP port).
        portInfo = getPrimaryServicePort(service);
    } else {
        // Generic fallback: only include services exposing a known DocumentDB API-compatible port.
        portInfo = getMatchingServicePort(service, DOCUMENTDB_PORTS);
    }

    if (!serviceName || !portInfo) {
        return undefined;
    }

    return {
        sourceKind: 'generic',
        name: serviceName,
        displayName: serviceName,
        serviceName,
        namespace: service.metadata?.namespace ?? '',
        type: serviceType,
        port: portInfo.port,
        portName: portInfo.portName,
        nodePort: portInfo.nodePort,
        externalAddress: resolveExternalAddress(service),
        clusterIP: service.spec?.clusterIP ?? undefined,
        credentialSecretName,
        connectionParams: buildDocumentDbConnectionParams(),
    };
}

/**
 * Lists services in a namespace that expose DocumentDB-compatible ports.
 * Automatically resolves credentials from DocumentDB CRs when available.
 *
 * @param coreApi A CoreV1Api client
 * @param namespace The namespace to search
 * @param kubeConfig Optional KubeConfig for resolving DocumentDB CR credentials
 * @returns Array of service information for services on DocumentDB API-compatible ports
 */
export async function listDocumentDBServices(
    coreApi: CoreV1Api,
    namespace: string,
    kubeConfig?: KubeConfig,
): Promise<KubeServiceInfo[]> {
    try {
        const response = await coreApi.listNamespacedService({ namespace });
        const services: V1Service[] = response.items;
        const servicesByName = new Map<string, V1Service>();
        for (const service of services) {
            const serviceName = service.metadata?.name;
            if (serviceName) {
                servicesByName.set(serviceName, service);
            }
        }

        const dkoResources = kubeConfig ? await listDkoDocumentDbResources(kubeConfig, namespace) : [];
        const claimedServiceNames = new Set<string>();
        const result: KubeServiceInfo[] = [];

        for (const resource of dkoResources) {
            claimedServiceNames.add(resource.serviceName);
            result.push(createDkoTarget(resource, servicesByName.get(resource.serviceName)));
        }

        for (const service of services) {
            const serviceName = service.metadata?.name;
            if (!serviceName || claimedServiceNames.has(serviceName)) {
                continue;
            }

            const genericTarget = createGenericDocumentDbTarget(service);
            if (genericTarget) {
                result.push(genericTarget);
            }
        }

        return result.sort((a, b) => {
            if (a.sourceKind !== b.sourceKind) {
                return a.sourceKind === 'dko' ? -1 : 1;
            }
            return a.displayName.localeCompare(b.displayName, undefined, { numeric: true });
        });
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

/** Allowed DocumentDB API connection string parameter names for security */
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
 * Builds a connection string in the DocumentDB API connection string format WITHOUT
 * credentials (credentials go in nativeAuthConfig).
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

export function buildPortForwardConnectionString(service: KubeServiceInfo, localPort: number): string {
    return buildConnectionString('127.0.0.1', localPort, service);
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
                    kind: 'ready',
                    connectionString: buildConnectionString(service.externalAddress, service.port, service),
                };
            }
            // LoadBalancer without external IP — fall back to NodePort behavior.
            // LoadBalancer services always get a nodePort allocated automatically.
            // This handles local clusters (kind, minikube) where external IPs are never assigned.
            if (service.nodePort) {
                const nodeAddressResult = await getFirstNodeAddress(coreApi);
                if (nodeAddressResult) {
                    const connectionString = buildConnectionString(
                        nodeAddressResult.address,
                        service.nodePort,
                        service,
                    );
                    if (nodeAddressResult.isExternal) {
                        return { kind: 'ready', connectionString };
                    }
                    return {
                        kind: 'ready',
                        connectionString,
                        warning: vscode.l10n.t(
                            'LoadBalancer external IP is not assigned. Using node InternalIP as a fallback — this address may not be reachable outside the cluster. Verify that the node is accessible from your machine.',
                        ),
                    };
                }
            }
            return {
                kind: 'pending',
                reason: vscode.l10n.t(
                    'LoadBalancer external IP is not yet assigned and no NodePort fallback is available. The service may still be provisioning.',
                ),
            };
        }

        case 'NodePort': {
            if (service.nodePort) {
                const nodeAddressResult = await getFirstNodeAddress(coreApi);
                if (nodeAddressResult) {
                    const connectionString = buildConnectionString(
                        nodeAddressResult.address,
                        service.nodePort,
                        service,
                    );
                    if (nodeAddressResult.isExternal) {
                        return { kind: 'ready', connectionString };
                    }
                    return {
                        kind: 'ready',
                        connectionString,
                        warning: vscode.l10n.t(
                            'Using node InternalIP for NodePort service — this address may not be reachable outside the cluster. Ensure the node is accessible from your machine.',
                        ),
                    };
                }
            }
            return {
                kind: 'unreachable',
                reason: vscode.l10n.t(
                    'Could not determine a node address for NodePort service. Check that cluster nodes are accessible.',
                ),
            };
        }

        case 'ClusterIP': {
            return {
                kind: 'needsPortForward',
                serviceName: service.serviceName,
                namespace: service.namespace,
                remotePort: service.port,
                remotePortName: service.portName,
                suggestedLocalPort: service.port,
            };
        }

        case 'ExternalName': {
            // ExternalName services rely on external DNS — not commonly used for DocumentDB.
            // We don't have the raw V1Service object here, so we can't resolve the external name.
            return {
                kind: 'unreachable',
                reason: vscode.l10n.t(
                    'ExternalName services are not directly supported. Use the external DNS name to connect manually.',
                ),
            };
        }

        default:
            return {
                kind: 'unreachable',
                reason: vscode.l10n.t('Unsupported service type: {0}', service.type),
            };
    }
}

/**
 * Gets the best reachable address of a cluster node for NodePort/LoadBalancer resolution.
 *
 * Scans all nodes and returns the first ExternalIP found (preferred).
 * Falls back to the first InternalIP if no ExternalIP is available.
 * The `isExternal` flag lets callers distinguish the two cases to surface
 * appropriate reachability warnings.
 */
async function getFirstNodeAddress(coreApi: CoreV1Api): Promise<{ address: string; isExternal: boolean } | undefined> {
    try {
        const response = await coreApi.listNode();
        const nodes: V1Node[] = response.items;
        let firstInternalAddress: string | undefined;

        for (const node of nodes) {
            const addresses = node.status?.addresses;
            if (!addresses) continue;

            // Return immediately on the first ExternalIP found across any node.
            const externalIP = addresses.find((addr) => addr.type === 'ExternalIP');
            if (externalIP?.address) {
                return { address: externalIP.address, isExternal: true };
            }

            // Remember the first InternalIP as a fallback.
            if (!firstInternalAddress) {
                const internalIP = addresses.find((addr) => addr.type === 'InternalIP');
                if (internalIP?.address) {
                    firstInternalAddress = internalIP.address;
                }
            }
        }

        if (firstInternalAddress) {
            return { address: firstInternalAddress, isExternal: false };
        }
    } catch {
        // If we can't list nodes, we can't resolve NodePort addresses.
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
    const resources = await listDkoDocumentDbResources(kubeConfig, namespace);
    const matchingResource = resources.find((resource) => resource.serviceName === serviceName);
    if (!matchingResource) {
        return undefined;
    }

    try {
        const secret = await coreApi.readNamespacedSecret({ name: matchingResource.secretName, namespace });
        const data = secret.data;
        if (data?.username && data?.password) {
            const username = Buffer.from(data.username, 'base64').toString('utf-8');
            const password = Buffer.from(data.password, 'base64').toString('utf-8');
            return {
                username,
                password,
                connectionParams: buildDocumentDbConnectionParams(),
            };
        }
    } catch {
        // Secret not found or not readable
    }

    return undefined;
}

/**
 * Resolves credentials for a generic (non-DKO) service using a pre-validated
 * Kubernetes Secret name (typically from the
 * `documentdb.vscode.extension/credential-secret` annotation).
 *
 * Safety rules enforced here:
 * - Secret name is validated before the API call.
 * - Secret is always read from the same namespace as the service.
 * - Only `username` and `password` keys are decoded.
 * - Secret values are never logged.
 * - Returns `undefined` on any failure so that the UI can prompt later.
 *
 * @param coreApi A CoreV1Api client
 * @param namespace The namespace of the service (secret must be in the same namespace)
 * @param secretName The Kubernetes Secret name to read
 * @returns Decoded credentials, or `undefined` if unavailable
 */
export async function resolveGenericServiceCredentials(
    coreApi: CoreV1Api,
    namespace: string,
    secretName: string,
): Promise<{ username: string; password: string } | undefined> {
    if (!isValidKubernetesSecretName(secretName)) {
        return undefined;
    }

    try {
        const secret = await coreApi.readNamespacedSecret({ name: secretName, namespace });
        const data = secret.data;
        if (data?.username && data?.password) {
            const username = Buffer.from(data.username, 'base64').toString('utf-8');
            const password = Buffer.from(data.password, 'base64').toString('utf-8');
            return { username, password };
        }
    } catch {
        // Secret not found or not readable — return undefined so UI can prompt later.
    }

    return undefined;
}
