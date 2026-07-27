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
import {
    readAtlasCredentials,
    resetAtlasCredentialStoreCache,
    upsertAtlasCredential,
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
    discoveryService: jest.Mocked<Pick<AtlasDiscoveryService, 'listAll' | 'invalidate' | 'reset' | 'retryCredential'>>;
} {
    const sessionRegistry = { invalidate: jest.fn(), invalidateAll: jest.fn() };
    const discoveryService = {
        listAll: jest.fn().mockResolvedValue(snapshot),
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
            Pick<AtlasDiscoveryService, 'listAll' | 'invalidate' | 'reset' | 'retryCredential'>
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
