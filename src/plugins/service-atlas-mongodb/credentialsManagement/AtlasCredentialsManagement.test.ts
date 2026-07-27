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
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ProgressLocation: { Notification: 15 },
    Uri: { parse: jest.fn((value: string) => ({ toString: () => value })) },
    env: { openExternal: jest.fn().mockResolvedValue(true) },
    window: {
        showInformationMessage: jest.fn(),
        withProgress: jest.fn(async (_options: unknown, task: () => Promise<unknown>) => task()),
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

class UserCancelledErrorMock extends Error {}
class GoBackErrorMock extends Error {}

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    UserCancelledError: UserCancelledErrorMock,
    GoBackError: GoBackErrorMock,
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

const mockOpenWebview = jest.fn();
jest.mock('../../../webviews/documentdb/atlasCredentials/atlasCredentialsController', () => ({
    openAtlasCredentialsWebview: (...args: unknown[]) => mockOpenWebview(...args) as unknown,
}));

import * as vscode from 'vscode';
import { StorageService } from '../../../services/storageService';
import { buildAtlasAccessUrl } from '../atlasDeepLinks';
import {
    readAtlasCredentials,
    resetAtlasCredentialStoreCache,
    upsertAtlasCredential,
    type AtlasCredentialRecord,
} from '../credentials/atlasCredentialStore';
import { type AtlasDiscoveryService, type AtlasDiscoverySnapshot } from '../discovery/AtlasDiscoveryService';
import { AtlasCredentialActionStep } from './AtlasCredentialActionStep';
import { type AtlasCredentialsManagementWizardContext } from './AtlasCredentialsManagementWizardContext';
import { SelectAtlasCredentialStep } from './SelectAtlasCredentialStep';

interface QuickPickLike {
    label?: string;
    [key: string]: unknown;
}

function emptySnapshot(overrides: Partial<AtlasDiscoverySnapshot> = {}): AtlasDiscoverySnapshot {
    return {
        organizations: [],
        projects: [],
        clusters: [],
        credentialErrors: [],
        projectErrors: [],
        credentialsQueried: 0,
        clustersIncluded: false,
        ...overrides,
    };
}

function buildContext(
    pick: (items: QuickPickLike[]) => QuickPickLike,
    snapshot: AtlasDiscoverySnapshot = emptySnapshot(),
): AtlasCredentialsManagementWizardContext & {
    discoveryService: jest.Mocked<
        Pick<AtlasDiscoveryService, 'listAll' | 'refreshAll' | 'invalidate' | 'reset' | 'retryCredential'>
    >;
} {
    const sessionRegistry = { invalidate: jest.fn(), invalidateAll: jest.fn() };
    const discoveryService = {
        listAll: jest.fn().mockResolvedValue(snapshot),
        refreshAll: jest.fn().mockResolvedValue(snapshot),
        invalidate: jest.fn(),
        reset: jest.fn(),
        retryCredential: jest.fn().mockResolvedValue(snapshot),
        sessionRegistry,
    };

    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showQuickPick: jest.fn(async (items: QuickPickLike[] | Promise<QuickPickLike[]>) => pick(await items)),
            showWarningMessage: jest.fn().mockResolvedValue({ title: 'ok' }),
        },
        discoveryService,
        credentials: [],
        selectedCredentialId: undefined,
        changed: false,
    } as unknown as AtlasCredentialsManagementWizardContext & {
        discoveryService: jest.Mocked<
            Pick<AtlasDiscoveryService, 'listAll' | 'refreshAll' | 'invalidate' | 'reset' | 'retryCredential'>
        >;
    };
}

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    StorageService._resetForTests();
    resetAtlasCredentialStoreCache();
    mockOpenWebview.mockReset();
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    (vscode.env.openExternal as jest.Mock).mockClear();
});

