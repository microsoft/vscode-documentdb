/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A pluggable hook that makes a saved connection reachable *before* the extension tries to
 * connect to it.
 *
 * Some connection sources are not directly reachable from the client machine and need a
 * preparation step first. The first concrete case is Kubernetes ClusterIP targets, which are
 * only reachable through a local port-forward tunnel; the saved `127.0.0.1:<localPort>` string
 * only works once that tunnel has been (re-)established. Rather than teach the generic
 * Connections-view cluster node about Kubernetes, each source registers a provider here and the
 * cluster node simply asks "does anything need to make this connection reachable first?".
 *
 * Future sources (SSH tunnels, Azure Bastion, a cloud proxy, …) can plug in the same way without
 * touching the generic node.
 *
 * @see {@link ConnectionReachabilityService}
 */
export interface ConnectionReachabilityProvider {
    /**
     * Stable identifier for the provider. Internal only; not shown to the user.
     */
    readonly id: string;

    /**
     * Returns true when this provider is responsible for the given connection, based on the
     * connection's stored properties (e.g. the presence of port-forward metadata). Implementations
     * must be cheap and side-effect free — it runs on every connect attempt.
     */
    appliesTo(connectionProperties: Record<string, unknown> | undefined): boolean;

    /**
     * Performs whatever is needed so the connection becomes reachable (e.g. (re)establish a
     * port-forward tunnel). Only called when {@link appliesTo} returned true. May be a no-op if
     * the connection is already reachable. Heavy, source-specific dependencies should be loaded
     * lazily inside this method so registering the provider stays cheap.
     */
    ensureReachable(connectionProperties: Record<string, unknown>): Promise<void>;
}

/**
 * Registry of {@link ConnectionReachabilityProvider}s.
 *
 * Mirrors the singleton-registry pattern used by `DiscoveryService` and `MigrationService`:
 * providers are registered once at activation, and the generic Connections-view cluster node
 * ({@link import('../tree/connections-view/DocumentDBClusterItem').DocumentDBClusterItem}) calls
 * {@link ensureReachable} before each connect without knowing which sources exist.
 *
 * This class cannot be instantiated directly — use the exported {@link ConnectionReachabilityService}
 * singleton instead.
 */
class ConnectionReachabilityServiceImpl {
    private readonly providers: ConnectionReachabilityProvider[] = [];

    /**
     * Registers a reachability provider. A provider with an id that is already registered replaces
     * the existing one (last registration wins), which keeps re-activation idempotent.
     */
    public registerProvider(provider: ConnectionReachabilityProvider): void {
        const existingIndex = this.providers.findIndex((candidate) => candidate.id === provider.id);
        if (existingIndex >= 0) {
            this.providers[existingIndex] = provider;
        } else {
            this.providers.push(provider);
        }
    }

    /**
     * Runs every applicable provider's preparation step for the given connection properties.
     *
     * Providers run sequentially in registration order so a failure surfaces to the caller (the
     * connect flow), where it is reported via the existing telemetry/error handling. Connections
     * with no applicable provider resolve immediately.
     */
    public async ensureReachable(connectionProperties: Record<string, unknown> | undefined): Promise<void> {
        if (!connectionProperties) {
            return;
        }

        for (const provider of this.providers) {
            if (provider.appliesTo(connectionProperties)) {
                await provider.ensureReachable(connectionProperties);
            }
        }
    }

    /**
     * Test-only: clears all registered providers so suites start from a known state.
     */
    public resetForTests(): void {
        this.providers.length = 0;
    }
}

export const ConnectionReachabilityService = new ConnectionReachabilityServiceImpl();
