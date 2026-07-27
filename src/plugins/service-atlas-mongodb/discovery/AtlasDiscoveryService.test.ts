/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const globalStateBacking = new Map<string, unknown>();
const secretStorageBacking = new Map<string, string>();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((m, value, index) => m.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, ...args: string[]) =>
        args.reduce<string>((m, value, index) => m.replace(`{${String(index)}}`, value), message),
    ),
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            extension: { id: 'test-extension' },
            subscriptions: { push: (): void => {} },
            globalState: {
                get: <T>(key: string, defaultValue?: T): T | undefined => {
                    const value = globalStateBacking.has(key) ? (globalStateBacking.get(key) as T) : undefined;
                    return value === undefined ? defaultValue : value;
                },
                update: async (key: string, value: unknown): Promise<void> => {
                    if (value === undefined) {
                        globalStateBacking.delete(key);
                    } else {
                        globalStateBacking.set(key, value);
                    }
                },
                keys: () => Array.from(globalStateBacking.keys()),
            },
        },
        secretStorage: {
            get: async (key: string): Promise<string | undefined> =>
                secretStorageBacking.has(key) ? secretStorageBacking.get(key) : undefined,
            store: async (key: string, value: string): Promise<void> => {
                secretStorageBacking.set(key, value);
            },
            delete: async (key: string): Promise<void> => {
                secretStorageBacking.delete(key);
            },
            onDidChange: (): { dispose: () => void } => ({ dispose: (): void => {} }),
        },
        outputChannel: { trace: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), appendLine: jest.fn() },
    },
}));

const mockListOrganizations = jest.fn();
const mockListProjects = jest.fn();
const mockListClusters = jest.fn();

class AtlasApiErrorMock extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly detail?: string,
    ) {
        super(message);
        this.name = 'AtlasApiError';
    }
}

jest.mock('../api/AtlasApiClient', () => ({
    AtlasApiError: AtlasApiErrorMock,
    AtlasApiClient: class AtlasApiClientMock {
        constructor(
            public readonly session: unknown,
            public readonly refresher: unknown,
        ) {}
        listOrganizations = (...args: unknown[]) => mockListOrganizations(this.session, ...args) as unknown;
        listProjects = (...args: unknown[]) => mockListProjects(this.session, ...args) as unknown;
        listClusters = (...args: unknown[]) => mockListClusters(this.session, ...args) as unknown;
    },
}));

import { StorageService } from '../../../services/storageService';
import { AtlasCredentialSessionRegistry } from '../auth/AtlasCredentialSessionRegistry';
import {
    getAtlasCredential,
    resetAtlasCredentialStoreCache,
    upsertAtlasCredential,
} from '../credentials/atlasCredentialStore';
import { type AtlasCluster, type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasDiscoveryService, classifyAtlasError, resolveCredentialLabel } from './AtlasDiscoveryService';

function project(id: string, name: string, orgId = 'org-1'): AtlasProject {
    return { id, name, orgId, clusterCount: 1, created: '2026-01-01T00:00:00Z' };
}

function cluster(name: string, groupId: string): AtlasCluster {
    return {
        id: `cluster-${name}`,
        name,
        groupId,
        mongoDBVersion: '7.0',
        connectionStrings: { standardSrv: `mongodb+srv://${name}.example.invalid` },
        stateName: 'IDLE',
        clusterType: 'REPLICASET',
    };
}

async function addApiKeyCredential(publicKey: string): Promise<string> {
    const { record } = await upsertAtlasCredential({
        authMethod: 'apikey',
        publicKey,
        privateKey: `${publicKey}-private`,
    });
    return record.id;
}

function newService(): AtlasDiscoveryService {
    return new AtlasDiscoveryService(new AtlasCredentialSessionRegistry());
}

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    StorageService._resetForTests();
    resetAtlasCredentialStoreCache();
    mockListOrganizations.mockReset();
    mockListProjects.mockReset();
    mockListClusters.mockReset();
});

