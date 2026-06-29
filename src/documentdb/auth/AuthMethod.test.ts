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
