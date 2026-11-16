/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { ext } from '../extensionVariables';
import { describeAuthError, traceAuthFlow, traceEntraDestination } from './authTrace';

vi.mock('../extensionVariables', () => ({ ext: { outputChannel: { info: vi.fn() } } }));

describe('describeAuthError', () => {
    it.each(['documentdbService', 'customSuffix', 'otherAzure', 'other'])(
        'preserves bounded destination class %s independently of error masking',
        (entraDestinationClass): void => {
            const properties: Record<string, string> = {};
            traceAuthFlow(
                'entraDestination.evaluated',
                {
                    entraDestinationClass,
                    microsoftCloudDomain: true,
                    serviceLabel: false,
                    hostname: 'private-host.example.com',
                    token: 'private-token',
                },
                undefined,
                { startupCorrelationId: 'startup-id', surface: 'shell', startupProperties: properties },
            );
            expect(properties).toEqual({ entraDestinationClass, microsoftCloudDomain: 'true', serviceLabel: 'false' });
            expect(ext.outputChannel.info).toHaveBeenLastCalledWith(expect.not.stringMatching(/private-/));
        },
    );

    it('never copies dynamic destination classes or rejection details into telemetry or output', (): void => {
        const properties: Record<string, string> = {};
        traceAuthFlow(
            'entraDestination.evaluated',
            {
                entraDestinationClass: 'private-host',
                microsoftCloudDomain: 'private-host',
                serviceLabel: 'private-token',
            },
            undefined,
            { startupCorrelationId: 'startup-id', surface: 'shell', startupProperties: properties },
        );
        expect(properties).toEqual({ entraDestinationClass: 'other' });
        expect(ext.outputChannel.info).toHaveBeenLastCalledWith(expect.not.stringMatching(/private-/));
    });

    it('logs only the admitted custom suffix, not the first host', (): void => {
        traceEntraDestination({
            allowed: true,
            destinationClass: 'customSuffix',
            allowedHostPatterns: ['*.database.example.com'],
            customSuffixUsed: 'database.example.com',
            firstHost: 'private-host.database.example.com',
            hostCount: 1,
        });
        expect(ext.outputChannel.info).toHaveBeenLastCalledWith(
            '[Auth] Microsoft Entra ID destination admitted by custom suffix: database.example.com',
        );
    });

    it.each(['12345678', '123456789'])('keeps the full bounded AADSTS code %s', (code): void => {
        expect(describeAuthError(new Error(`Sign-in failed (AADSTS${code}).`))).toContain(`aadsts=AADSTS${code};`);
    });

    it.each(['AADSTS1234567890', 'AADSTS6500200000', 'xAADSTS65002', '_AADSTS65002', 'AADSTS65002x', 'AADSTS65002_'])(
        'does not trace an overlong or unbounded code: %s',
        (text): void => {
            expect(describeAuthError(new Error(text))).toContain('aadsts=none;');
        },
    );

    it('labels platform broker errors without exposing the raw message', (): void => {
        expect(describeAuthError(new Error('platform_broker_error: private sign-in failure'))).toBe(
            'type=Error; code=unknown; httpStatus=unknown; aadsts=none; broker=platform_broker_error',
        );
    });

    describe('startup cloud telemetry', () => {
        it.each(['entraCloud.resolved', 'entraCloud.unresolved'])('copies only closed enums from %s', (operation) => {
            const properties: Record<string, string> = {};
            traceAuthFlow(
                operation,
                {
                    cloudCategory: 'usgov',
                    reason: 'setting',
                    configuredCloud: 'AzureUSGovernment',
                    hostCloud: 'AzureUSGovernment',
                    errorKind: 'cloudMismatch',
                    tokenResource: 'https://private-resource.example',
                    authority: 'https://private-authority.example',
                    tenantId: 'private-tenant',
                    customHostnameSuffix: 'private.example',
                    imdsAzEnvironment: 'AzurePrivateCloud',
                },
                undefined,
                { startupCorrelationId: 'startup-id', surface: 'extension', startupProperties: properties },
            );
            expect(properties).toEqual({
                cloudCategory: 'usgov',
                tokenResourceReason: 'setting',
                configuredCloud: 'AzureUSGovernment',
                hostCloud: 'AzureUSGovernment',
                entraFailureKind: 'cloudMismatch',
            });
            expect(JSON.stringify(properties)).not.toMatch(/private|https|AzurePrivateCloud/i);
            // Whole-error masking redacts any property named like an error, so these would arrive empty.
            expect(Object.keys(properties).filter((key) => /(error|exception)/i.test(key))).toEqual([]);
        });

        it('copies a host-cloud conflict', () => {
            const properties: Record<string, string> = {};
            traceAuthFlow(
                'entraCloud.unresolved',
                { hostCloud: 'conflicting', errorKind: 'hostCloudConflict', hostsOutsideAzure: true },
                undefined,
                { startupCorrelationId: 'startup-id', surface: 'extension', startupProperties: properties },
            );
            expect(properties).toMatchObject({ hostCloud: 'conflicting', entraFailureKind: 'hostCloudConflict' });
        });

        it('rejects dynamic values even under known property names', () => {
            const properties: Record<string, string> = {};
            traceAuthFlow(
                'entraCloud.resolved',
                {
                    cloudCategory: 'private-category',
                    reason: 'private-reason',
                    configuredCloud: 'private-cloud',
                    hostCloud: 'private-host',
                    errorKind: 'private-error',
                },
                undefined,
                { startupCorrelationId: 'startup-id', surface: 'shell', startupProperties: properties },
            );
            expect(properties).toEqual({
                cloudCategory: 'unknown',
                tokenResourceReason: 'unknown',
                configuredCloud: 'unknown',
                hostCloud: 'unknown',
                entraFailureKind: 'none',
            });
        });

        it('leaves unrelated auth traces unchanged', () => {
            const properties: Record<string, string> = {};
            traceAuthFlow('nativeAuth.configure', { cloudCategory: 'public' }, undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties: properties,
            });
            expect(properties).toEqual({});
        });
    });

    it('labels other errors as not brokered', (): void => {
        expect(describeAuthError(new Error('private sign-in failure'))).toBe(
            'type=Error; code=unknown; httpStatus=unknown; aadsts=none; broker=none',
        );
    });
});
