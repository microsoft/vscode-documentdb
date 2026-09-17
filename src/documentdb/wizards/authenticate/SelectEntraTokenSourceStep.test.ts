/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function interpolate(message: string, ...args: unknown[]): string {
    return message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)]));
}

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    l10n: { t: jest.fn(interpolate) },
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn(interpolate),
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    GoBackError: class GoBackError extends Error {},
}));

import * as vscode from 'vscode';
import { GoBackError } from '@microsoft/vscode-azext-utils';
import { AuthMethodId } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { groupAsGuid, normalizeClientId, SelectEntraTokenSourceStep } from './SelectEntraTokenSourceStep';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

function makeStep(): SelectEntraTokenSourceStep<AuthenticateWizardContext> {
    return new SelectEntraTokenSourceStep<AuthenticateWizardContext>(
        (context) => context.selectedAuthMethod,
        (context, method) => {
            context.selectedAuthMethod = method;
        },
    );
}

function makeContext(overrides: Partial<AuthenticateWizardContext> = {}): AuthenticateWizardContext {
    return {
        selectedAuthMethod: AuthMethodId.ManagedIdentity,
        availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        ...overrides,
    } as AuthenticateWizardContext;
}

describe('SelectEntraTokenSourceStep.buildItems', () => {
    it('puts account sign-in first when the connection string supplied no candidate', () => {
        const items = makeStep().buildItems();
        const firstSelectableItem = items.find((item) => item.kind !== vscode.QuickPickItemKind.Separator);

        expect(firstSelectableItem?.label).toBe('Sign in with my account');
        expect(items[0].label).toBe('Microsoft Entra account');
    });

    it('is never a dead end: with nothing known it offers account and both managed identity sources', () => {
        const items = makeStep().buildItems();

        expect(items.some((item) => item.choice === 'account')).toBe(true);
        expect(items.some((item) => item.choice === 'systemAssigned')).toBe(true);
        expect(items.some((item) => item.choice === 'manual')).toBe(true);
    });

    it('surfaces and highlights a client ID that came from the connection string', () => {
        const items = makeStep().buildItems(CLIENT_ID);
        const firstSelectableItem = items.find((item) => item.kind !== vscode.QuickPickItemKind.Separator);

        expect(items.filter((item) => item.label.includes(CLIENT_ID))).toHaveLength(1);
        expect(items.some((item) => item.label === 'From the connection string')).toBe(true);
        expect(firstSelectableItem?.choice).toBe('clientId');
    });

    it('includes manual entry with Azure terminology', () => {
        const items = makeStep().buildItems(CLIENT_ID);
        const manualEntry = items.find((item) => item.choice === 'manual');

        expect(manualEntry?.label).toBe('Use a different managed identity...');
        expect(manualEntry?.detail).toBe('Enter the client ID of a user-assigned managed identity');
    });

    it('prefills a supplied identity that is not a client ID for correction', () => {
        const items = makeStep().buildItems(undefined, 'alice');
        const manualEntry = items.find((item) => item.choice === 'manual');

        expect(manualEntry?.clientId).toBe('alice');
    });

    it('offers the inferred-family escape only when requested', () => {
        expect(makeStep().buildItems(undefined, undefined, false).some((item) => item.choice === 'authMethod')).toBe(
            false,
        );
        expect(makeStep().buildItems(undefined, undefined, true).some((item) => item.choice === 'authMethod')).toBe(
            true,
        );
    });

    it('keeps system-assigned and user-assigned terms searchable in details', () => {
        const items = makeStep().buildItems();

        expect(items.find((item) => item.choice === 'systemAssigned')?.detail).toBe(
            'Authenticate without a client ID using the system-assigned option',
        );
        expect(items.find((item) => item.choice === 'manual')?.detail).toContain('user-assigned');
        expect(items.some((item) => item.label === 'Managed identity')).toBe(true);
    });

    it('groups the inferred-family escape under other options', () => {
        const items = makeStep().buildItems(undefined, undefined, true);
        const otherOptionsIndex = items.findIndex((item) => item.label === 'Other options');

        expect(items[otherOptionsIndex + 1].label).toBe('Choose a different authentication method...');
    });

    it('offers a visible back action when the authentication family picker was shown', () => {
        const items = makeStep().buildItems(undefined, undefined, false, true);
        const otherOptionsIndex = items.findIndex((item) => item.label === 'Other options');

        expect(items[otherOptionsIndex + 1].label).toBe('Back to authentication method selection');
        expect(items[otherOptionsIndex + 1].choice).toBe('back');
    });

    it('does not offer back when the family was inferred or auto-selected', () => {
        const items = makeStep().buildItems();

        expect(items.some((item) => item.choice === 'back')).toBe(false);
    });
});