describe('AtlasDiscoveryService.listAll', () => {
    it('returns an empty snapshot when no credentials are stored', async () => {
        const snapshot = await newService().listAll();

        expect(snapshot.credentialsQueried).toBe(0);
        expect(snapshot.organizations).toEqual([]);
        expect(snapshot.credentialErrors).toEqual([]);
    });

    it('aggregates organizations and projects across credentials', async () => {
        const first = await addApiKeyCredential('aaaaaaaa');
        const second = await addApiKeyCredential('bbbbbbbb');

        mockListOrganizations.mockImplementation((session: { publicKey: string }) =>
            session.publicKey === 'aaaaaaaa'
                ? Promise.resolve([{ id: 'org-1', name: 'Acme Corp' }])
                : Promise.resolve([{ id: 'org-2', name: 'Beta Ltd' }]),
        );
        mockListProjects.mockImplementation((session: { publicKey: string }) =>
            session.publicKey === 'aaaaaaaa'
                ? Promise.resolve([project('p1', 'Payments', 'org-1')])
                : Promise.resolve([project('p2', 'Web', 'org-2')]),
        );

        const snapshot = await newService().listAll();

        expect(snapshot.credentialsQueried).toBe(2);
        expect(snapshot.organizations.map((o) => o.organization.name)).toEqual(['Acme Corp', 'Beta Ltd']);
        expect(snapshot.projects.map((p) => p.project.name)).toEqual(['Payments', 'Web']);
        expect(snapshot.organizations[0].ownerCredentialId).toBe(first);
        expect(snapshot.organizations[1].ownerCredentialId).toBe(second);
    });

    it('merges a project two credentials can both see, retaining both owners', async () => {
        const first = await addApiKeyCredential('aaaaaaaa');
        const second = await addApiKeyCredential('bbbbbbbb');

        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockImplementation((session: { publicKey: string }) =>
            session.publicKey === 'aaaaaaaa'
                ? Promise.resolve([project('shared', 'Shared'), project('only-a', 'Only A')])
                : Promise.resolve([project('shared', 'Shared'), project('only-b', 'Only B')]),
        );

        const snapshot = await newService().listAll();

        expect(snapshot.organizations).toHaveLength(1);
        expect(snapshot.organizations[0].credentialIds).toEqual([first, second]);
        expect(snapshot.projects.map((p) => p.project.name)).toEqual(['Only A', 'Only B', 'Shared']);

        const shared = snapshot.projects.find((p) => p.project.id === 'shared');
        expect(shared?.credentialIds).toEqual([first, second]);
        expect(shared?.ownerCredentialId).toBe(first);
    });

    it('keeps healthy data when one credential fails (allSettled, not all)', async () => {
        const healthy = await addApiKeyCredential('aaaaaaaa');
        const broken = await addApiKeyCredential('bbbbbbbb');

        mockListOrganizations.mockImplementation((session: { publicKey: string }) =>
            session.publicKey === 'aaaaaaaa'
                ? Promise.resolve([{ id: 'org-1', name: 'Acme Corp' }])
                : Promise.reject(new AtlasApiErrorMock('Credentials rejected', 401)),
        );
        mockListProjects.mockImplementation((session: { publicKey: string }) =>
            session.publicKey === 'aaaaaaaa'
                ? Promise.resolve([project('p1', 'Payments')])
                : Promise.reject(new AtlasApiErrorMock('Credentials rejected', 401)),
        );

        const snapshot = await newService().listAll();

        expect(snapshot.projects.map((p) => p.project.name)).toEqual(['Payments']);
        expect(snapshot.organizations[0].ownerCredentialId).toBe(healthy);
        expect(snapshot.credentialErrors).toHaveLength(1);
        expect(snapshot.credentialErrors[0]).toMatchObject({
            credentialId: broken,
            kind: 'auth',
            status: 401,
            retryable: true,
        });
    });

    it('reports a healthy empty result as emptiness, not failure', async () => {
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValue([]);

        const snapshot = await newService().listAll();

        expect(snapshot.projects).toEqual([]);
        expect(snapshot.credentialErrors).toEqual([]);
        expect(snapshot.organizations).toHaveLength(1);
    });

    it('scopes a failing cluster list to its project and keeps the credential healthy', async () => {
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValue([project('p1', 'Payments'), project('p2', 'Web')]);
        mockListClusters.mockImplementation((_session: unknown, projectId: string) =>
            projectId === 'p1'
                ? Promise.resolve([cluster('payments-prod', 'p1')])
                : Promise.reject(new AtlasApiErrorMock('Access denied', 403)),
        );

        const snapshot = await newService().listAll({ includeClusters: true });

        expect(snapshot.clusters.map((c) => c.cluster.name)).toEqual(['payments-prod']);
        expect(snapshot.credentialErrors).toEqual([]);
        expect(snapshot.projectErrors).toHaveLength(1);
        expect(snapshot.projectErrors[0]).toMatchObject({ projectId: 'p2', kind: 'forbidden', status: 403 });
    });

    it('deduplicates clusters visible through two credentials', async () => {
        const first = await addApiKeyCredential('aaaaaaaa');
        const second = await addApiKeyCredential('bbbbbbbb');

        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValue([project('p1', 'Payments')]);
        mockListClusters.mockResolvedValue([cluster('payments-prod', 'p1')]);

        const snapshot = await newService().listAll({ includeClusters: true });

        expect(snapshot.clusters).toHaveLength(1);
        expect(snapshot.clusters[0].credentialIds).toEqual([first, second]);
        expect(snapshot.clusters[0].ownerCredentialId).toBe(first);
        expect(snapshot.clusters[0].projectName).toBe('Payments');
    });

    it('caches the snapshot so a burst of passive reads never re-queries a failing credential', async () => {
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockRejectedValue(new AtlasApiErrorMock('Credentials rejected', 401));
        mockListProjects.mockRejectedValue(new AtlasApiErrorMock('Credentials rejected', 401));

        const service = newService();
        await service.listAll();
        await service.listAll();

        expect(mockListProjects).toHaveBeenCalledTimes(1);

        await service.listAll({ forceRefresh: true });
        expect(mockListProjects).toHaveBeenCalledTimes(2);
    });

    it('expires the cached snapshot so passive reads cannot serve an indefinitely stale answer', async () => {
        // Regression guard for the invalidate-only cache: every node type had to remember to
        // invalidate, and the one that forgot showed an outdated tree forever.
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValue([]);

        const service = newService();
        await service.listAll();
        await service.listAll();
        expect(mockListProjects).toHaveBeenCalledTimes(1);

        const realNow = Date.now;
        try {
            Date.now = () => realNow() + 60_000;
            await service.listAll();
        } finally {
            Date.now = realNow;
        }

        expect(mockListProjects).toHaveBeenCalledTimes(2);
    });

    it('re-derives every session on refreshAll so an Atlas role change is picked up', async () => {
        // Regression: a Service Account access token carries the roles it was minted with and is
        // cached for its lifetime. Reusing it after the user widened the account's roles kept
        // reporting the old, empty scope until the token expired.
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([project('p1', 'Payments')]);

        const registry = new AtlasCredentialSessionRegistry();
        const refreshSession = jest.spyOn(registry, 'refreshSession');
        const service = new AtlasDiscoveryService(registry);

        const before = await service.listAll();
        expect(before.projects).toEqual([]);
        expect(refreshSession).not.toHaveBeenCalled();

        const after = await service.refreshAll();

        expect(refreshSession).toHaveBeenCalledTimes(1);
        expect(after.projects.map((p) => p.project.name)).toEqual(['Payments']);
    });

    it('re-queries when clusters are requested but the cached snapshot has none', async () => {
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValue([project('p1', 'Payments')]);
        mockListClusters.mockResolvedValue([cluster('payments-prod', 'p1')]);

        const service = newService();
        const withoutClusters = await service.listAll();
        expect(withoutClusters.clusters).toEqual([]);
        expect(mockListClusters).not.toHaveBeenCalled();

        const withClusters = await service.listAll({ includeClusters: true });
        expect(withClusters.clusters).toHaveLength(1);
    });

    it('forwards the abort signal to the API client', async () => {
        await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([]);
        mockListProjects.mockResolvedValue([]);

        const controller = new AbortController();
        await newService().listAll({ signal: controller.signal });

        expect(mockListProjects).toHaveBeenCalledWith(expect.anything(), controller.signal);
    });

    it('caches the organization name on the credential for later attribution', async () => {
        const credentialId = await addApiKeyCredential('aaaaaaaa');
        mockListOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Acme Corp' }]);
        mockListProjects.mockResolvedValue([]);

        await newService().listAll();

        const record = await getAtlasCredential(credentialId);
        expect(record?.orgId).toBe('org-1');
        expect(record?.orgName).toBe('Acme Corp');
    });

    it('surfaces a rejected credential as an auth error when no session can be built', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });

        const registry = new AtlasCredentialSessionRegistry();
        jest.spyOn(registry, 'getSession').mockResolvedValue(undefined);

        const snapshot = await new AtlasDiscoveryService(registry).listAll();

        expect(snapshot.credentialErrors).toHaveLength(1);
        expect(snapshot.credentialErrors[0]).toMatchObject({ credentialId: record.id, kind: 'auth', retryable: true });
        expect(mockListProjects).not.toHaveBeenCalled();
    });
});

