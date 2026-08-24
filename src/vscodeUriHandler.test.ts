/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { globalUriHandler } from './vscodeUriHandler';

/** Telemetry recorded by the mocked azext wrapper, so routing decisions can be asserted. */
let lastTelemetry: Record<string, string> = {};

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (
            _eventName: string,
            callback: (ctx: { telemetry: { properties: Record<string, string> } }) => unknown,
        ) => {
            const context = { telemetry: { properties: {} as Record<string, string>, measurements: {} } };
            try {
                return await callback(context);
            } finally {
                lastTelemetry = context.telemetry.properties;
            }
        },
    ),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

const mockOpenLocalQuickStart = jest.fn().mockResolvedValue(undefined);
jest.mock('./commands/localQuickStart/openLocalQuickStart', () => ({
    openLocalQuickStart: (...args: unknown[]) => mockOpenLocalQuickStart(...args),
}));

// The connect path pulls in storage, the tree, and the collection view. None of it is reached by
// these tests — `connect` is asserted by the point at which it refuses, which is parameter
// validation — but the imports still have to resolve.
jest.mock('./commands/openCollectionView/openCollectionView', () => ({ openCollectionViewInternal: jest.fn() }));
jest.mock('./services/connectionStorageService', () => ({
    ConnectionStorageService: { getAll: jest.fn().mockResolvedValue([]) },
    ConnectionType: { Clusters: 'clusters', Emulators: 'emulators' },
    ItemType: { Cluster: 'cluster' },
}));
jest.mock('./services/legacyEmulatorMigration', () => ({ isLegacyEmulatorMigrationComplete: () => true }));
jest.mock('./tree/connections-view/connectionsViewHelpers', () => ({
    buildConnectionsViewTreePath: jest.fn(),
    revealInConnectionsView: jest.fn(),
    waitForConnectionsViewReady: jest.fn(),
    withConnectionsViewProgress: jest.fn(),
}));
jest.mock('./extensionVariables', () => ({
    ext: { settingsKeys: { showUrlHandlingConfirmations: 'showUrlHandlingConfirmations' } },
}));

function uriFor(path: string, query: string = ''): vscode.Uri {
    return { scheme: 'vscode', authority: 'ms-azuretools.vscode-documentdb', path, query } as vscode.Uri;
}

/** Runs the handler and returns the error it surfaced, or `undefined` when it succeeded. */
async function runHandler(path: string, query: string = ''): Promise<Error | undefined> {
    try {
        await globalUriHandler(uriFor(path, query));
        return undefined;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}

beforeEach(() => {
    jest.clearAllMocks();
    lastTelemetry = {};
});

describe('globalUriHandler — route parsing', () => {
    it('treats a link with no path as connect, so already-published links keep working', async () => {
        const error = await runHandler('', '');

        // Every link published before verbs existed has an empty path. "No verb" has to keep
        // meaning connect forever, because a link in a blog post cannot be recalled.
        expect(lastTelemetry.deepLinkVerb).toBe('connect');
        // It reached connect's own validation rather than being rejected as an unknown route.
        expect(error?.message).toContain('connection string');
    });

    it('routes an explicit /connect the same way as the legacy form', async () => {
        const error = await runHandler('/connect', '');

        expect(lastTelemetry.deepLinkVerb).toBe('connect');
        expect(error?.message).toContain('connection string');
    });

    it('opens the DocumentDB Local wizard for /local', async () => {
        const error = await runHandler('/local');

        expect(error).toBeUndefined();
        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
        expect(lastTelemetry.deepLinkVerb).toBe('local');
    });

    it('accepts a verb in any case, because links are typed and pasted by hand', async () => {
        await runHandler('/LOCAL');

        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
    });

    it('tolerates a trailing slash', async () => {
        await runHandler('/local/');

        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
        expect(lastTelemetry.deepLinkQualifierCount).toBe('0');
    });
});

describe('globalUriHandler — the verb list is a security boundary', () => {
    // The tempting implementation of a "command switch" maps the verb onto a VS Code command id.
    // The extension has commands that delete a container and copy a password to the clipboard, so
    // any page able to produce a link would be able to reach them. These names must stay inert.
    it.each([
        ['/delete'],
        ['/localQuickStart.delete'],
        ['/vscode-documentdb.command.localQuickStart.delete'],
        ['/copyPassword'],
        ['/localQuickStart.copyPassword'],
        ['/../local'],
    ])('refuses %s instead of reaching a command', async (path) => {
        const error = await runHandler(path);

        expect(error).toBeDefined();
        expect(error?.message).toContain('does not recognize');
        expect(mockOpenLocalQuickStart).not.toHaveBeenCalled();
    });

    it('does not fall back to connect when the verb is unrecognized', async () => {
        const error = await runHandler('/nonsense', 'connectionString=mongodb%3A%2F%2Fhost');

        // Falling through to the default would make every typo a silent connection attempt, and
        // would let a mistyped link act on a connection string the user never meant to use here.
        expect(error?.message).toContain('does not recognize');
        expect(error?.message).not.toContain('connection string parameter');
        expect(lastTelemetry.deepLinkVerb).toBe('unrecognized');
    });
});

describe('globalUriHandler — telemetry shape', () => {
    it('records the verb and the failure stage for an unrecognized route', async () => {
        await runHandler('/nonsense');

        // `failureStage` and `errorName` group deep-link failures; issue #655 (URL handler error
        // rate at 100%) is why they exist, so a new branch must keep filling them in.
        expect(lastTelemetry.failureStage).toBe('parseRoute');
        expect(lastTelemetry.errorName).toBe('Error');
        expect(lastTelemetry.deepLinkVerb).toBe('unrecognized');
    });

    it('keeps recording the non-sensitive URI diagnostics on every route', async () => {
        await runHandler('/local');

        expect(lastTelemetry.uriScheme).toBe('vscode');
        expect(lastTelemetry.uriAuthority).toBe('ms-azuretools.vscode-documentdb');
        expect(lastTelemetry.uriPathLength).toBe(String('/local'.length));
    });
});