describe('SelectAtlasCredentialStep', () => {
    it('offers only add and exit when nothing is stored', async () => {
        let seen: QuickPickLike[] = [];
        const context = buildContext((items) => {
            seen = items;
            return items.find((item) => item.isExitOption)!;
        });

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);
        expect(seen.some((item) => item.isAddOption)).toBe(true);
        expect(seen.some((item) => item.isSignOutAllOption)).toBe(false);
        expect(seen.some((item) => item.isRetryAllOption)).toBe(false);
    });

    it('lists stored credentials with their failure reason', async () => {
        const { record } = await upsertAtlasCredential(
            { authMethod: 'serviceaccount', clientId: 'client-1', clientSecret: 'secret-1' },
            { orgName: 'Beta Ltd' },
        );

        let seen: QuickPickLike[] = [];
        const context = buildContext(
            (items) => {
                seen = items;
                return items.find((item) => item.isExitOption)!;
            },
            emptySnapshot({
                credentialErrors: [
                    {
                        credentialId: record.id,
                        label: 'Beta Ltd',
                        kind: 'auth',
                        message: 'Secret expired',
                        retryable: true,
                    },
                ],
            }),
        );

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);

        const row = seen.find((item) => item.credentialId === record.id);
        expect(row?.label).toBe('Beta Ltd');
        expect(row?.description).toBe('Service Account');
        expect(String(row?.detail)).toContain('Secret expired');
        expect(seen.some((item) => item.isSignOutAllOption)).toBe(true);
    });

    it('lists the fleet actions in order: add, retry all, sign out of all, exit', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });

        let seen: QuickPickLike[] = [];
        const context = buildContext((items) => {
            seen = items;
            return items.find((item) => item.isExitOption)!;
        });

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);

        // Adding comes first because this flow is the everyday way to widen what discovery can
        // see, not just a recovery surface.
        const actions = seen
            .filter((item) => item.isAddOption ?? item.isRetryAllOption ?? item.isSignOutAllOption ?? item.isExitOption)
            .map((item) => item.label);
        expect(actions).toEqual(['Add a credential…', 'Retry all', 'Sign out of all', 'Exit']);
        expect(seen.find((item) => item.isAddOption)?.detail).toBeTruthy();
    });

    it('selects a credential so the action step can take over', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'pub-1',
            privateKey: 'priv-1',
        });

        const context = buildContext((items) => items.find((item) => item.credentialId === record.id)!);
        await new SelectAtlasCredentialStep().prompt(context);

        expect(context.selectedCredentialId).toBe(record.id);
        expect(new AtlasCredentialActionStep().shouldPrompt(context)).toBe(true);
    });

    it('does not report a change when the add webview is cancelled', async () => {
        mockOpenWebview.mockResolvedValue(false);
        let call = 0;
        const context = buildContext((items) => {
            call++;
            return call === 1 ? items.find((item) => item.isAddOption)! : items.find((item) => item.isExitOption)!;
        });

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);
        expect(context.changed).toBe(false);
        expect(context.discoveryService.invalidate).not.toHaveBeenCalled();
    });

    it('reports a change when the add webview stores a credential', async () => {
        mockOpenWebview.mockResolvedValue(true);
        const context = buildContext((items) => items.find((item) => item.isAddOption)!);

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);
        expect(context.changed).toBe(true);
        expect(context.discoveryService.invalidate).toHaveBeenCalled();
    });

    it('removes every credential on sign out of all', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-2', privateKey: 'priv-2' });

        const context = buildContext((items) => items.find((item) => item.isSignOutAllOption)!);

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);
        await expect(readAtlasCredentials()).resolves.toEqual([]);
        expect(context.changed).toBe(true);
        expect(context.discoveryService.reset).toHaveBeenCalled();
    });

    it('re-checks the whole fleet on retry all and returns to the refreshed list', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });

        let call = 0;
        const context = buildContext((items) => {
            call++;
            // Without a fleet-wide retry the list is a snapshot of the last discovery pass, so the
            // user would have to walk into every credential in turn to re-check them.
            return call === 1 ? items.find((item) => item.isRetryAllOption)! : items.find((item) => item.isExitOption)!;
        });

        await expect(new SelectAtlasCredentialStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);

        expect(context.discoveryService.refreshAll).toHaveBeenCalledTimes(1);
        expect(context.changed).toBe(true);
        // The list was shown a second time, with statuses reloaded from the fresh snapshot.
        expect(call).toBe(2);
    });
});