describe('resolveCredentialLabel', () => {
    const base = { id: 'record-1', authMethod: 'apikey' as const, order: 0 };

    it('prefers the user-supplied label', () => {
        expect(resolveCredentialLabel({ ...base, label: 'Work key', orgName: 'Acme' })).toBe('Work key');
    });

    it('falls back to the cached organization name', () => {
        expect(resolveCredentialLabel({ ...base, orgName: 'Acme Corp' })).toBe('Acme Corp');
    });

    it('falls back to the non-secret identity hint', () => {
        expect(resolveCredentialLabel({ ...base, identityHint: 'abcdefgh' })).toBe('abcdefgh…');
    });

    it('falls back to the record id as a last resort', () => {
        expect(resolveCredentialLabel(base)).toBe('record-1');
    });
});

describe('classifyAtlasError', () => {
    it.each([
        [401, 'auth'],
        [403, 'forbidden'],
        [429, 'rateLimited'],
        [500, 'other'],
    ])('maps status %s to kind %s', (status, kind) => {
        expect(classifyAtlasError(new AtlasApiErrorMock('boom', status)).kind).toBe(kind);
    });

    it('maps a fetch failure to a network error', () => {
        expect(classifyAtlasError(new TypeError('fetch failed')).kind).toBe('network');
    });
});
