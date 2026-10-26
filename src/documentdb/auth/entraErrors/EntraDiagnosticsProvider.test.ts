/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Links } from '../../../constants';
import { ConnectionDiagnosticsService } from '../../../services/connectionDiagnosticsService';
import { EntraDiagnosticsProvider } from './EntraDiagnosticsProvider';
import { getRecentEntraTokenFailure, recordEntraTokenFailure, resetEntraTokenFailuresForTests } from './entraTokenFailures';

const mockOutputChannel = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: mockOutputChannel },
}));

const telemetryContext = vi.hoisted(() => ({
    errorHandling: { suppressDisplay: false, suppressReportIssue: false },
    telemetry: { properties: {} as Record<string, string> },
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (context: typeof telemetryContext) => Promise<void>): Promise<void> => {
            await callback(telemetryContext);
        },
    ),
    UserCancelledError: class UserCancelledError extends Error {},
}));

const broker = 'platform_broker_error: See https://aka.ms/msal.js.errors#platform_broker_error for details';
const provider = new EntraDiagnosticsProvider();
const clusterId = '00000000-0000-0000-0000-000000000001';

describe('EntraDiagnosticsProvider', () => {
    beforeEach((): void => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        telemetryContext.telemetry.properties = {};
        telemetryContext.errorHandling.suppressDisplay = false;
        telemetryContext.errorHandling.suppressReportIssue = false;
    });

    afterEach((): void => {
        resetEntraTokenFailuresForTests();
        vi.useRealTimers();
    });

    it('has the stable diagnostics id', (): void => {
        expect(provider.id).toBe('entra-sign-in');
    });

    it.each([false, true])('explains the driver host rejection through the service without a token failure (cause=%s)', async (wrapped) => {
        const rejection = "Host 'private-cluster.example.com:10255' is not valid for OIDC authentication with ALLOWED_HOSTS of '*.azure.com'";
        const cause = Object.freeze(new Error(rejection));
        const error = Object.freeze(Object.assign(
            new Error(wrapped ? 'Connection failed' : rejection, wrapped ? { cause } : undefined),
            { code: 'original-code' },
        ));
        const descriptors = Object.getOwnPropertyDescriptors(error);
        ConnectionDiagnosticsService.resetForTests();
        ConnectionDiagnosticsService.registerProvider(provider);
        try {
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
            const diagnosis = await ConnectionDiagnosticsService.explain({ clusterId, error });
            expect(diagnosis?.providerId).toBe('entra-sign-in');
            expect(diagnosis?.message).toContain('documentDB.customEnvironment.mongoClusterHostnameSuffix');
            expect(diagnosis?.message).toContain('user settings');
            expect(diagnosis?.message).not.toMatch(/private-cluster|example.com|10255|azure.com/);
            expect(Object.getOwnPropertyDescriptors(error)).toEqual(descriptors);
            expect(telemetryContext.telemetry.properties.ruleId).toBe('oidcHostNotAllowed');
            expect(JSON.stringify(telemetryContext.telemetry.properties)).not.toContain('private-cluster');
        } finally {
            ConnectionDiagnosticsService.resetForTests();
        }
    });

    it('explains a raw worker host rejection string without a token-failure record', async () => {
        expect(await provider.explain({
            clusterId,
            error: "Host 'private.example.com' is not valid for OIDC authentication with ALLOWED_HOSTS of '*.azure.us,*.azure.cn'",
        })).toContain('documentDB.customEnvironment.mongoClusterHostnameSuffix');
        expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
    });

    it.each(['AADSTS65002: Preauthorization required', new Error('AADSTS65002: Preauthorization required')])(
        'explains a string or Error without needing registry context',
        async (error): Promise<void> => {
            const message = await provider.explain({ clusterId, error });
            expect(message).toContain('Only Microsoft can change this');
            expect(message).toContain('not you or your tenant administrator');
            expect(message).toContain('native DocumentDB authentication');
            expect(message).toContain('managed identity on an Azure VM');
            expect(message).toContain('GitHub');
            expect(message).toContain(Links.SovereignClouds);
        },
    );

    it('reads causes without changing the error or its properties', async (): Promise<void> => {
        const cause = Object.freeze(new Error('AADSTS50020: Account is not in tenant'));
        const error = Object.freeze(Object.assign(new Error('Database connection failed', { cause }), { code: 123 }));
        const properties = Object.getOwnPropertyDescriptors(error);

        expect(await provider.explain({ clusterId, error })).toContain('Use Update Credentials');
        expect(Object.getOwnPropertyDescriptors(error)).toEqual(properties);
        expect(error.cause).toBe(cause);
        expect(cause.message).toBe('AADSTS50020: Account is not in tenant');
    });

    it('concatenates messages to retain the broker flag when a cause contains the code', async (): Promise<void> => {
        const error = new Error(broker, { cause: new Error('AADSTS53003: Blocked') });
        expect(await provider.explain({ clusterId, error })).toContain('IT help desk');
        expect(telemetryContext.telemetry.properties).toMatchObject({
            ruleId: 'conditionalAccess',
            aadstsCode: '53003',
            brokered: 'true',
        });
        const trace = String(mockOutputChannel.info.mock.calls[0][0]);
        expect(trace).toContain('entraSignIn.classified');
        expect(trace).toContain('"ruleId":"conditionalAccess"');
        expect(trace).toContain('"aadstsCode":"53003"');
        expect(trace).toContain('"cloudCategory":"unknown"');
        expect(trace).toContain('"recentTokenFailure":false');
        expect(trace).toContain('"brokered":true');
    });

    it('accepts a string cause relayed by a worker', async (): Promise<void> => {
        const error = new Error('Connection failed', { cause: 'AADSTS90002: Tenant was not found' });
        expect(await provider.explain({ clusterId, error })).toContain('right tenant');
    });

    it('walks at most three cause links', async (): Promise<void> => {
        const signIn = new Error('AADSTS65002: Preauthorization required');
        const depthThree = new Error('Driver', {
            cause: new Error('Wrapper', { cause: new Error('Wrapper', { cause: signIn }) }),
        });
        expect(await provider.explain({ clusterId, error: depthThree })).toContain('Only Microsoft');
        expect(await provider.explain({ clusterId, error: new Error('Outer', { cause: depthThree }) })).toBeUndefined();
    });

    it('safely rejects a cyclic error cause', async (): Promise<void> => {
        const error = new Error('Driver error');
        error.cause = error;
        await expect(provider.explain({ clusterId, error })).resolves.toBeUndefined();
        expect(error.cause).toBe(error);
    });

    it.each([
        ['usgov', 'Azure US Government'],
        ['china', 'Azure China'],
        ['custom', 'a custom cloud'],
    ] as const)(
        'hedges an opaque broker failure in %s after a DocumentDB token failure',
        async (cloudCategory, cloud): Promise<void> => {
            recordEntraTokenFailure(clusterId, { cloudCategory, authMethod: 'interactive' });
            const message = await provider.explain({ clusterId, error: broker });
            expect(message).toContain(`Sign-in failed in ${cloud}. If the sign-in window showed AADSTS65002`);
            expect(message).toContain('must be configured via preauthorization');
            expect(message).toContain('Only Microsoft can change this');
            expect(message).toContain('native DocumentDB authentication or managed identity on an Azure VM');
            expect(message).not.toContain('msal-no-broker');
        },
    );

    it('keeps a public-cloud opaque broker failure generic even with a recent token failure', async (): Promise<void> => {
        recordEntraTokenFailure(clusterId, { cloudCategory: 'public', authMethod: 'interactive' });
        const message = await provider.explain({ clusterId, error: broker });
        expect(message).toContain('without details');
        expect(message).toContain('Developer: Show Logs... > Microsoft Authentication');
        expect(message).not.toContain('AADSTS65002');
    });

    it('keeps a broker failure generic without a recent failure for this cluster', async (): Promise<void> => {
        recordEntraTokenFailure('another-cluster', { cloudCategory: 'usgov', authMethod: 'interactive' });
        const message = await provider.explain({ clusterId, error: broker });
        expect(message).toContain('without details');
        expect(message).toContain('Microsoft Authentication');
        expect(message).not.toContain('AADSTS65002');
        expect(message).not.toContain('Sign-in failed in');
    });

    it('does not use expired context to imply preauthorization is missing', async (): Promise<void> => {
        vi.useFakeTimers();
        recordEntraTokenFailure(clusterId, { cloudCategory: 'china', authMethod: 'interactive' });
        vi.advanceTimersByTime(10 * 60_000 + 1);
        const message = await provider.explain({ clusterId, error: broker });
        expect(message).toContain('without details');
        expect(message).not.toContain('AADSTS65002');
        expect(telemetryContext.telemetry.properties.cloudCategory).toBe('unknown');
    });

    it('emits only classification categories, never identifiers or raw error text', async (): Promise<void> => {
        recordEntraTokenFailure(clusterId, { cloudCategory: 'usgov', authMethod: 'managedIdentity' });
        const error = new Error(
            `AADSTS65002: Tenant '00000000-0000-0000-0000-000000000002' at cluster.example.com rejected secret-token`,
        );
        const message = await provider.explain({ clusterId, error });
        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledOnce();
        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledWith('entraSignIn.classified', expect.any(Function));
        expect(telemetryContext.telemetry.properties).toEqual({
            ruleId: 'firstPartyPreauthorization',
            aadstsCode: '65002',
            cloudCategory: 'usgov',
            brokered: 'false',
            authMethod: 'managedIdentity',
        });
        expect(telemetryContext.errorHandling).toEqual({ suppressDisplay: true, suppressReportIssue: true });
        expect(JSON.stringify(telemetryContext.telemetry.properties)).not.toMatch(
            /[0-9a-f]{8}-[0-9a-f-]{27}|cluster\.example\.com|secret-token/i,
        );
        expect(message).not.toContain('00000000');
        expect(message).not.toContain('secret-token');
    });

    it('uses unknown telemetry categories and an empty code for an uncorrelated broker error', async (): Promise<void> => {
        await provider.explain({ clusterId, error: broker });
        expect(telemetryContext.telemetry.properties).toEqual({
            ruleId: 'brokerOpaque',
            aadstsCode: '',
            cloudCategory: 'unknown',
            brokered: 'true',
            authMethod: 'unknown',
        });
    });

    it.each([
        'querySrv EBADRESP _mongodb._tcp.example.com',
        new Error('MongoServerSelectionError: connection timed out'),
        new UserCancelledError('AADSTS65002'),
        42,
        { message: 'AADSTS65002' },
        undefined,
    ])('rejects unrelated or cancelled input without telemetry', async (error): Promise<void> => {
        await expect(provider.explain({ clusterId, error })).resolves.toBeUndefined();
        expect(callWithTelemetryAndErrorHandling).not.toHaveBeenCalled();
    });
});
