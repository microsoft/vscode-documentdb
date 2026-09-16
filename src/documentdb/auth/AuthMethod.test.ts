/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AuthMethodId,
    authMethodFromString,
    createAuthMethodQuickPickItemsWithSupportInfo,
    getAllAuthMethods,
    getAuthMethod,
    isSupportedAuthMethod,
} from './AuthMethod';

describe('AuthMethod NoAuth support', () => {
    it('exposes NoAuth as a supported method', () => {
        expect(isSupportedAuthMethod('NoAuth')).toBe(true);
        expect(authMethodFromString('NoAuth')).toBe(AuthMethodId.NoAuth);
    });

    it('includes NoAuth in the list of all auth methods', () => {
        const ids = getAllAuthMethods().map((method) => method.id);
        expect(ids).toContain(AuthMethodId.NoAuth);
    });

    it('provides localized metadata for NoAuth', () => {
        const method = getAuthMethod(AuthMethodId.NoAuth);
        expect(method.label).toBeTruthy();
        expect(method.detail).toBeTruthy();
    });

    it('renders a NoAuth quick-pick item', () => {
        const items = createAuthMethodQuickPickItemsWithSupportInfo();
        const noAuthItem = items.find((item) => item.authMethod === AuthMethodId.NoAuth);
        expect(noAuthItem).toBeDefined();
    });
});

describe('authentication family quick pick', () => {
    it('presents managed identity under the Microsoft Entra ID family', () => {
        const items = createAuthMethodQuickPickItemsWithSupportInfo();
        const entraItem = items.find((item) => item.authMethod === AuthMethodId.MicrosoftEntraID);

        expect(items.some((item) => item.authMethod === AuthMethodId.ManagedIdentity)).toBe(false);
        expect(entraItem?.detail).toMatch(/identity assigned to this machine/i);
    });

    it('keeps managed identity available as a stored method', () => {
        expect(getAuthMethod(AuthMethodId.ManagedIdentity)).toBeDefined();
        expect(getAllAuthMethods().map((method) => method.id)).toContain(AuthMethodId.ManagedIdentity);
    });

    it('renders a familiar icon for each authentication family', () => {
        const items = createAuthMethodQuickPickItemsWithSupportInfo();
        const iconId = (method: AuthMethodId): string | undefined =>
            (items.find((item) => item.authMethod === method)?.iconPath as { id?: string } | undefined)?.id;

        expect(iconId(AuthMethodId.NativeAuth)).toBe('key');
        expect(iconId(AuthMethodId.MicrosoftEntraID)).toBe('azure');
        expect(iconId(AuthMethodId.NoAuth)).toBe('unlock');
    });
});
