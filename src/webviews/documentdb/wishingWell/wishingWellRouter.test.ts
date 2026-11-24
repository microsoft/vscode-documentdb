/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc } = await vi.importActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = initWebviewTrpc();
    return {
        createCallerFactory: trpc.createCallerFactory,
        publicProcedureWithTelemetry: trpc.publicProcedure,
        router: trpc.router,
    };
});

import { API } from '../../../DocumentDBExperiences';
import { type GrantResult } from '../../../services/wishingWell/WishingWellService';
import { type WishScope } from '../../../services/wishingWell/wishScope';
import { createCallerFactory } from '../../_integration/trpc';
import { wishingWellRouter, type RouterContext } from './wishingWellRouter';

const databaseScope: WishScope = {
    cluster: { clusterId: 'cluster-1', clusterDisplayName: 'Cluster 1', viewId: 'connectionsView' },
    databaseName: 'shop',
};

type Well = RouterContext['well'];

interface FakeWell {
    readonly isCopilotAvailable: Mock<Well['isCopilotAvailable']>;
    readonly describeConnection: Mock<Well['describeConnection']>;
    readonly grant: Mock<Well['grant']>;
    readonly makeWish: Mock<Well['makeWish']>;
    readonly feelingLucky: Mock<Well['feelingLucky']>;
}

function createWell(): FakeWell {
    return {
        isCopilotAvailable: vi.fn<Well['isCopilotAvailable']>(async () => false),
        describeConnection: vi.fn<Well['describeConnection']>(async () => ({ collections: ['orders'] })),
        grant: vi.fn<Well['grant']>(async (): Promise<GrantResult> => 'granted'),
        makeWish: vi.fn<Well['makeWish']>(),
        feelingLucky: vi.fn<Well['feelingLucky']>(),
    };
}

const createCaller = createCallerFactory(wishingWellRouter);

// A fresh context per call, as the webview host copies it, so only the objects inside it are shared.
function caller(scope: WishScope, well: Well): ReturnType<typeof createCaller> {
    const context: RouterContext & { actionContext: object } = {
        dbExperience: API.DocumentDB,
        webviewName: 'wishingWell',
        scope,
        well,
        actionContext: { telemetry: { properties: {}, measurements: {} } },
    };
    return createCaller(context);
}

describe('wishingWellRouter.status', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('lists the collections at most once a minute, but checks Copilot on every call', async () => {
        const scope = { ...databaseScope };
        const well = createWell();

        const first = await caller(scope, well).status();
        well.isCopilotAvailable.mockResolvedValue(true);
        vi.advanceTimersByTime(59_000);
        const focused = await caller(scope, well).status();

        expect(well.describeConnection).toHaveBeenCalledTimes(1);
        expect(well.isCopilotAvailable).toHaveBeenCalledTimes(2);
        expect(first.copilotAvailable).toBe(false);
        expect(focused.copilotAvailable).toBe(true);
        expect(focused.examples).toContain('Count the documents in orders');

        vi.advanceTimersByTime(2_000);
        await caller(scope, well).status();
        expect(well.describeConnection).toHaveBeenCalledTimes(2);
    });

    it('shares one listing between calls that overlap', async () => {
        const scope = { ...databaseScope };
        const well = createWell();

        await Promise.all([caller(scope, well).status(), caller(scope, well).status()]);

        expect(well.describeConnection).toHaveBeenCalledTimes(1);
    });

    it('keeps the examples when the server lists the collections in another order', async () => {
        const scope = { ...databaseScope };
        const well = createWell();
        well.describeConnection.mockResolvedValueOnce({ collections: ['orders', 'customers'] });
        const before = await caller(scope, well).status();

        vi.advanceTimersByTime(61_000);
        well.describeConnection.mockResolvedValueOnce({ collections: ['customers', 'orders'] });
        const after = await caller(scope, well).status();

        expect(well.describeConnection).toHaveBeenCalledTimes(2);
        expect(after.examples).toEqual(before.examples);
    });

    it('lists nothing for a well opened on a collection or without a database', async () => {
        const well = createWell();

        await caller({ ...databaseScope, collectionName: 'orders' }, well).status();
        await caller({ cluster: databaseScope.cluster }, well).status();
        await caller({}, well).status();

        expect(well.describeConnection).not.toHaveBeenCalled();
    });

    it('still answers when listing the collections fails', async () => {
        const well = createWell();
        well.describeConnection.mockRejectedValue(new Error('not connected'));

        const status = await caller({ ...databaseScope }, well).status();

        expect(status.examples.length).toBeGreaterThan(0);
    });
});

describe('wishingWellRouter.grant', () => {
    it.each([
        ['granted', { granted: true, opened: false, waiting: false, declined: false }],
        ['opened', { granted: false, opened: true, waiting: false, declined: false }],
        ['waiting', { granted: false, opened: false, waiting: true, declined: false }],
        ['unknown', { granted: false, opened: false, waiting: false, declined: false }],
        ['declined', { granted: false, opened: false, waiting: false, declined: true }],
    ] as const)('maps %s', async (result, expected) => {
        const well = createWell();
        well.grant.mockResolvedValue(result);

        await expect(caller({}, well).grant({ id: 'wish-1' })).resolves.toEqual(expected);
        expect(well.grant).toHaveBeenCalledWith('wish-1', expect.anything(), 'webview');
    });
});
