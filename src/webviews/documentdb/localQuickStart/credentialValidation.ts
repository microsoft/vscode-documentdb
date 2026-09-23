/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { QUICK_START_MIN_PASSWORD_LENGTH } from '../../../services/localQuickStart/quickStartTypes';

export interface CredentialValidation {
    readonly field: 'credentials' | 'username' | 'password';
    readonly message: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Validate the Configure step's custom credentials. Skipped entirely when credentials are
 * auto-generated: the fields are hidden and not sent, so a stale value left in them must not
 * disable Start with an error the user can't see.
 */
export function getCredentialValidation(input: {
    readonly useCustomCredentials: boolean;
    readonly username: string;
    readonly password: string;
}): CredentialValidation | undefined {
    if (!input.useCustomCredentials) {
        return undefined;
    }
    const user = input.username.trim();
    const pass = input.password.trim();
    // Blank fields used to mean "auto-generate", but the switch owns that now; accepting them
    // would generate credentials while the summary says "Your own username and password".
    if (!user || !pass) {
        return { field: 'credentials', message: l10n.t('Enter a username and a password.') };
    }
    if (user.length > 128) {
        return { field: 'username', message: l10n.t('Username must be 128 characters or fewer.') };
    }
    if (pass.length < QUICK_START_MIN_PASSWORD_LENGTH) {
        return {
            field: 'password',
            message: l10n.t('Password must be at least {0} characters.', QUICK_START_MIN_PASSWORD_LENGTH),
        };
    }
    if (pass.length > 256) {
        return { field: 'password', message: l10n.t('Password must be 256 characters or fewer.') };
    }
    if (CONTROL_CHARACTER.test(user)) {
        return { field: 'username', message: l10n.t('Username must not contain control characters.') };
    }
    if (CONTROL_CHARACTER.test(pass)) {
        return { field: 'password', message: l10n.t('Password must not contain control characters.') };
    }
    return undefined;
}
