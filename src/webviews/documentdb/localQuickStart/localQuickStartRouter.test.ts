/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { API } from '../../../DocumentDBExperiences';

const mockStartDockerProvider = jest.fn();
const mockIsDockerReady = jest.fn();
const mockGetStatus = jest.fn();
const mockRefreshLiveState = jest.fn();
const mockWillReuseExistingInstance = jest.fn();

jest.mock('vscode', () => ({
    commands: { executeCommand: jest.fn() },
    env: { clipboard: { writeText: jest.fn() } },
}));

jest.mock('../../../services/localQuickStart/ContainerRuntime', () => ({
    ContainerRuntime: { isDockerReady: mockIsDockerReady },
    getQuickStartOutputChannel: () => ({ show: jest.fn() }),
    startDockerProvider: () => mockStartDockerProvider() as unknown,
}));

jest.mock('../../../services/localQuickStart/QuickStartService', () => ({
    QuickStartService: {
        discardTimedOutInstance: jest.fn(),
        getStatus: mockGetStatus,
        isBusy: false,
        provision: jest.fn(),
        refreshLiveState: mockRefreshLiveState,
        willReuseExistingInstance: mockWillReuseExistingInstance,
    },
}));

// The reveal helper pulls in the tree + azext-utils, whose module-level `vscode.l10n.t` call fails
// against this file's minimal `vscode` stub. What it does is covered by its own test
// (`src/tree/connections-view/LocalQuickStart/revealQuickStartInstance.test.ts`); here we only care
// that the router calls it.
const mockRevealQuickStartInstance = jest.fn();
jest.mock('../../../tree/connections-view/LocalQuickStart/revealQuickStartInstance', () => ({
    revealQuickStartInstance: (...args: unknown[]) => mockRevealQuickStartInstance(...args) as unknown,
}));

jest.mock('../../_integration/trpc', () => {
    const { initWebviewTrpc } = jest.requireActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = initWebviewTrpc();
    return {
        createCallerFactory: trpc.createCallerFactory,
        publicProcedure: trpc.publicProcedure,
        publicProcedureWithTelemetry: trpc.publicProcedure,
        router: trpc.router,
    };
});

import { createCallerFactory } from '../../_integration/trpc';
import { localQuickStartRouter, type RouterContext } from './localQuickStartRouter';

function createContext(): RouterContext & {
    actionContext: {
        telemetry: {
            properties: Record<string, string>;
            measurements: Record<string, number>;
            suppressAll?: boolean;
        };
    };
} {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'localQuickStart',
        closePanel: jest.fn(),
        actionContext: {
            telemetry: { properties: {}, measurements: {} },
        },
    };
}

describe('localQuickStartRouter', () => {
    /**
     * The success screen's primary action. It used to be wired to `connectionsView.focus` alone,
     * which does nothing visible when that view is already active — the normal case, since Quick
     * Start is opened FROM it — so the button appeared dead. It must reach the navigation that
     * actually opens the instance.
     */
    it('opens the managed instance rather than only focusing the view', async () => {
        mockRevealQuickStartInstance.mockResolvedValue(undefined);
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await caller.openConnection();

        expect(mockRevealQuickStartInstance).toHaveBeenCalledWith(context.actionContext);
    });

    it('suppresses telemetry for polled Docker readiness queries', async () => {
        mockIsDockerReady.mockResolvedValue({
            outcome: 'ready',
            environment: 'local',
            endpointKind: 'unixSocket',
            provider: 'dockerEngine',
            providerEvidence: 'infoOperatingSystem',
            executionTarget: 'localHost',
            checkedAtMs: 1,
            cliInstalled: true,
            canContinueAnyway: false,
            daemonReachable: true,
        });
        mockGetStatus.mockReturnValue({ state: 'Stopped' });
        mockWillReuseExistingInstance.mockResolvedValue(false);
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await caller.getDockerStatus({ polled: true });

        expect(context.actionContext.telemetry.suppressAll).toBe(true);
    });

    it('forwards an explicit provider-memory reset to Docker readiness', async () => {
        mockIsDockerReady.mockResolvedValue({
            outcome: 'ready',
            environment: 'local',
            endpointKind: 'unixSocket',
            provider: 'dockerEngine',
            providerEvidence: 'infoOperatingSystem',
            executionTarget: 'localHost',
            checkedAtMs: 1,
            cliInstalled: true,
            canContinueAnyway: false,
            daemonReachable: true,
        });
        mockGetStatus.mockReturnValue({ state: 'Stopped' });
        mockWillReuseExistingInstance.mockResolvedValue(false);
        const caller = createCallerFactory(localQuickStartRouter)(createContext());

        await caller.getDockerStatus({ forceRefresh: true, resetProviderMemory: true });

        expect(mockIsDockerReady).toHaveBeenCalledWith(
            expect.objectContaining({ forceRefresh: true, resetProviderMemory: true }),
        );
    });

    it('returns and records the typed provider launch result', async () => {
        mockStartDockerProvider.mockResolvedValue('failed');
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await expect(caller.startDockerProvider()).resolves.toBe('failed');
        expect(context.actionContext.telemetry.properties.dockerLaunchResult).toBe('failed');
    });
});
