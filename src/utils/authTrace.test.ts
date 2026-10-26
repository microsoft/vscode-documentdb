/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { describeAuthError, traceAuthFlow } from './authTrace';

vi.mock('../extensionVariables', () => ({ ext: { outputChannel: { info: vi.fn() } } }));

describe('describeAuthError', () => {
    it.each(['12345678', '123456789'])('keeps the full bounded AADSTS code %s', (code): void => {
        expect(describeAuthError(new Error(`Sign-in failed (AADSTS${code}).`))).toContain(`aadsts=AADSTS${code};`);
    });

    it.each([
        'AADSTS1234567890',
        'AADSTS6500200000',
        'xAADSTS65002',
        '_AADSTS65002',
        'AADSTS65002x',
        'AADSTS65002_',
    ])('does not trace an overlong or unbounded code: %s', (text): void => {
        expect(describeAuthError(new Error(text))).toContain('aadsts=none;');
    });

    it('labels platform broker errors without exposing the raw message', (): void => {
        expect(describeAuthError(new Error('platform_broker_error: private sign-in failure'))).toBe(
            'type=Error; code=unknown; httpStatus=unknown; aadsts=none; broker=platform_broker_error',
        );
    });

    describe('startup cloud telemetry', () => {
        it.each(['entraCloud.resolved', 'entraCloud.unresolved'])('copies only closed enums from %s', (operation) => {
            const properties: Record<string, string> = {};
            traceAuthFlow(operation, {
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
            }, undefined, { startupCorrelationId: 'startup-id', surface: 'extension', startupProperties: properties });
            expect(properties).toEqual({
                cloudCategory: 'usgov',
                tokenResourceReason: 'setting',
                configuredCloud: 'AzureUSGovernment',
                hostCloud: 'AzureUSGovernment',
                errorKind: 'cloudMismatch',
            });
            expect(JSON.stringify(properties)).not.toMatch(/private|https|AzurePrivateCloud/i);
        });

        it('rejects dynamic values even under known property names', () => {
            const properties: Record<string, string> = {};
            traceAuthFlow('entraCloud.resolved', {
                cloudCategory: 'private-category', reason: 'private-reason', configuredCloud: 'private-cloud',
                hostCloud: 'private-host', errorKind: 'private-error',
            }, undefined, { startupCorrelationId: 'startup-id', surface: 'shell', startupProperties: properties });
            expect(properties).toEqual({
                cloudCategory: 'unknown', tokenResourceReason: 'unknown', configuredCloud: 'unknown',
                hostCloud: 'unknown', errorKind: 'none',
            });
        });

        it('leaves unrelated auth traces unchanged', () => {
            const properties: Record<string, string> = {};
            traceAuthFlow('nativeAuth.configure', { cloudCategory: 'public' }, undefined, {
                startupCorrelationId: 'startup-id', surface: 'extension', startupProperties: properties,
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
