/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Single aggregation surface for MongoDB Atlas discovery.
 *
 * `listAll()` fans out across every stored credential and returns healthy data **and** typed
 * per-credential errors together. It never throws for an individual credential: one dead
 * credential degrades that credential's branch only, instead of blanking the whole view. This is
 * the concrete difference from the Azure prior art in this repository, which uses `Promise.all`
 * and collapses to an empty list when any account fails.
 *
 * Resources are merged by their Atlas IDs (`orgId` / `projectId` / cluster id) so two credentials
 * that can see the same organization or project produce one node, and each merged node remembers
 * every credential that can reach it plus a healthy owner for follow-up requests.
 */

import * as l10n from '@vscode/l10n';
import { createConcurrencyLimiter } from '../../../utils/concurrencyLimiter';
import { AtlasApiClient, AtlasApiError } from '../api/AtlasApiClient';
import { atlasTrace, describeCredential, formatMs } from '../atlasTrace';
import { AtlasCredentialSessionRegistry } from '../auth/AtlasCredentialSessionRegistry';
import {
    getAtlasCredential,
    readAtlasCredentials,
    updateAtlasCredentialMetadata,
    type AtlasCredentialRecord,
} from '../credentials/atlasCredentialStore';
import { type AtlasCluster, type AtlasOrganization, type AtlasProject } from '../models/AtlasProjectModel';

/**
 * Why a credential (or one project below it) could not be read. Drives the wording and the
 * recovery affordance the tree offers.
 */
export type AtlasErrorKind = 'auth' | 'forbidden' | 'rateLimited' | 'network' | 'other';

/** A whole credential failed. Its healthy peers are unaffected. */
export interface AtlasCredentialError {
    readonly credentialId: string;
    readonly label: string;
    readonly kind: AtlasErrorKind;
    readonly status?: number;
    readonly message: string;
    /** `false` only when retrying cannot possibly help (for example the credential was removed). */
    readonly retryable: boolean;
}

/** A single project's cluster list failed while the owning credential stayed healthy. */
export interface AtlasProjectError extends AtlasCredentialError {
    readonly projectId: string;
    readonly projectName: string;
}

/** Common shape for every merged resource: who can see it, and who acts on it. */
interface MergedResource {
    /** Every credential that can currently reach this resource. */
    readonly credentialIds: string[];
    /** The credential used for follow-up requests. Always one of {@link credentialIds}. */
    readonly ownerCredentialId: string;
}

export interface AtlasOrganizationEntry extends MergedResource {
    readonly organization: AtlasOrganization;
}

export interface AtlasProjectEntry extends MergedResource {
    readonly project: AtlasProject;
}

export interface AtlasClusterEntry extends MergedResource {
    readonly cluster: AtlasCluster;
    readonly projectId: string;
    readonly projectName: string;
    readonly orgId: string;
}

/**
 * Everything the tree, the list view, and the add-connection wizard need, in one value.
 */
export interface AtlasDiscoverySnapshot {
    readonly organizations: AtlasOrganizationEntry[];
    readonly projects: AtlasProjectEntry[];
    readonly clusters: AtlasClusterEntry[];
    readonly credentialErrors: AtlasCredentialError[];
    readonly projectErrors: AtlasProjectError[];
    /** How many credentials were queried for this snapshot. */
    readonly credentialsQueried: number;
    /** Whether cluster data was requested; `false` snapshots carry an empty `clusters` array. */
    readonly clustersIncluded: boolean;
}

export interface ListAllOptions {
    /**
     * Fetch clusters for every visible project. Off by default: Tree mode only needs
     * organizations and projects up front and loads clusters when a project is expanded, so the
     * default keeps the first paint to two requests per credential.
     */
    readonly includeClusters?: boolean;
    /** Ignore the cached snapshot and re-query every credential. */
    readonly forceRefresh?: boolean;
    /**
     * Re-derive every credential's session before querying, discarding cached Service Account
     * access tokens. Needed after the user changes roles in Atlas, because a token carries the
     * scope it was minted with. Prefer {@link AtlasDiscoveryService.refreshAll}.
     */
    readonly forceFreshSessions?: boolean;
    readonly signal?: AbortSignal;
}

