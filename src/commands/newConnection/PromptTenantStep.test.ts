/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockGetTenants = jest.fn();
const mockIsSignedIn = jest.fn();
const mockConfigureAzureCredentials = jest.fn();

jest.mock('@microsoft/vscode-azext-azureauth', () => ({
    VSCodeAzureSubscriptionProvider: jest.fn().mockImplementation(() => ({
        getTenants: mockGetTenants,
        isSignedIn: mockIsSignedIn,
    })),
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: -1 },
    l10n: { t: jest.fn((message: string) => message) },
}));

jest.mock('../../plugins/api-shared/azure/credentialsManagement', () => ({
    configureAzureCredentials: mockConfigureAzureCredentials,
}));

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { PromptTenantStep as NewConnectionPromptTenantStep } from './PromptTenantStep';
import { PromptTenantStep as UpdateCredentialsPromptTenantStep } from '../updateCredentials/PromptTenantStep';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';
const tenant = {
    tenantId: TENANT_ID,
    displayName: 'Example Organization',
    defaultDomain: 'example.test',
    account: { id: 'account', label: 'alex@example.test' },
};

type PromptTenantStep = NewConnectionPromptTenantStep | UpdateCredentialsPromptTenantStep;

function makeContext(showQuickPick: jest.Mock): IActionContext {
    return {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        ui: { showQuickPick } as unknown as IActionContext['ui'],
    } as unknown as IActionContext;
}

describe.each([
    ['new connection', () => new NewConnectionPromptTenantStep()],
    ['update credentials', () => new UpdateCredentialsPromptTenantStep()],
])('PromptTenantStep for %s', (_name, makeStep: () => PromptTenantStep) => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetTenants.mockResolvedValue([tenant]);
        mockConfigureAzureCredentials.mockResolvedValue(undefined);
    });

    it('runs account management before listing tenants when signed out', async () => {
        mockIsSignedIn.mockResolvedValue(false);
        const showQuickPick = jest.fn().mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
            const items = await itemsPromise;
            return items.find((item) => (item as { tenant?: unknown }).tenant);
        });
        const context = makeContext(showQuickPick);

        await makeStep().prompt(context as never);

        expect(mockConfigureAzureCredentials).toHaveBeenCalledTimes(1);
        expect(mockGetTenants).toHaveBeenCalledTimes(1);
        expect((context as IActionContext & { entraIdAuthConfig?: { tenantId?: string } }).entraIdAuthConfig).toEqual({
            tenantId: TENANT_ID,
        });
        expect(context.telemetry.properties.tenantSelectionMethod).toBe('signInTriggered');
    });

    it('re-enumerates tenants after account management without exiting the wizard', async () => {
        mockIsSignedIn.mockResolvedValue(true);
        const showQuickPick = jest
            .fn()
            .mockResolvedValueOnce({ isSignInOption: true })
            .mockResolvedValueOnce({ tenant });
        const context = makeContext(showQuickPick);

        await makeStep().prompt(context as never);

        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(mockGetTenants).toHaveBeenCalledTimes(2);
        expect(mockConfigureAzureCredentials).toHaveBeenCalledTimes(1);
        expect((context as IActionContext & { entraIdAuthConfig?: { tenantId?: string } }).entraIdAuthConfig).toEqual({
            tenantId: TENANT_ID,
        });
    });
});
