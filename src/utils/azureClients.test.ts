/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { TestOutputChannel, TestUserInput } from '@microsoft/vscode-azext-utils';
import { afterEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { AzureSubscriptionProviderWithFilters } from '../plugins/api-shared/azure/AzureSubscriptionProviderWithFilters';
import { createResourceManagementClient } from './azureClients';

import { type HttpClient, type PipelineResponse } from '@azure/core-rest-pipeline';
import { type AzureSubscription, type TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';

const { getSession, getAccounts } = vi.hoisted(() => {
    // Keep the real Azure utilities' extension registration from sending telemetry.
    vi.stubEnv('DEBUGTELEMETRY', 'true');
    return {
        getSession:
            vi.fn<
                (
                    providerId: string,
                    scopes: readonly string[] | vscode.AuthenticationWwwAuthenticateRequest,
                    options?: vscode.AuthenticationGetSessionOptions,
                ) => Promise<vscode.AuthenticationSession>
            >(),
        getAccounts: vi.fn(async (): Promise<vscode.AuthenticationSessionAccountInformation[]> => []),
    };
});

vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<typeof vscode & { default: Record<string, unknown> }>();
    const authentication = {
        getSession,
        getAccounts,
        onDidChangeSessions: vi.fn(() => ({ dispose: vi.fn() })),
    };
    // Share the fixture with both Vite's ESM alias and the setup hook for CommonJS require('vscode').
    actual.default.authentication = authentication;
    return { ...actual, authentication };
});

class TestSubscriptionProvider extends AzureSubscriptionProviderWithFilters {
    public getSubscriptionAuth(tenant: TenantIdAndAccount): Pick<AzureSubscription, 'credential' | 'authentication'> {
        return this.getSubscriptionContext(tenant);
    }
}

function idToken(expiry: number): string {
    // azureauth reads the numeric exp claim in seconds from the ID token, not the access token.
    const payload = Buffer.from(JSON.stringify({ exp: expiry / 1000 })).toString('base64url');
    return `eyJhbGciOiJub25lIn0.${payload}.`;
}

afterEach((): void => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

it('silently renews the bearer token across ARM operations on the same stored subscription', async (): Promise<void> => {
    const now = Date.UTC(2026, 0, 1);
    const expiry = now + 60 * 60 * 1000;
    vi.useFakeTimers({ now });

    const showQuickPick = vi.spyOn(vscode.window, 'showQuickPick');
    const createQuickPick = vi.spyOn(vscode.window, 'createQuickPick');

    registerAzureUtilsExtensionVariables({
        prefix: 'fixture',
        context: {
            extension: {
                packageJSON: { name: 'fixture', version: '0.0.0', publisher: 'fixture', aiKey: 'fixture' },
            },
        } as vscode.ExtensionContext,
        outputChannel: new TestOutputChannel(),
    });
    const context: IActionContext = {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: new TestUserInput(vscode),
        valuesToMask: [],
    };

    const provider = new TestSubscriptionProvider();
    try {
        const listSubscriptions = vi.spyOn(provider, 'getAvailableSubscriptions');
        const listTenants = vi.spyOn(provider, 'getTenantsForAccount');
        const listTenantSubscriptions = vi.spyOn(provider, 'getSubscriptionsForTenant');
        const environment = getConfiguredAzureEnv();
        const account = { id: 'fixture-account', label: 'Fixture account', environment };
        const tenant = { tenantId: '00000000-0000-4000-8000-000000000001', account };
        const subscription: AzureSubscription = {
            ...tenant,
            ...provider.getSubscriptionAuth(tenant),
            environment,
            isCustomCloud: environment.isCustomCloud,
            name: 'Fixture subscription',
            subscriptionId: '00000000-0000-4000-8000-000000000002',
        };
        const acquiredTokens: string[] = [];
        getSession.mockImplementation(async (): Promise<vscode.AuthenticationSession> => {
            const expired = Date.now() >= expiry;
            const accessToken = expired ? 'fixture-B' : 'fixture-A';
            acquiredTokens.push(accessToken);
            return {
                id: 'fixture-session',
                account,
                scopes: [],
                accessToken,
                idToken: idToken(expired ? expiry + 60 * 60 * 1000 : expiry),
            };
        });

        const authorizations: (string | undefined)[] = [];
        const transport: HttpClient = {
            async sendRequest(request): Promise<PipelineResponse> {
                authorizations.push(request.headers.get('authorization'));
                return {
                    request,
                    status: 200,
                    headers: createHttpHeaders({ 'content-type': 'application/json' }),
                    bodyAsText: JSON.stringify({ name: 'fixture-group', location: 'fixture-region' }),
                };
            },
        };
        async function readResourceGroup(): Promise<void> {
            const client = await createResourceManagementClient(context, subscription);
            // Substitute only the transport; the SDK still runs every pipeline policy.
            const sendRequest = client.pipeline.sendRequest.bind(client.pipeline);
            vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(
                (_transport, request): Promise<PipelineResponse> => sendRequest(transport, request),
            );
            await client.resourceGroups.get('fixture-group');
        }

        await readResourceGroup();
        expect(authorizations).toEqual(['Bearer fixture-A']);
        expect(getSession).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(expiry - now + 1000);
        await readResourceGroup();

        expect(acquiredTokens).toEqual(['fixture-A', 'fixture-B']);
        for (const [authProviderId, scopes, options] of getSession.mock.calls) {
            expect(authProviderId).toBe('microsoft');
            expect(scopes).toContain(`VSCODE_TENANT:${tenant.tenantId}`);
            expect(options).toMatchObject({ account, silent: true });
            expect(options?.createIfNone).toBeFalsy();
            expect(options).not.toHaveProperty('forceNewSession');
        }
        expect(getAccounts).not.toHaveBeenCalled();
        expect(listTenants).not.toHaveBeenCalled();
        expect(listTenantSubscriptions).not.toHaveBeenCalled();
        expect(listSubscriptions).not.toHaveBeenCalled();
        expect(showQuickPick).not.toHaveBeenCalled();
        expect(createQuickPick).not.toHaveBeenCalled();
        expect(authorizations).toEqual(['Bearer fixture-A', 'Bearer fixture-B']);
    } finally {
        provider.dispose();
    }
});