/** Bounded fan-out across credentials. Independent credentials use independent rate buckets. */
const CREDENTIAL_CONCURRENCY = 4;

/** Bounded fan-out across a single credential's projects when cluster data is requested. */
const PROJECT_CONCURRENCY = 5;

/**
 * How long a snapshot may be served to passive tree expansion before it is re-fetched.
 *
 * The cache exists to stop a single interaction burst (expand the root, then expand three
 * organizations) from re-running the fleet query four times, and to keep `ownerCredentialId`
 * coherent between an organization node and its project children. Neither of those needs the
 * cache to survive longer than the burst itself.
 *
 * Making it an invalidate-only cache is what produced stale-tree bugs: every node type had to
 * remember to invalidate, and the one that forgot showed a permanently outdated answer. A short
 * window removes that whole class of bug at the cost of a couple of fast requests, which is the
 * right trade for an API with no timeouts and a 1-to-2 credential happy path.
 *
 * It cannot replace explicit invalidation for permissions changes: a Service Account access token
 * carries the scope it was minted with and lives for about an hour, so an explicit refresh still
 * has to re-derive sessions. See {@link AtlasDiscoveryService.refreshAll}.
 */
const SNAPSHOT_TTL_MS = 30_000;

/**
 * Resolves the user-facing label for a credential: an explicit user label wins, then the cached
 * organization name, then a non-secret identity hint, then the record ID.
 */
export function resolveCredentialLabel(record: AtlasCredentialRecord): string {
    if (record.label && record.label.trim().length > 0) {
        return record.label.trim();
    }
    if (record.orgName && record.orgName.trim().length > 0) {
        return record.orgName.trim();
    }
    if (record.identityHint && record.identityHint.length > 0) {
        return `${record.identityHint}…`;
    }
    return record.id;
}

/**
 * Classifies a thrown error into the taxonomy the UX reacts to.
 */
export function classifyAtlasError(error: unknown): { kind: AtlasErrorKind; status?: number; message: string } {
    if (error instanceof AtlasApiError) {
        switch (error.statusCode) {
            case 401:
                return { kind: 'auth', status: 401, message: error.message };
            case 403:
                return { kind: 'forbidden', status: 403, message: error.message };
            case 429:
                return { kind: 'rateLimited', status: 429, message: error.message };
            default:
                return { kind: 'other', status: error.statusCode, message: error.message };
        }
    }

    const message = error instanceof Error ? error.message : String(error);
    // `fetch` surfaces connectivity problems as a TypeError with a generic message; treat any
    // non-API failure that mentions the network as a connectivity problem so the UX can say so.
    if (error instanceof TypeError || /network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
        return { kind: 'network', message };
    }

    return { kind: 'other', message };
}

/** Result of querying one credential, before merging. */
export interface CredentialResult {
    readonly record: AtlasCredentialRecord;
    readonly organizations: AtlasOrganization[];
    readonly projects: AtlasProject[];
    readonly clusters: Array<{ project: AtlasProject; cluster: AtlasCluster }>;
    readonly credentialError?: AtlasCredentialError;
    readonly projectErrors: AtlasProjectError[];
}

/**
 * Aggregates discovery data across the whole credential fleet.
 */
export class AtlasDiscoveryService {
    private snapshot: AtlasDiscoverySnapshot | undefined;
    private snapshotTakenAt = 0;
    private lastResults: CredentialResult[] | undefined;
    private inflight: Promise<AtlasDiscoverySnapshot> | undefined;

    constructor(private readonly sessions: AtlasCredentialSessionRegistry = new AtlasCredentialSessionRegistry()) {}

    /** The session registry backing this service, so callers can build their own scoped clients. */
    public get sessionRegistry(): AtlasCredentialSessionRegistry {
        return this.sessions;
    }