describe('SelectEntraTokenSourceStep.shouldPrompt', () => {
    it('does not prompt when another auth method is selected', () => {
        const context = makeContext({ selectedAuthMethod: AuthMethodId.NativeAuth });

        expect(makeStep().shouldPrompt(context)).toBe(false);
    });

    it('does not prompt when managed identity is not available for the cluster', () => {
        const context = makeContext({
            selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
            availableAuthMethods: [AuthMethodId.MicrosoftEntraID],
        });

        expect(makeStep().shouldPrompt(context)).toBe(false);
    });

    it('prompts when Microsoft Entra ID is selected and no string settled the token source', () => {
        const context = makeContext({ selectedAuthMethod: AuthMethodId.MicrosoftEntraID });

        expect(makeStep().shouldPrompt(context)).toBe(true);
    });

    it('prompts when managed identity is selected and nothing settled the identity', () => {
        expect(makeStep().shouldPrompt(makeContext())).toBe(true);
    });

    it('skips the prompt when the connection string carried an explicit ENVIRONMENT:azure marker', () => {
        const context = makeContext({
            connectionStringAuthFacts: {
                usesOidc: true,
                declaresAzureMachineWorkflow: true,
                username: CLIENT_ID,
                usernameIsGuid: true,
            },
        });

        expect(makeStep().shouldPrompt(context)).toBe(false);
    });

    it('still prompts when the string did not declare the Azure machine workflow', () => {
        const context = makeContext({
            connectionStringAuthFacts: {
                usesOidc: true,
                declaresAzureMachineWorkflow: false,
                username: CLIENT_ID,
                usernameIsGuid: true,
            },
        });

        expect(makeStep().shouldPrompt(context)).toBe(true);
    });

    it('prompts for a machine workflow whose supplied identity is not a client ID', () => {
        // Otherwise the pasted selector would be silently replaced by the system-assigned identity.
        const context = makeContext({
            connectionStringAuthFacts: {
                usesOidc: true,
                declaresAzureMachineWorkflow: true,
                username: 'alice',
                usernameIsGuid: false,
            },
        });

        expect(makeStep().shouldPrompt(context)).toBe(true);
    });
});

