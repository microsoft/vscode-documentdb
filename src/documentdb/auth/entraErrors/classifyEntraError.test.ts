/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Links } from '../../../constants';
import { classifyEntraError } from './classifyEntraError';
import { entraErrorRules, type EntraErrorContext } from './entraErrorRules';

const APPLICATION = '00000000-0000-0000-0000-000000000001';
const RESOURCE = '00000000-0000-0000-0000-000000000002';
const preauthorization = `Consent between first party application '${APPLICATION}' and first party resource '${RESOURCE}' must be configured via preauthorization - applications owned and operated by Microsoft must get approval from the API owner before requesting tokens for that API.`;
const broker = 'platform_broker_error: See https://aka.ms/msal.js.errors#platform_broker_error for details';

const fixtures = [
    { text: `invalid_request - AADSTS65002: ${preauthorization}`, ruleId: 'firstPartyPreauthorization', code: '65002' },
    { text: 'AADSTS500011: Resource principal was not found in the tenant', ruleId: 'resourceNotInTenant', code: '500011' },
    { text: 'AADSTS50001: Resource identifier is not valid', ruleId: 'invalidResource', code: '50001' },
    { text: 'AADSTS50020: Account is not in tenant', ruleId: 'accountNotInTenant', code: '50020' },
    { text: 'AADSTS90072: Account is not in tenant', ruleId: 'accountNotInTenant', code: '90072' },
    { text: 'AADSTS700016: Application was not found', ruleId: 'applicationNotInDirectory', code: '700016' },
    { text: 'AADSTS90002: Tenant was not found', ruleId: 'tenantNotFound', code: '90002' },
    { text: 'AADSTS1000104: Cross-cloud access is not allowed', ruleId: 'crossCloudNotAllowed', code: '1000104' },
    { text: 'AADSTS53003: Blocked by conditional access', ruleId: 'conditionalAccess', code: '53003' },
    { text: 'AADSTS50076: Verification required', ruleId: 'additionalVerification', code: '50076' },
    { text: 'AADSTS50079: Verification required', ruleId: 'additionalVerification', code: '50079' },
    { text: broker, ruleId: 'brokerOpaque', code: undefined },
    { text: 'AADSTS1234567: Unrecognized failure', ruleId: 'unknownAadsts', code: '1234567' },
];

describe('classifyEntraError', () => {
    it.each(fixtures)('classifies $ruleId ($code)', ({ text, ruleId, code }): void => {
        expect(classifyEntraError(text)).toEqual({
            ruleId,
            ...(code ? { code } : {}),
            brokered: text.includes('platform_broker_error'),
        });
    });

    it.each([
        preauthorization,
        preauthorization.replaceAll("'", '&#39;'),
        preauthorization.replaceAll("'", '&amp;#39;'),
    ])('recognizes the preauthorization phrase without a code: %s', (text): void => {
        expect(classifyEntraError(text)).toEqual({
            ruleId: 'firstPartyPreauthorization',
            code: '65002',
            brokered: false,
        });
    });

    it('prefers the first matching table rule, not the first code in the message', (): void => {
        expect(classifyEntraError('AADSTS90002 AADSTS500011 AADSTS65002')).toEqual({
            ruleId: 'firstPartyPreauthorization',
            code: '65002',
            brokered: false,
        });
    });

    it('prefers a known code over a phrase or opaque broker and keeps the broker flag', (): void => {
        expect(classifyEntraError(`${broker} AADSTS50001 ${preauthorization}`)).toEqual({
            ruleId: 'invalidResource',
            code: '50001',
            brokered: true,
        });
    });

    it('prefers a known code over an unknown one', (): void => {
        expect(classifyEntraError('AADSTS1234567 AADSTS50079')?.ruleId).toBe('additionalVerification');
    });

    it('prefers the phrase over the broker, and the broker over an unknown code', (): void => {
        expect(classifyEntraError(`${broker} ${preauthorization}`)).toEqual({
            ruleId: 'firstPartyPreauthorization',
            code: '65002',
            brokered: true,
        });
        expect(classifyEntraError(`${broker} AADSTS1234567`)).toEqual({
            ruleId: 'brokerOpaque',
            brokered: true,
        });
    });

    it('uses the first unknown code for the fallback', (): void => {
        expect(classifyEntraError('AADSTS12345 AADSTS1234567')?.code).toBe('12345');
    });

    it.each([
        '',
        'querySrv EBADRESP _mongodb._tcp.example.com',
        'MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017',
        'Authentication failed.',
        'AADSTS has no numeric code',
    ])('does not classify an ordinary or incomplete error: %s', (text): void => {
        expect(classifyEntraError(text)).toBeUndefined();
    });
});

describe('Entra error rule table', () => {
    it('has unique ids and no repeated AADSTS or MSAL codes', (): void => {
        const ids = entraErrorRules.map((rule): string => rule.id);
        const codes = entraErrorRules.flatMap((rule): readonly string[] => rule.aadsts ?? []);
        const msal = entraErrorRules.flatMap((rule): readonly string[] => rule.msal ?? []);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(codes).size).toBe(codes.length);
        expect(new Set(msal).size).toBe(msal.length);
    });

    it('has a fixture for every rule and every listed code', (): void => {
        for (const rule of entraErrorRules) {
            expect(fixtures.some((fixture): boolean => fixture.ruleId === rule.id), rule.id).toBe(true);
            for (const code of rule.aadsts ?? []) {
                expect(fixtures.some((fixture): boolean => fixture.ruleId === rule.id && fixture.code === code)).toBe(true);
            }
            for (const code of rule.msal ?? []) {
                expect(fixtures.some((fixture): boolean => fixture.ruleId === rule.id && fixture.text.includes(code))).toBe(true);
            }
        }
    });

    it('keeps messages to one paragraph with a public help link and no identifiers', (): void => {
        const contexts: EntraErrorContext[] = [
            { code: '1234567', recentTokenFailure: false },
            { code: '65002', cloudCategory: 'usgov', recentTokenFailure: true },
            { code: '65002', cloudCategory: 'china', recentTokenFailure: true },
            { cloudCategory: 'custom', recentTokenFailure: true },
            { cloudCategory: 'public', recentTokenFailure: true },
        ];
        for (const rule of entraErrorRules) {
            for (const context of contexts) {
                const message = rule.explain(context);
                expect(message).not.toMatch(/[\n\r\u2013\u2014]/);
                expect(message).toMatch(/Microsoft|administrator|help desk|verification/);
                expect(message.endsWith(Links.SovereignClouds)).toBe(true);
                expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}|msal-no-broker/i);
            }
        }
    });

    it('provides the official error-code lookup for unknown codes', (): void => {
        const rule = entraErrorRules.find((candidate): boolean => candidate.id === 'unknownAadsts');
        expect(rule?.explain({ code: '1234567', recentTokenFailure: false })).toContain(
            'https://login.microsoftonline.com/error?code=1234567',
        );
    });
});