    /**
     * Returns everything visible across every stored credential. Never rejects because of a
     * single credential; per-credential failures come back in `credentialErrors`.
     *
     * The cached snapshot is reused on passive tree expansion, but only for {@link SNAPSHOT_TTL_MS},
     * so navigating around cannot keep serving an answer the user has since fixed in Atlas. An
     * explicit refresh passes `forceRefresh` and does not wait for the window to close.
     */
    public async listAll(options: ListAllOptions = {}): Promise<AtlasDiscoverySnapshot> {
        const needsClusters = options.includeClusters === true;

        if (!options.forceRefresh && this.snapshot && (!needsClusters || this.snapshot.clustersIncluded)) {
            const age = Date.now() - this.snapshotTakenAt;
            if (age < SNAPSHOT_TTL_MS) {
                atlasTrace(
                    `listAll: serving the cached snapshot, ${String(age)}ms old (${String(this.snapshot.organizations.length)} org(s), ${String(this.snapshot.projects.length)} project(s), ${String(this.snapshot.credentialErrors.length)} credential error(s))`,
                );
                return this.snapshot;
            }

            atlasTrace(`listAll: the cached snapshot is ${String(age)}ms old and has expired, re-querying`);
        }

        if (this.inflight && !options.forceRefresh) {
            atlasTrace('listAll: joining the in-flight discovery pass');
            return this.inflight;
        }

        const work = this.buildSnapshot(needsClusters, options.signal, options.forceFreshSessions === true).finally(
            () => {
                this.inflight = undefined;
            },
        );
        this.inflight = work;
        return work;
    }

    /**
     * Re-attempts the whole fleet from scratch: drops the cached snapshot **and** re-derives every
     * credential's session before querying.
     *
     * Re-deriving the session is the part that matters after a permissions change in Atlas. A
     * Service Account access token is minted with the roles the account had at that moment and is
     * cached for its lifetime, so reusing it would keep reporting the old scope for up to an hour
     * after the user grants a new role. An explicit refresh is a deliberate user action, so paying
     * for one token mint per credential is the right trade.
     */
    public async refreshAll(
        options: { includeClusters?: boolean; signal?: AbortSignal } = {},
    ): Promise<AtlasDiscoverySnapshot> {
        atlasTrace('refreshAll: dropping the cached snapshot and every cached session');
        this.invalidate();
        return this.listAll({
            ...options,
            forceRefresh: true,
            forceFreshSessions: true,
        });
    }

    /**
     * Drops the cached snapshot so the next {@link listAll} re-queries every credential.
     */
    public invalidate(): void {
        this.snapshot = undefined;
        this.snapshotTakenAt = 0;
        this.lastResults = undefined;
        this.inflight = undefined;
    }

    /**
     * Re-attempts a single credential and folds the result back into the cached snapshot.
     *
     * Retrying one credential must not hammer its healthy peers, which is why the
     * credential-management "Retry" action calls this instead of a full refresh: only the selected
     * credential issues requests, and every other credential's last known result is reused.
     *
     * Like {@link refreshAll}, it re-derives the session rather than reusing the cached one. The
     * user's actual flow is to open the credential manager, fix something in the Atlas web UI, and
     * come back to press Retry, and a Service Account access token carries the roles it was minted
     * with, so reusing it would report the pre-change answer.
     *
     * Falls back to a full refresh when there is no cached snapshot to fold into.
     */
    public async retryCredential(credentialId: string, signal?: AbortSignal): Promise<AtlasDiscoverySnapshot> {
        const previous = this.lastResults;
        const snapshot = this.snapshot;
        if (!previous || !snapshot) {
            this.sessions.invalidate(credentialId);
            this.invalidate();
            return this.listAll({ forceRefresh: true, forceFreshSessions: true, signal });
        }

        const record = await getAtlasCredential(credentialId);
        if (!record) {
            // The credential is gone; simply drop its contribution.
            this.sessions.invalidate(credentialId);
            const remaining = previous.filter((result) => result.record.id !== credentialId);
            return this.commit(remaining, snapshot.clustersIncluded);
        }

        const refreshed = await this.queryCredential(record, snapshot.clustersIncluded, signal, true);
        const merged = previous.some((result) => result.record.id === credentialId)
            ? previous.map((result) => (result.record.id === credentialId ? refreshed : result))
            : [...previous, refreshed];

        return this.commit(merged, snapshot.clustersIncluded);
    }

