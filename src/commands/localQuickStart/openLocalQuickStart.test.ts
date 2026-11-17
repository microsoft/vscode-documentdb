/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import {
    InstanceState,
    type OpenLocalQuickStartOptions,
    type QuickStartStatus,
} from '../../services/localQuickStart/quickStartTypes';
import { openLocalQuickStartWebview } from '../../webviews/documentdb/localQuickStart/localQuickStartController';
import { openLocalQuickStart } from './openLocalQuickStart';

vi.mock('../../webviews/documentdb/localQuickStart/localQuickStartController', () => ({
    openLocalQuickStartWebview: vi.fn(),
}));

function testContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext;
}

describe('openLocalQuickStart', () => {
    beforeEach(() => vi.mocked(openLocalQuickStartWebview).mockClear());
    afterEach(() => vi.restoreAllMocks());

    it.each([
        [undefined, 'commandPalette'],
        [{ activationSource: 'treeReviewSetupRow' as const }, 'treeReviewSetupRow'],
    ])('records where the wizard was opened from (%o)', async (options, expected) => {
        vi.spyOn(QuickStartService, 'getWizardStatus').mockResolvedValue({ state: InstanceState.NotInstalled });
        vi.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground: vi.fn(),
        } as never);
        const context = testContext();

        await openLocalQuickStart(context, undefined, options);

        expect(context.telemetry.properties.activationSource).toBe(expected);
    });

    it('waits for metadata hydration without reconciling engines before revealing the webview', async () => {
        let finishHydration: (() => void) | undefined;
        const reconcile = vi.spyOn(QuickStartService, 'ensureHydrated');
        const readiness = vi.spyOn(QuickStartService, 'checkInstanceDockerReadiness');
        vi.spyOn(QuickStartService, 'getWizardStatus').mockImplementation(
            () =>
                new Promise<QuickStartStatus>((resolve) => {
                    finishHydration = (): void => resolve({ state: InstanceState.NotInstalled });
                }),
        );
        const revealToForeground = vi.fn();
        vi.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);

        const opening = openLocalQuickStart(testContext());
        expect(openLocalQuickStartWebview).not.toHaveBeenCalled();

        finishHydration?.();
        await opening;

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'localQuickStart' }),
            undefined,
        );
        expect(revealToForeground).toHaveBeenCalledTimes(1);
        expect(reconcile).not.toHaveBeenCalled();
        expect(readiness).not.toHaveBeenCalled();
    });

    it('still opens the webview when metadata storage is unavailable', async () => {
        vi.spyOn(QuickStartService, 'getWizardStatus').mockRejectedValue(new Error('Storage unavailable'));
        const revealToForeground = vi.fn();
        vi.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);

        await expect(openLocalQuickStart(testContext())).resolves.toBeUndefined();

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'localQuickStart' }),
            undefined,
        );
        expect(revealToForeground).toHaveBeenCalledTimes(1);
    });

    it('passes the stored-facts status so the webview opens on Configure when credentials are missing', async () => {
        // Before reconciliation the live status is still NotInstalled; only stored facts know better.
        vi.spyOn(QuickStartService, 'getStatus').mockReturnValue({ state: InstanceState.NotInstalled });
        vi.spyOn(QuickStartService, 'getWizardStatus').mockResolvedValue({
            state: InstanceState.CredentialsMissing,
        } as QuickStartStatus);
        vi.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground: vi.fn(),
        } as never);

        const context = testContext();
        await openLocalQuickStart(context);

        expect(context.telemetry.properties).toMatchObject({
            instanceState: InstanceState.CredentialsMissing,
            initialStep: 'configure',
        });
        const sessionId = context.telemetry.properties.quickStartSessionId;
        expect(sessionId).toEqual(expect.any(String));
        expect(openLocalQuickStartWebview).toHaveBeenCalledWith(
            {
                id: 'localQuickStart',
                initialInstanceState: InstanceState.CredentialsMissing,
                initialInstanceMissing: false,
                initialPhase: 'configure',
                quickStartSessionId: sessionId,
            },
            undefined,
        );
    });

    it('opens Configure with Start fresh selected without checking or changing the instance', async () => {
        vi.spyOn(QuickStartService, 'getWizardStatus').mockResolvedValue({ state: InstanceState.Error });
        const readiness = vi.spyOn(QuickStartService, 'checkInstanceDockerReadiness');
        const provision = vi.spyOn(QuickStartService, 'provision');
        const revealToForeground = vi.fn();
        vi.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);
        const context = testContext();

        await openLocalQuickStart(context, undefined, {
            activationSource: 'treeStartFreshRow',
            initialDataChoice: 'fresh',
        });

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith(
            expect.objectContaining({ initialPhase: 'configure', initialDataChoice: 'fresh' }),
            undefined,
        );
        expect(context.telemetry.properties).toMatchObject({
            activationSource: 'treeStartFreshRow',
            initialStep: 'configure',
        });
        expect(revealToForeground).toHaveBeenCalledTimes(1);
        expect(readiness).not.toHaveBeenCalled();
        expect(provision).not.toHaveBeenCalled();
    });

    it.each(['reuse', true, 1, {}])(
        'ignores runtime data choice %j instead of treating it as fresh',
        async (initialDataChoice) => {
            vi.spyOn(QuickStartService, 'getWizardStatus').mockResolvedValue({ state: InstanceState.Error });
            vi.mocked(openLocalQuickStartWebview).mockReturnValue({
                panel: { viewColumn: undefined },
                revealToForeground: vi.fn(),
            } as never);

            await openLocalQuickStart(testContext(), undefined, {
                initialDataChoice,
            } as unknown as OpenLocalQuickStartOptions);

            const config = vi.mocked(openLocalQuickStartWebview).mock.calls[0][0];
            expect(config.initialPhase).toBe('introduction');
            expect(config.initialDataChoice).toBeUndefined();
        },
    );

    it('continues revealing the singleton in its existing column on a subsequent Start fresh request', async () => {
        vi.spyOn(QuickStartService, 'getWizardStatus').mockResolvedValue({ state: InstanceState.Error });
        const revealToForeground = vi.fn();
        vi.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: 2 },
            revealToForeground,
        } as never);

        await openLocalQuickStart(testContext());
        await openLocalQuickStart(testContext(), undefined, { initialDataChoice: 'fresh' });

        expect(openLocalQuickStartWebview).toHaveBeenCalledTimes(2);
        expect(revealToForeground).toHaveBeenCalledTimes(2);
        expect(revealToForeground.mock.calls).toEqual([[2], [2]]);
    });
});
