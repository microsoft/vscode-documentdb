/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { InstanceState, type QuickStartStatus } from '../../services/localQuickStart/quickStartTypes';
import { openLocalQuickStartWebview } from '../../webviews/documentdb/localQuickStart/localQuickStartController';
import { openLocalQuickStart } from './openLocalQuickStart';

jest.mock('../../webviews/documentdb/localQuickStart/localQuickStartController', () => ({
    openLocalQuickStartWebview: jest.fn(),
}));

function testContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext;
}

describe('openLocalQuickStart', () => {
    beforeEach(() => jest.mocked(openLocalQuickStartWebview).mockClear());
    afterEach(() => jest.restoreAllMocks());

    it.each([
        [undefined, 'commandPalette'],
        [{ activationSource: 'treeReviewSetupRow' as const }, 'treeReviewSetupRow'],
    ])('records where the wizard was opened from (%o)', async (options, expected) => {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        jest.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground: jest.fn(),
        } as never);
        const context = testContext();

        await openLocalQuickStart(context, undefined, options);

        expect(context.telemetry.properties.activationSource).toBe(expected);
    });

    it('waits for authoritative hydration before revealing the webview', async () => {
        let finishHydration: (() => void) | undefined;
        jest.spyOn(QuickStartService, 'ensureHydrated').mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishHydration = resolve;
                }),
        );
        const revealToForeground = jest.fn();
        jest.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);

        const opening = openLocalQuickStart(testContext());
        expect(openLocalQuickStartWebview).not.toHaveBeenCalled();

        finishHydration?.();
        await opening;

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith(expect.objectContaining({ id: 'localQuickStart' }));
        expect(revealToForeground).toHaveBeenCalledTimes(1);
    });

    it('still opens the webview when hydration fails because Docker is unavailable', async () => {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockRejectedValue(new Error('Docker unavailable'));
        const revealToForeground = jest.fn();
        jest.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);

        await expect(openLocalQuickStart(testContext())).resolves.toBeUndefined();

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith(expect.objectContaining({ id: 'localQuickStart' }));
        expect(revealToForeground).toHaveBeenCalledTimes(1);
    });

    it('passes the hydrated instance status so the webview can open on the right step', async () => {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.CredentialsMissing,
        } as QuickStartStatus);
        jest.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground: jest.fn(),
        } as never);

        const context = testContext();
        await openLocalQuickStart(context);

        expect(context.telemetry.properties).toMatchObject({
            instanceState: InstanceState.CredentialsMissing,
            initialStep: 'configure',
        });
        const sessionId = context.telemetry.properties.quickStartSessionId;
        expect(sessionId).toEqual(expect.any(String));
        expect(openLocalQuickStartWebview).toHaveBeenCalledWith({
            id: 'localQuickStart',
            initialInstanceState: InstanceState.CredentialsMissing,
            initialInstanceMissing: false,
            initialPhase: 'configure',
            quickStartSessionId: sessionId,
        });
    });
});