    /** Forgets every cached session and snapshot. Used after "sign out of all". */
    public reset(): void {
        this.sessions.invalidateAll();
        this.invalidate();
    }

    private async buildSnapshot(
        includeClusters: boolean,
        signal?: AbortSignal,
        forceFreshSessions = false,
    ): Promise<AtlasDiscoverySnapshot> {
        const credentials = await readAtlasCredentials();
        const limit = createConcurrencyLimiter({ concurrency: CREDENTIAL_CONCURRENCY });
        const startedAt = Date.now();

        atlasTrace(
            `listAll: querying ${String(credentials.length)} credential(s), clusters ${includeClusters ? 'included' : 'deferred to project expand'}${forceFreshSessions ? ', forcing fresh sessions' : ''}`,
        );

        // `allSettled`, not `all`: a rejected credential must not discard its healthy peers.
        const settled = await Promise.allSettled(
            credentials.map((record) =>
                limit(() => this.queryCredential(record, includeClusters, signal, forceFreshSessions)),
            ),
        );

        const results: CredentialResult[] = [];
        for (let index = 0; index < settled.length; index++) {
            const outcome = settled[index];
            if (outcome.status === 'fulfilled') {
                results.push(outcome.value);
                continue;
            }

            // Defensive: queryCredential already converts failures into descriptors. A rejection
            // here means an unexpected bug, and it still must not take the fleet down.
            const record = credentials[index];
            const classified = classifyAtlasError(outcome.reason);
            results.push({
                record,
                organizations: [],
                projects: [],
                clusters: [],
                projectErrors: [],
                credentialError: {
                    credentialId: record.id,
                    label: resolveCredentialLabel(record),
                    kind: classified.kind,
                    status: classified.status,
                    message: classified.message,
                    retryable: true,
                },
            });
        }

        const snapshot = mergeResults(results, includeClusters);
        this.snapshot = snapshot;
        this.snapshotTakenAt = Date.now();
        this.lastResults = results;

        atlasTrace(
            `listAll: done in ${formatMs(startedAt)} - ${String(snapshot.organizations.length)} org(s), ${String(snapshot.projects.length)} project(s), ${String(snapshot.clusters.length)} cluster(s), ${String(snapshot.credentialErrors.length)} credential error(s), ${String(snapshot.projectErrors.length)} project error(s)`,
        );

        return snapshot;
    }

    /** Stores a set of per-credential results as the new cached snapshot. */
    private commit(results: CredentialResult[], clustersIncluded: boolean): AtlasDiscoverySnapshot {
        const snapshot = mergeResults(results, clustersIncluded);
        this.snapshot = snapshot;
        this.snapshotTakenAt = Date.now();
        this.lastResults = results;
        return snapshot;
    }