describe('SelectEntraTokenSourceStep.prompt', () => {
    it('returns to a family picker that actually prompted', async () => {
        const context = makeContext({
            authenticationMethodPrompted: true,
            ui: {
                showQuickPick: jest.fn().mockResolvedValue({ choice: 'back' }),
            } as unknown as AuthenticateWizardContext['ui'],
        });

        await expect(makeStep().prompt(context)).rejects.toBeInstanceOf(GoBackError);
    });

    it('selects account sign-in and clears a candidate managed identity', async () => {
        const context = makeContext({
            managedIdentityAuthConfig: { clientId: CLIENT_ID },
            ui: { showQuickPick: jest.fn().mockResolvedValue({ choice: 'account' }) } as unknown as AuthenticateWizardContext['ui'],
        });

        await makeStep().prompt(context);

        expect(context.selectedAuthMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(context.managedIdentityAuthConfig).toBeUndefined();
    });

    it('selects the machine identity without retaining a client ID', async () => {
        const context = makeContext({
            managedIdentityAuthConfig: { clientId: CLIENT_ID },
            ui: {
                showQuickPick: jest.fn().mockResolvedValue({ choice: 'systemAssigned' }),
            } as unknown as AuthenticateWizardContext['ui'],
        });

        await makeStep().prompt(context);

        expect(context.selectedAuthMethod).toBe(AuthMethodId.ManagedIdentity);
        expect(context.managedIdentityAuthConfig).toEqual({});
    });

    it('reopens the family picker without offering the current Entra family', async () => {
        const showQuickPick = jest
            .fn()
            .mockResolvedValueOnce({ choice: 'authMethod' })
            .mockResolvedValueOnce({ authMethod: AuthMethodId.NoAuth });
        const context = makeContext({
            entraIdAuthConfig: { tenantId: 'tenant' },
            managedIdentityAuthConfig: { clientId: CLIENT_ID },
            ui: { showQuickPick } as unknown as AuthenticateWizardContext['ui'],
        });

        await makeStep().prompt(context);

        const familyItems = showQuickPick.mock.calls[1][0] as Array<{ authMethod?: AuthMethodId }>;
        expect(familyItems.some((item) => item.authMethod === AuthMethodId.MicrosoftEntraID)).toBe(false);
        expect(context.selectedAuthMethod).toBe(AuthMethodId.NoAuth);
        expect(context.entraIdAuthConfig).toBeUndefined();
        expect(context.managedIdentityAuthConfig).toBeUndefined();
    });
});

describe('SelectEntraTokenSourceStep.validateClientId', () => {
    it('accepts a GUID', () => {
        expect(makeStep().validateClientId(CLIENT_ID)).toBeUndefined();
    });

    it('accepts a GUID surrounded by whitespace', () => {
        expect(makeStep().validateClientId(`  ${CLIENT_ID}\t`)).toBeUndefined();
    });

    it('accepts a client ID pasted without separators', () => {
        expect(makeStep().validateClientId(CLIENT_ID.replace(/-/g, ''))).toBeUndefined();
    });

    it('accepts a client ID whose separators sit in the wrong places', () => {
        expect(makeStep().validateClientId('1111-11112222333344445555-55555555')).toBeUndefined();
    });

    it('rejects an empty value and points at the system-assigned option', () => {
        expect(makeStep().validateClientId('')).toMatch(/system-assigned/i);
    });

    it('reports how an incomplete value is read, so the user can see what is missing', () => {
        expect(makeStep().validateClientId('111111122')).toContain('11111112-2');
    });

    it('keeps the extra characters visible when the value is too long', () => {
        expect(makeStep().validateClientId(`${CLIENT_ID}99`)).toContain('555555555555-99');
    });

    it('names the allowed characters instead of guessing at a grouping', () => {
        const message = makeStep().validateClientId('11 1111111111122222222222222222');

        expect(message).toBeDefined();
        expect(message).not.toContain('Read as');
        // The dash is valid input, and the example has to demonstrate the letters it allows.
        expect(message).toContain('dashes');
        expect(message).toContain('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
    });
});

describe('normalizeClientId', () => {
    it('restores the separators of a value pasted without them', () => {
        expect(normalizeClientId(CLIENT_ID.replace(/-/g, ''))).toBe(CLIENT_ID);
    });

    it('leaves a value that is not 32 hexadecimal characters alone, apart from trimming', () => {
        expect(normalizeClientId('  alice  ')).toBe('alice');
    });
});

describe('groupAsGuid', () => {
    it('groups a partial value as far as it goes', () => {
        expect(groupAsGuid('111111122')).toBe('11111112-2');
    });

    it('groups a full value into 8-4-4-4-12', () => {
        expect(groupAsGuid(CLIENT_ID.replace(/-/g, ''))).toBe(CLIENT_ID);
    });
});
