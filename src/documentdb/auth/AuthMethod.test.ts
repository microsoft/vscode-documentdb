/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import {
    AuthMethodId,
    authMethodFromString,
    createAuthMethodQuickPickItems,
    createAuthMethodQuickPickItemsWithSupportInfo,
    getAllAuthMethods,
    getAuthMethod,
    getAuthMethodFamily,
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

    it('groups managed identity into the Microsoft Entra ID family', () => {
        expect(getAuthMethodFamily(AuthMethodId.ManagedIdentity)).toBe(AuthMethodId.MicrosoftEntraID);
        expect(getAuthMethodFamily(AuthMethodId.NativeAuth)).toBe(AuthMethodId.NativeAuth);
    });

    it('does not annotate methods with unknown cluster support', () => {
        const items = createAuthMethodQuickPickItems([AuthMethodId.MicrosoftEntraID], {
            showSupportInfo: true,
            entraDestinationAllowed: true,
        });

        expect(items.every((item) => item.description === undefined)).toBe(true);
    });
});

describe('authentication family quick pick', () => {
    it('presents managed identity under the Microsoft Entra ID family', () => {
        const items = createAuthMethodQuickPickItemsWithSupportInfo(undefined, true);
        const entraItem = items.find((item) => item.authMethod === AuthMethodId.MicrosoftEntraID);

        expect(items.some((item) => item.authMethod === AuthMethodId.ManagedIdentity)).toBe(false);
        expect(entraItem?.detail).toMatch(/identity assigned to this machine/i);
    });

    it('keeps managed identity available as a stored method', () => {
        expect(getAuthMethod(AuthMethodId.ManagedIdentity)).toBeDefined();
        expect(getAllAuthMethods().map((method) => method.id)).toContain(AuthMethodId.ManagedIdentity);
    });

    it('renders a familiar icon for each authentication family', () => {
        const items = createAuthMethodQuickPickItemsWithSupportInfo(undefined, true);
        const iconId = (method: AuthMethodId): string | undefined =>
            (items.find((item) => item.authMethod === method)?.iconPath as { id?: string } | undefined)?.id;

        expect(iconId(AuthMethodId.NativeAuth)).toBe('key');
        expect(iconId(AuthMethodId.MicrosoftEntraID)).toBe('azure');
        expect(iconId(AuthMethodId.NoAuth)).toBe('unlock');
    });

    it.each([{ methods: undefined }, { methods: [] }])(
        'does not treat unknown or empty supported methods as destination approval ($methods)',
        ({ methods }) => {
            const items = createAuthMethodQuickPickItemsWithSupportInfo(methods);

            expect(items.flatMap((item) => (item.authMethod ? [item.authMethod] : []))).toEqual([
                AuthMethodId.NativeAuth,
                AuthMethodId.NoAuth,
            ]);
            expect(items.find((item) => item.entraUnavailable)).toMatchObject({
                label: 'Microsoft Entra ID: not available',
                detail: 'Entra ID is used only with Azure DocumentDB clusters.',
                alwaysShow: true,
            });
            expect(items.find((item) => item.entraUnavailable)?.authMethod).toBeUndefined();
        },
    );

    it('does not accept stale Entra or managed-identity metadata as destination approval', () => {
        const items = createAuthMethodQuickPickItems([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity], {
            entraDestinationAllowed: false,
        });

        expect(
            items.some(
                (item) =>
                    item.authMethod === AuthMethodId.MicrosoftEntraID ||
                    item.authMethod === AuthMethodId.ManagedIdentity,
            ),
        ).toBe(false);
    });

    it('keeps legacy non-Entra helper callers free of an unhandled Learn More action', () => {
        const items = createAuthMethodQuickPickItems([AuthMethodId.MicrosoftEntraID]);

        expect(items.map((item) => item.authMethod)).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
        expect(items.some((item) => item.entraUnavailable)).toBe(false);
    });
});