    private async queryCredential(
        record: AtlasCredentialRecord,
        includeClusters: boolean,
        signal?: AbortSignal,
        forceFreshSession = false,
    ): Promise<CredentialResult> {
        const label = resolveCredentialLabel(record);
        const owner = describeCredential(label, record.id);
        const session = forceFreshSession
            ? await this.sessions.refreshSession(record.id)
            : await this.sessions.getSession(record.id);

        if (!session) {
            atlasTrace(`${owner}: no usable session, reporting an auth error for this credential only`);
            return {
                record,
                organizations: [],
                projects: [],
                clusters: [],
                projectErrors: [],
                credentialError: {
                    credentialId: record.id,
                    label,
                    kind: 'auth',
                    message: l10n.t('Stored credentials were rejected. Update them to continue.'),
                    retryable: true,
                },
            };
        }

        const client = new AtlasApiClient(session, this.sessions.refresherFor(record.id), owner);

        let organizations: AtlasOrganization[] = [];
        let projects: AtlasProject[] = [];

        // Different endpoints with independent scopes, so they are safe to run together. The
        // Azure "sequential or you get wrong data" caveat applies to tenants vs subscriptions
        // inside one provider, not to these two Atlas calls.
        //
        // `allSettled`, not `all`: `all` rejects as soon as the first request fails and leaves the
        // other one running, so its failure lands in the log after the credential has already been
        // recorded as failed and reads like a second, racing pass. Waiting for both also makes the
        // reported error deterministic instead of whichever request happened to lose the race.
        const [orgOutcome, projectOutcome] = await Promise.allSettled([
            client.listOrganizations(signal),
            client.listProjects(signal),
        ]);

        const failure = [orgOutcome, projectOutcome].find((outcome) => outcome.status === 'rejected');
        if (failure) {
            const classified = classifyAtlasError(failure.reason);
            atlasTrace(
                `${owner}: discovery failed (${classified.kind}${classified.status ? ` ${String(classified.status)}` : ''}) - ${classified.message}`,
            );
            return {
                record,
                organizations: [],
                projects: [],
                clusters: [],
                projectErrors: [],
                credentialError: {
                    credentialId: record.id,
                    label,
                    kind: classified.kind,
                    status: classified.status,
                    message: classified.message,
                    retryable: true,
                },
            };
        }

        organizations = orgOutcome.status === 'fulfilled' ? orgOutcome.value : [];
        projects = projectOutcome.status === 'fulfilled' ? projectOutcome.value : [];

        atlasTrace(
            `${owner}: sees ${String(organizations.length)} organization(s) and ${String(projects.length)} project(s)`,
        );
        if (projects.length === 0) {
            // A healthy 200 with an empty list is an authoritative answer, not a failure. Saying so
            // explicitly makes the difference from a 401/403 obvious in the log.
            atlasTrace(
                `${owner}: Atlas answered with an empty project list; this is a permissions/scope result, not an error`,
            );
        }

        await this.cacheOrganizationMetadata(record, organizations);

        if (!includeClusters || projects.length === 0) {
            return { record, organizations, projects, clusters: [], projectErrors: [] };
        }

        const projectLimit = createConcurrencyLimiter({ concurrency: PROJECT_CONCURRENCY });
        const clusters: Array<{ project: AtlasProject; cluster: AtlasCluster }> = [];
        const projectErrors: AtlasProjectError[] = [];

        const clusterOutcomes = await Promise.allSettled(
            projects.map((project) =>
                projectLimit(async () => ({ project, clusters: await client.listClusters(project.id, signal) })),
            ),
        );

        for (let index = 0; index < clusterOutcomes.length; index++) {
            const outcome = clusterOutcomes[index];
            const project = projects[index];
            if (outcome.status === 'fulfilled') {
                for (const cluster of outcome.value.clusters) {
                    clusters.push({ project, cluster });
                }
                continue;
            }

            const classified = classifyAtlasError(outcome.reason);
            atlasTrace(
                `${owner}: cluster list for project "${project.name}" failed (${classified.kind}) - ${classified.message}`,
            );
            projectErrors.push({
                credentialId: record.id,
                label,
                projectId: project.id,
                projectName: project.name,
                kind: classified.kind,
                status: classified.status,
                message: classified.message,
                retryable: true,
            });
        }

        atlasTrace(
            `${owner}: found ${String(clusters.length)} cluster(s) across ${String(projects.length)} project(s)`,
        );

        return { record, organizations, projects, clusters, projectErrors };
    }

