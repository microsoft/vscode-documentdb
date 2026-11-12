/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cancelDeepLink,
    failDeepLink,
    measureDeepLinkPhase,
    readDeepLinkTelemetry,
    recordDeepLinkConnectionAttempt,
    recordDeepLinkSource,
    trackDeepLinkTelemetry,
} from './deepLinkTelemetry';

function createContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        valuesToMask: [],
        errorHandling: { issueProperties: {} },
        ui: {} as IActionContext['ui'],
    };
}

afterEach(() => vi.restoreAllMocks());

describe('deep-link telemetry', () => {
    it.each(['azure-portal', 'Docs_Getting-Started', 'a', 'a'.repeat(64)])(
        'accepts and normalizes publisher label %s',
        (source): void => {
            const context = createContext();
            recordDeepLinkSource(context, new URLSearchParams({ source }));
            expect(context.telemetry.properties).toEqual({
                deepLinkSourceStatus: 'valid',
                deepLinkSource: source.toLowerCase(),
            });
            expect(context.valuesToMask).toEqual([]);
        },
    );

    it.each([
        '',
        'a'.repeat(65),
        'https://example.com',
        'user@example.com',
        'token=secret',
        'has space',
        'docs\n',
        '_docs',
        '日本語',
    ])('ignores invalid publisher metadata without recording its value (%j)', (source): void => {
        const context = createContext();
        recordDeepLinkSource(context, new URLSearchParams({ source }));
        expect(context.telemetry.properties).toEqual({ deepLinkSourceStatus: 'invalid' });
        expect(context.valuesToMask).toEqual(source ? [source] : []);
    });

    it('does not silently choose between duplicate source parameters', (): void => {
        const context = createContext();
        recordDeepLinkSource(context, new URLSearchParams('source=docs&source=portal'));
        expect(context.telemetry.properties).toEqual({ deepLinkSourceStatus: 'invalid' });
        expect(context.valuesToMask).toEqual(['docs', 'portal']);
    });

    it('distinguishes an absent source from an invalid source', (): void => {
        const context = createContext();
        recordDeepLinkSource(context, new URLSearchParams());
        expect(context.telemetry.properties).toEqual({ deepLinkSourceStatus: 'absent' });
    });

    it('propagates only link identity and publisher attribution', (): void => {
        const context = createContext();
        const details = readDeepLinkTelemetry({
            deepLinkCorrelationId: 'attempt',
            deepLinkSource: 'docs',
            connectionString: 'private-value',
            database: 'private-database',
        });
        trackDeepLinkTelemetry(context, details);
        expect(context.telemetry.properties).toEqual({
            deepLinkCorrelationId: 'attempt',
            deepLinkSource: 'docs',
            activationSource: 'deepLink',
        });
        expect(readDeepLinkTelemetry(undefined)).toBeUndefined();
        expect(readDeepLinkTelemetry({ deepLinkCorrelationId: 1 })).toBeUndefined();
    });

    it('classifies non-throwing cancellations and failures explicitly', (): void => {
        const canceled = createContext();
        cancelDeepLink(canceled, 'AzureConfirmation');
        expect(canceled.telemetry.properties).toMatchObject({
            result: 'Canceled',
            deepLinkOutcome: 'canceled',
            userCancelledAtStep: 'AzureConfirmation',
        });
        const failed = createContext();
        failDeepLink(failed, 'connectionFailed', 'notConnected');
        expect(failed.telemetry.properties).toMatchObject({
            result: 'Failed',
            deepLinkOutcome: 'connectionFailed',
            errorReason: 'notConnected',
        });
    });

    it('retains failed-startup identity after client eviction and preserves cancellation', (): void => {
        const context = createContext();
        context.telemetry.properties.deepLinkCorrelationId = 'link-attempt';
        recordDeepLinkConnectionAttempt(context, {
            lastConnectionCorrelationId: 'failed-startup',
            lastConnectionOutcome: 'canceled',
        });
        failDeepLink(context, 'connectionFailed', 'notConnected');
        expect(context.telemetry.properties).toMatchObject({
            connectionCorrelationId: 'failed-startup',
            result: 'Canceled',
            deepLinkOutcome: 'canceled',
            userCancelledAtStep: 'ConnectCluster',
        });
    });

    it('accumulates phase milliseconds, including failed attempts', async (): Promise<void> => {
        const context = createContext();
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValueOnce(100).mockReturnValueOnce(125);
        expect(await measureDeepLinkPhase(context, 'subscriptionLookup', async () => 'subscription')).toBe(
            'subscription',
        );
        now.mockReturnValueOnce(200).mockReturnValueOnce(240);
        await expect(
            measureDeepLinkPhase(context, 'subscriptionLookup', async () => {
                throw new Error('lookup failed');
            }),
        ).rejects.toThrow('lookup failed');
        expect(context.telemetry.measurements.subscriptionLookupTimeMs).toBe(65);
        expect(context.telemetry.measurements.duration).toBeUndefined();
    });
});
