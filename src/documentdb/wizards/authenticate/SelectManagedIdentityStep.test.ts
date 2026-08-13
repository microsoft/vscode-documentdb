/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    l10n: { t: jest.fn((message: string) => message) },
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

const mockGetRecentManagedIdentities = jest.fn();
jest.mock('../../auth/recentManagedIdentities', () => ({
    getRecentManagedIdentities: () => mockGetRecentManagedIdentities() as unknown[],
}));

import * as vscode from 'vscode';
import { AuthMethodId } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { SelectManagedIdentityStep } from './SelectManagedIdentityStep';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

function makeStep(): SelectManagedIdentityStep<AuthenticateWizardContext> {
    return new SelectManagedIdentityStep<AuthenticateWizardContext>(
        (context) => context.selectedAuthMethod === AuthMethodId.ManagedIdentity,
    );
}

function makeContext(overrides: Partial<AuthenticateWizardContext> = {}): AuthenticateWizardContext {
    return {
        selectedAuthMethod: AuthMethodId.ManagedIdentity,
        ...overrides,
    } as AuthenticateWizardContext;
}

describe('SelectManagedIdentityStep.buildItems', () => {
    beforeEach(() => {
        mockGetRecentManagedIdentities.mockReset();
        mockGetRecentManagedIdentities.mockReturnValue([]);
    });

    it('puts the system-assigned identity first so it is selected by default', () => {
        const items = makeStep().buildItems();
        const firstSelectableItem = items.find((item) => item.kind !== vscode.QuickPickItemKind.Separator);

        expect(firstSelectableItem?.label).toBe('System-assigned managed identity');
    });

    it('is never a dead end: with nothing known it still offers manual entry and system-assigned', () => {
        const items = makeStep().buildItems();

        expect(items.length).toBeGreaterThanOrEqual(3);
        expect(items.some((item) => item.label === 'System-assigned managed identity')).toBe(true);
    });

    it('shows no "Recently used" heading when there is nothing recent', () => {
        const items = makeStep().buildItems();

        expect(items.some((item) => item.label === 'Recently used')).toBe(false);
    });

    it('groups recent client IDs under a separator', () => {
        mockGetRecentManagedIdentities.mockReturnValue([{ clientId: CLIENT_ID, connectionLabel: 'contoso-prod' }]);

        const items = makeStep().buildItems();
        const separatorIndex = items.findIndex((item) => item.label === 'Recently used');

        expect(separatorIndex).toBeGreaterThan(0);
        expect(items[separatorIndex].kind).toBe(vscode.QuickPickItemKind.Separator);
        expect(items[separatorIndex + 1].label).toBe(CLIENT_ID);
    });

    it('surfaces a client ID that came from the connection string without duplicating it', () => {
        mockGetRecentManagedIdentities.mockReturnValue([{ clientId: CLIENT_ID }]);

        const items = makeStep().buildItems(CLIENT_ID);
        const occurrences = items.filter((item) => item.label === CLIENT_ID);

        expect(occurrences).toHaveLength(1);
        expect(items.some((item) => item.label === 'From the connection string')).toBe(true);
        expect(items.some((item) => item.label === 'Recently used')).toBe(false);
    });

    it('puts manual entry last and includes detail text', () => {
        mockGetRecentManagedIdentities.mockReturnValue([
            { clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', connectionLabel: 'contoso-prod' },
        ]);

        const items = makeStep().buildItems(CLIENT_ID);
        const manualEntry = items.at(-1);

        expect(items[2].label).toBe('From the connection string');
        expect(manualEntry?.label).toBe('Enter a client ID');
        expect(manualEntry?.detail).toBe('Type the client ID of a user-assigned managed identity');
    });
});

describe('SelectManagedIdentityStep.shouldPrompt', () => {
    it('does not prompt when another auth method is selected', () => {
        const context = makeContext({ selectedAuthMethod: AuthMethodId.MicrosoftEntraID });

        expect(makeStep().shouldPrompt(context)).toBe(false);
    });

    it('prompts when managed identity is selected and nothing settled the identity', () => {
        expect(makeStep().shouldPrompt(makeContext())).toBe(true);
    });

    it('skips the prompt when the connection string carried an explicit ENVIRONMENT:azure marker', () => {
        const context = makeContext({ managedIdentityHint: { clientId: CLIENT_ID, confidence: 'explicit' } });

        expect(makeStep().shouldPrompt(context)).toBe(false);
    });

    it('still prompts for a weak hint, so the user can confirm', () => {
        const context = makeContext({ managedIdentityHint: { clientId: CLIENT_ID, confidence: 'weak' } });

        expect(makeStep().shouldPrompt(context)).toBe(true);
    });
});

describe('SelectManagedIdentityStep.validateClientId', () => {
    it('accepts a GUID', () => {
        expect(makeStep().validateClientId(CLIENT_ID)).toBeUndefined();
    });

    it('rejects an empty value and points at the system-assigned option', () => {
        expect(makeStep().validateClientId('')).toMatch(/system-assigned/i);
    });

    it('rejects anything that is not GUID shaped', () => {
        expect(makeStep().validateClientId('not-a-guid')).toBeDefined();
    });
});
