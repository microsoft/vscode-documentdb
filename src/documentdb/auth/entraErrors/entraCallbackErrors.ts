/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../AuthMethod';

export class EntraSignInRequiredError extends Error {
    constructor(public readonly reason: 'noSession' | 'providerChanged') {
        super(l10n.t('Sign in again to continue using Microsoft Entra ID.'));
        this.name = 'EntraSignInRequiredError';
    }
}

export class EntraIdentityMismatchError extends Error {
    constructor() {
        super(l10n.t('Visual Studio Code returned a different Microsoft account for this connection.'));
        this.name = 'EntraIdentityMismatchError';
    }
}

export class TokenCallbackError extends Error {
    public readonly authMethod = AuthMethodId.MicrosoftEntraID;

    constructor(cause: unknown) {
        super(l10n.t('Failed to obtain a Microsoft Entra ID token.'), { cause });
        this.name = 'TokenCallbackError';
    }
}
