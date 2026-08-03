/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { API } from '../../../DocumentDBExperiences';

const mockStartDockerProvider = jest.fn();

jest.mock('vscode', () => ({
    commands: { executeCommand: jest.fn() },
    env: { clipboard: { writeText: jest.fn() } },
}));

jest.mock('../../../services/localQuickStart/ContainerRuntime', () => ({
    ContainerRuntime: { isDockerReady: jest.fn() },
    getQuickStartOutputChannel: () => ({ show: jest.fn() }),
    startDockerProvider: () => mockStartDockerProvider() as unknown,
}));

jest.mock('../../../services/localQuickStart/QuickStartService', () => ({
    QuickStartService: {
        discardTimedOutInstance: jest.fn(),
        getStatus: jest.fn(),
        isBusy: false,
        provision: jest.fn(),
        refreshLiveState: jest.fn(),
        willReuseExistingInstance: jest.fn(),
    },
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
        telemetry: { properties: Record<string, string>; measurements: Record<string, number> };
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
    it('returns and records the typed provider launch result', async () => {
        mockStartDockerProvider.mockResolvedValue('failed');
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await expect(caller.startDockerProvider()).resolves.toBe('failed');
        expect(context.actionContext.telemetry.properties.dockerLaunchResult).toBe('failed');
    });
});
