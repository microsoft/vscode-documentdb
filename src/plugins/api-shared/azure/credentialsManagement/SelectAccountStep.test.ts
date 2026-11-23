/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';
import { SelectAccountStep } from './SelectAccountStep';

vi.mock('../../../../extensionVariables', () => ({ ext: { outputChannel: { info: vi.fn(), error: vi.fn() } } }));

describe('SelectAccountStep', () => {
    it('includes a newly invited tenant when opening Manage Azure Accounts with a warm tenant cache', async () => {
        const account = { id: 'fixture-account', label: 'Fixture account' };
        const existing = { tenantId: 'existing-tenant', account };
        const invited = { tenantId: 'new-tenant', account };
        const getTenantsForAccount = vi.fn(async (_account: typeof account, options?: { noCache?: boolean }) =>
            options?.noCache ? [existing, invited] : [existing],
        );
        const signIn = vi.fn().mockResolvedValue(true);
        const showQuickPick = vi.fn(async (items: Promise<readonly { account?: typeof account }[]>) =>
            (await items).find((item) => item.account === account),
        );
        const context = {
            azureSubscriptionProvider: {
                getAccounts: vi.fn().mockResolvedValue([account]),
                getTenantsForAccount,
                signIn,
            },
            allAccountsWithTenantInfo: [],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
        } as unknown as CredentialsManagementWizardContext;

        await new SelectAccountStep().prompt(context);

        expect(context.selectedAccount).toBe(account);
        expect(context.allAccountsWithTenantInfo[0].tenantsWithStatus.map(({ tenant }) => tenant)).toEqual([
            existing,
            invited,
        ]);
        expect(signIn).toHaveBeenCalledWith({ tenantId: invited.tenantId, account }, { promptIfNeeded: false });
    });
});