    /**
     * Caches the organization name for a credential that resolves to exactly one organization, so
     * a failed credential can still be attributed to a readable organization name later.
     */
    private async cacheOrganizationMetadata(
        record: AtlasCredentialRecord,
        organizations: AtlasOrganization[],
    ): Promise<void> {
        if (organizations.length !== 1) {
            return;
        }
        const [organization] = organizations;
        if (record.orgId === organization.id && record.orgName === organization.name) {
            return;
        }
        try {
            await updateAtlasCredentialMetadata(record.id, { orgId: organization.id, orgName: organization.name });
        } catch {
            // Caching the display name is best-effort; discovery must not fail because of it.
        }
    }
}

/**
 * Merges per-credential results into one deduplicated snapshot.
 *
 * Exported for focused testing of the merge contract without needing the network.
 */
export function mergeResults(results: readonly CredentialResult[], clustersIncluded: boolean): AtlasDiscoverySnapshot {
    const organizations = new Map<string, { organization: AtlasOrganization; credentialIds: string[] }>();
    const projects = new Map<string, { project: AtlasProject; credentialIds: string[] }>();
    const clusters = new Map<
        string,
        { cluster: AtlasCluster; project: AtlasProject; credentialIds: string[]; orgId: string }
    >();
    const credentialErrors: AtlasCredentialError[] = [];
    const projectErrors: AtlasProjectError[] = [];

    for (const result of results) {
        if (result.credentialError) {
            credentialErrors.push(result.credentialError);
        }
        projectErrors.push(...result.projectErrors);

        for (const organization of result.organizations) {
            const entry = organizations.get(organization.id);
            if (entry) {
                if (!entry.credentialIds.includes(result.record.id)) {
                    entry.credentialIds.push(result.record.id);
                }
            } else {
                organizations.set(organization.id, { organization, credentialIds: [result.record.id] });
            }
        }

        for (const project of result.projects) {
            const entry = projects.get(project.id);
            if (entry) {
                if (!entry.credentialIds.includes(result.record.id)) {
                    entry.credentialIds.push(result.record.id);
                }
            } else {
                projects.set(project.id, { project, credentialIds: [result.record.id] });
            }
        }

        for (const { project, cluster } of result.clusters) {
            const key = clusterKey(project.id, cluster);
            const entry = clusters.get(key);
            if (entry) {
                if (!entry.credentialIds.includes(result.record.id)) {
                    entry.credentialIds.push(result.record.id);
                }
            } else {
                clusters.set(key, { cluster, project, credentialIds: [result.record.id], orgId: project.orgId });
            }
        }
    }

    return {
        organizations: [...organizations.values()]
            .map(({ organization, credentialIds }) => ({
                organization,
                credentialIds,
                ownerCredentialId: credentialIds[0],
            }))
            .sort((a, b) => a.organization.name.localeCompare(b.organization.name, undefined, { numeric: true })),
        projects: [...projects.values()]
            .map(({ project, credentialIds }) => ({ project, credentialIds, ownerCredentialId: credentialIds[0] }))
            .sort((a, b) => a.project.name.localeCompare(b.project.name, undefined, { numeric: true })),
        clusters: [...clusters.values()]
            .map(({ cluster, project, credentialIds, orgId }) => ({
                cluster,
                projectId: project.id,
                projectName: project.name,
                orgId,
                credentialIds,
                ownerCredentialId: credentialIds[0],
            }))
            .sort((a, b) => a.cluster.name.localeCompare(b.cluster.name, undefined, { numeric: true })),
        credentialErrors,
        projectErrors,
        credentialsQueried: results.length,
        clustersIncluded,
    };
}

/**
 * Clusters are keyed by project id + cluster name. Atlas cluster names are unique inside a
 * project, and the `id` field is absent on some cluster shapes, so the name is the reliable key.
 */
function clusterKey(projectId: string, cluster: AtlasCluster): string {
    return `${projectId}/${cluster.name}`;
}

/** Convenience predicate for the UX: does this snapshot need a recovery action? */
export function snapshotHasFailures(snapshot: AtlasDiscoverySnapshot): boolean {
    return snapshot.credentialErrors.length > 0 || snapshot.projectErrors.length > 0;
}
