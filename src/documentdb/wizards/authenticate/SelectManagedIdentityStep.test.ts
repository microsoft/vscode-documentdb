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
}));

import * as vscode from 'vscode';
import { AuthMethodId } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { groupAsGuid, normalizeClientId, SelectManagedIdentityStep } from './SelectManagedIdentityStep';

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

    it('surfaces a client ID that came from the connection string', () => {
        const items = makeStep().buildItems(CLIENT_ID);

        expect(items.filter((item) => item.label === CLIENT_ID)).toHaveLength(1);
        expect(items.some((item) => item.label === 'From the connection string')).toBe(true);
    });

    it('puts manual entry last and includes detail text', () => {
        const items = makeStep().buildItems(CLIENT_ID);
        const manualEntry = items.at(-1);

        expect(items[2].label).toBe('From the connection string');
        expect(manualEntry?.label).toBe('Enter a client ID');
        expect(manualEntry?.detail).toBe('Type the client ID of a user-assigned managed identity');
    });

    it('offers a supplied identity that is not a client ID for editing', () => {
        const items = makeStep().buildItems(undefined, 'alice');
        const supplied = items.find((item) => item.label === 'alice');

        expect(supplied).toBeDefined();
        // 'manual' routes the value into the editable field instead of using it as-is.
        expect(supplied?.choice).toBe('manual');
        expect(supplied?.clientId).toBe('alice');
    });

    it('prefers a usable client ID over a supplied identity', () => {
        const items = makeStep().buildItems(CLIENT_ID, 'alice');

        expect(items.some((item) => item.label === 'alice')).toBe(false);
        expect(items.some((item) => item.choice === 'clientId')).toBe(true);
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

    it('prompts for an explicit hint whose supplied identity is not a client ID', () => {
        // Otherwise the pasted selector would be silently replaced by the system-assigned identity.
        const context = makeContext({ managedIdentityHint: { suppliedIdentity: 'alice', confidence: 'explicit' } });

        expect(makeStep().shouldPrompt(context)).toBe(true);
    });
});

describe('SelectManagedIdentityStep.validateClientId', () => {
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
        const message = makeStep().validateClientId('not-a-guid');

        expect(message).toBeDefined();
        expect(message).not.toContain('Read as');
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