describe('AtlasCredentialActionStep', () => {
    async function contextWithSelection(
        pick: (items: QuickPickLike[]) => QuickPickLike,
    ): Promise<[ReturnType<typeof buildContext>, string]> {
        const { record } = await upsertAtlasCredential(
            { authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' },
            { label: 'Work key' },
        );
        const context = buildContext(pick);
        context.credentials = [{ record, label: 'Work key' }];
        context.selectedCredentialId = record.id;
        return [context, record.id];
    }

    it('navigates back without changing anything', async () => {
        const [context] = await contextWithSelection((items) => items.find((item) => item.action === 'back')!);

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(GoBackErrorMock);
        expect(context.selectedCredentialId).toBeUndefined();
        expect(context.changed).toBe(false);
    });

    it('retries only the selected credential', async () => {
        const [context, credentialId] = await contextWithSelection(
            (items) => items.find((item) => item.action === 'retry')!,
        );

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(GoBackErrorMock);
        expect(context.discoveryService.retryCredential).toHaveBeenCalledWith(credentialId);
        expect(context.changed).toBe(true);
        expect(context.credentials).toEqual([]);
    });

    it('opens the webview in edit mode and keeps the record id stable', async () => {
        mockOpenWebview.mockResolvedValue(true);
        const [context, credentialId] = await contextWithSelection(
            (items) => items.find((item) => item.action === 'update')!,
        );

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(GoBackErrorMock);
        expect(mockOpenWebview).toHaveBeenCalledWith(
            expect.objectContaining({ credentialId, credentialLabel: 'Work key' }),
        );
        expect(context.changed).toBe(true);
    });

    it('deep-links a Service Account to its own Atlas page and changes nothing locally', async () => {
        const { record } = await upsertAtlasCredential(
            { authMethod: 'serviceaccount', clientId: 'mdb_sa_id_6a6535fe4a4e5dd61fcd3c9a', clientSecret: 'secret' },
            { orgId: '5ec7c48379933f4c750e478b' },
        );

        const context = buildContext((items) => items.find((item) => item.action === 'openInAtlas')!);
        context.credentials = [{ record: { ...record, orgId: '5ec7c48379933f4c750e478b' }, label: 'Work SA' }];
        context.selectedCredentialId = record.id;

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(GoBackErrorMock);

        expect(vscode.Uri.parse).toHaveBeenCalledWith(
            'https://cloud.mongodb.com/v2#/org/5ec7c48379933f4c750e478b/access/serviceAccounts/mdb_sa_id_6a6535fe4a4e5dd61fcd3c9a',
        );
        expect(vscode.env.openExternal).toHaveBeenCalled();
        // Navigating to Atlas touches no local storage, so it must not claim a change.
        expect(context.changed).toBe(false);
    });

    it('leaves the working credential untouched when an update is cancelled', async () => {
        mockOpenWebview.mockResolvedValue(false);
        const [context, credentialId] = await contextWithSelection(
            (items) => items.find((item) => item.action === 'update')!,
        );

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(GoBackErrorMock);
        expect(context.changed).toBe(false);
        await expect(readAtlasCredentials()).resolves.toHaveLength(1);
        expect((await readAtlasCredentials())[0].id).toBe(credentialId);
    });

    it('removes only the selected credential after confirmation', async () => {
        const peer = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'peer-key',
            privateKey: 'peer-secret',
        });
        const [context, credentialId] = await contextWithSelection(
            (items) => items.find((item) => item.action === 'remove')!,
        );

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(GoBackErrorMock);

        const remaining = await readAtlasCredentials();
        expect(remaining.map((r) => r.id)).toEqual([peer.record.id]);
        expect(remaining.map((r) => r.id)).not.toContain(credentialId);
        expect(context.changed).toBe(true);
    });

    it('exits the flow when the user picks Exit', async () => {
        const [context] = await contextWithSelection((items) => items.find((item) => item.action === 'exit')!);

        await expect(new AtlasCredentialActionStep().prompt(context)).rejects.toBeInstanceOf(UserCancelledErrorMock);
    });
});

describe('buildAtlasAccessUrl', () => {
    const base: AtlasCredentialRecord = { id: 'r1', authMethod: 'apikey', order: 0 };

    it('sends an API key to the organization key list, because per-key deep links need an internal id', () => {
        expect(buildAtlasAccessUrl({ ...base, orgId: '5ec7c48379933f4c750e478b' })).toBe(
            'https://cloud.mongodb.com/v2#/org/5ec7c48379933f4c750e478b/access/apiKeys',
        );
    });

    it('sends a Service Account to its own page when the client id is known', () => {
        expect(
            buildAtlasAccessUrl(
                { ...base, authMethod: 'serviceaccount', orgId: '5ec7c48379933f4c750e478b' },
                'mdb_sa_id_6a6535fe4a4e5dd61fcd3c9a',
            ),
        ).toBe(
            'https://cloud.mongodb.com/v2#/org/5ec7c48379933f4c750e478b/access/serviceAccounts/mdb_sa_id_6a6535fe4a4e5dd61fcd3c9a',
        );
    });

    it('falls back to the Service Account list when the client id cannot be read', () => {
        expect(buildAtlasAccessUrl({ ...base, authMethod: 'serviceaccount', orgId: 'org-1' })).toBe(
            'https://cloud.mongodb.com/v2#/org/org-1/access/serviceAccounts',
        );
    });

    it('falls back to the console root when no organization has been observed yet', () => {
        // A credential rejected by an IP access list may never have completed a request, so it has
        // no cached org id. That is exactly when the user needs the link, so it must not be dropped.
        expect(buildAtlasAccessUrl({ ...base, authMethod: 'serviceaccount' })).toBe('https://cloud.mongodb.com');
    });
});
