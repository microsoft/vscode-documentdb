/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { disposeQuickStartOutputChannel, type IContainerRuntime } from './ContainerRuntime';
import { QuickStartServiceImpl } from './QuickStartService';
import {
    DEFAULT_ALIAS,
    imageRefKey,
    InstanceState,
    LEGACY_IMAGE_REF_KEY,
    LEGACY_SECRET_KEY,
    secretKey,
} from './quickStartTypes';

// The R1 belt-and-suspenders safety path (WI-1): before the activation migration copies the legacy
// flat secret to the alias-keyed one, the service must still (a) adopt an existing labelled container
// rather than remove it, and (b) decide `reusing=true` so the data volume is never wiped — both via
// `readStoredConnectionString`'s legacy fallback. The injectable runtime (WI-0) makes this testable.

const LEGACY_CONN = 'mongodb://u1:p1@localhost:10273/?tls=true&tlsAllowInvalidCertificates=true';

function fakeMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
        keys: () => Array.from(store.keys()),
        get: (key: string, defaultValue?: unknown) => (store.has(key) ? store.get(key) : defaultValue),
        update: (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
            return Promise.resolve();
        },
    } as unknown as vscode.Memento;
}

function fakeSecretStorage(seed: Record<string, string>): vscode.SecretStorage {
    const store = new Map<string, string>(Object.entries(seed));
    return {
        onDidChange: () => ({ dispose: () => undefined }),
        get: (key: string) => Promise.resolve(store.get(key)),
        store: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        delete: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    } as unknown as vscode.SecretStorage;
}

function mockRuntime(overrides: Partial<IContainerRuntime>): IContainerRuntime {
    return {
        listByLabel: jest.fn().mockResolvedValue([]),
        inspectContainer: jest.fn().mockResolvedValue(undefined),
        removeContainer: jest.fn().mockResolvedValue(undefined),
        removeVolume: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as IContainerRuntime;
}

describe('QuickStartService — R1 legacy-fallback safety (WI-1)', () => {
    // jest-mock-vscode's createOutputChannel returns a channel without `appendLine`; stub it so the
    // reconcile no-secret branch (which logs before removing the orphan) doesn't throw in tests.
    beforeAll(() => {
        jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            name: 'test',
            append: jest.fn(),
            appendLine: jest.fn(),
            replace: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn(),
        } as unknown as vscode.LogOutputChannel);
        disposeQuickStartOutputChannel();
    });

    afterAll(() => {
        disposeQuickStartOutputChannel();
        jest.restoreAllMocks();
    });

    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
    });

    it('reconcile() adopts a labelled container via the legacy secret and never removes it or its volume', async () => {
        ext.secretStorage = fakeSecretStorage({ [LEGACY_SECRET_KEY]: LEGACY_CONN });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const runtime = mockRuntime({
            listByLabel: jest.fn().mockResolvedValue([{ id: 'c1' }]),
            // Exited container ⇒ adopted as Stopped (skips the running-only credential-cache path).
            inspectContainer: jest.fn().mockResolvedValue({
                id: 'c1',
                status: 'exited',
                ports: [{ containerPort: 10260, hostPort: 10273 }],
                image: { originalName: 'ghcr.io/documentdb/documentdb-local:1.0.0' },
            }),
            removeContainer,
            removeVolume,
        });
        const service = new QuickStartServiceImpl(runtime);

        await service.reconcile();

        // The legacy fallback made the stored-secret read succeed, so the no-secret orphan-removal
        // branch was skipped: the container is adopted, not removed, and the volume is never touched.
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.Stopped);
    });

    it('willReuseExistingInstance() is true when only the legacy secret exists (protects the volume-wipe gate)', async () => {
        ext.secretStorage = fakeSecretStorage({ [LEGACY_SECRET_KEY]: LEGACY_CONN });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

        const service = new QuickStartServiceImpl(mockRuntime({}));

        expect(await service.willReuseExistingInstance()).toBe(true);
    });

    it('reconcile() with NO stored secret removes the orphan container (but never the volume)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const runtime = mockRuntime({
            listByLabel: jest.fn().mockResolvedValue([{ id: 'c1' }]),
            removeContainer,
            removeVolume,
        });
        const service = new QuickStartServiceImpl(runtime);

        await service.reconcile();

        // No recoverable credentials anywhere ⇒ the container is removed for a clean slate, but the
        // volume is NEVER wiped (a lost secret does not prove the volume is disposable).
        expect(removeContainer).toHaveBeenCalledTimes(1);
        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.NotInstalled);
    });

    it('deleteContainer() purges BOTH the alias-keyed and legacy keys (a full clean slate)', async () => {
        ext.secretStorage = fakeSecretStorage({
            [secretKey(DEFAULT_ALIAS)]: LEGACY_CONN,
            [LEGACY_SECRET_KEY]: LEGACY_CONN,
        });
        const globalState = fakeMemento();
        await globalState.update(imageRefKey(DEFAULT_ALIAS), 'ghcr.io/documentdb/documentdb-local:1.0.0');
        await globalState.update(LEGACY_IMAGE_REF_KEY, 'ghcr.io/documentdb/documentdb-local:1.0.0');
        ext.context = { globalState } as unknown as vscode.ExtensionContext;

        const service = new QuickStartServiceImpl(mockRuntime({}));

        await service.deleteContainer();

        // Explicit Delete leaves no stale credentials/image behind — neither alias-keyed nor legacy —
        // so the next provision can never silently reuse them (locks the opus47-N1 fix).
        expect(await ext.secretStorage.get(secretKey(DEFAULT_ALIAS))).toBeUndefined();
        expect(await ext.secretStorage.get(LEGACY_SECRET_KEY)).toBeUndefined();
        expect(globalState.get(imageRefKey(DEFAULT_ALIAS))).toBeUndefined();
        expect(globalState.get(LEGACY_IMAGE_REF_KEY)).toBeUndefined();
    });
});
