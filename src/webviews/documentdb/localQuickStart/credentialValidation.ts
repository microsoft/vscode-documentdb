/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type PasswordEncodingProblem } from '../../../services/localQuickStart/quickStartTypes';

/**
 * Custom-credential rules for Quick Start, shared by the Configure step and the router so the two
 * can't drift. Each rule is a value the DocumentDB Local image accepts but then fails on: the
 * container exits, logins time out, or queries fail after setup reports success.
 *
 * Must stay free of `vscode` imports: the webview bundle imports this module too.
 */

export interface CredentialValidation {
    readonly field: 'credentials' | 'username' | 'password';
    readonly message: string;
    /** A trailing space may be the gap before the next word, so the form waits for a pause to show it. */
    readonly transient?: boolean;
}

/** The host's SASLprep verdict on a password, kept with the password it was given. */
export interface PasswordEncodingCheck {
    readonly password: string;
    readonly result: PasswordEncodingProblem | 'ok';
}

// U+0085, U+2028 and U+2029 act as line breaks in some tools, so they count as control characters.
// So does a lone surrogate: it is malformed text that can't be encoded into the connection string.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|\p{Cs}/u;
const WHITESPACE = /\s/u;

// PostgreSQL truncates role names past 63 bytes, so the login name no longer exists.
const MAX_USERNAME_BYTES = 63;
const MAX_PASSWORD_LENGTH = 256;

// The gateway puts the username into a libpq connection string without quoting, and doesn't decode
// SCRAM's `=2C`/`=3D` escapes.
const USERNAME_FORBIDDEN_CHARACTERS = ['\\', '=', ','];
// A leading `'` opens a quoted connection-string value. A leading `-` is parsed as an option by the
// image's startup scripts, which then fail.
const USERNAME_FORBIDDEN_FIRST_CHARACTERS = ["'", '-'];
// The gateway rejects these prefixes in any letter case (its BlockedRolePrefixes).
const RESERVED_USERNAME_PREFIXES = ['documentdb', 'citus', 'pg', 'internal_role'];
// PostgreSQL refuses to create these roles.
const RESERVED_USERNAMES = ['public', 'none'];

/**
 * Validate the Configure step's custom credentials. Skipped entirely when credentials are
 * auto-generated: the fields are hidden and not sent, so a stale value left in them must not
 * disable Start with an error the user can't see.
 *
 * Values are checked exactly as typed. Trimming would store a different password from the one
 * the user will type later.
 */
export function getCredentialValidation(input: {
    readonly useCustomCredentials: boolean;
    readonly username: string;
    readonly password: string;
}): CredentialValidation | undefined {
    if (!input.useCustomCredentials) {
        return undefined;
    }
    const { username, password } = input;
    // A filled field's own problem is more useful than asking for the other field first.
    const fieldError =
        (username ? getUsernameValidation(username) : undefined) ??
        (password ? getPasswordValidation(password) : undefined);
    if (fieldError) {
        return fieldError;
    }
    if (!username !== !password) {
        return {
            field: 'credentials',
            message: l10n.t('Enter both a username and a password, or leave both blank to auto-generate.'),
        };
    }
    return undefined;
}

function getUsernameValidation(username: string): CredentialValidation | undefined {
    const invalid = (message: string): CredentialValidation => ({ field: 'username', message });
    if (CONTROL_CHARACTER.test(username)) {
        return invalid(l10n.t('Username must not contain control characters.'));
    }
    if (WHITESPACE.test(username)) {
        return invalid(l10n.t('Username must not contain spaces.'));
    }
    if (USERNAME_FORBIDDEN_CHARACTERS.some((character) => username.includes(character))) {
        return invalid(l10n.t('Username must not contain a backslash (\\), equals sign (=), or comma (,).'));
    }
    if (USERNAME_FORBIDDEN_FIRST_CHARACTERS.some((character) => username.startsWith(character))) {
        return invalid(l10n.t("Username must not start with an apostrophe (') or a hyphen (-)."));
    }
    if (new TextEncoder().encode(username).length > MAX_USERNAME_BYTES) {
        // Bytes only matter once the name has non-ASCII characters; otherwise they're characters.
        return invalid(
            /^[\x20-\x7e]*$/.test(username)
                ? l10n.t('Username must be {0} characters or fewer.', MAX_USERNAME_BYTES)
                : l10n.t(
                      'Username must be {0} bytes or fewer. Accented and non-Latin characters take 2 to 4 bytes each.',
                      MAX_USERNAME_BYTES,
                  ),
        );
    }
    if (RESERVED_USERNAMES.includes(username)) {
        return invalid(l10n.t('The username “{0}” is reserved. Pick a different one.', username));
    }
    const reservedPrefix = RESERVED_USERNAME_PREFIXES.find((prefix) => username.toLowerCase().startsWith(prefix));
    if (reservedPrefix) {
        return invalid(
            l10n.t('Usernames starting with “{0}” are reserved by DocumentDB. Pick a different one.', reservedPrefix),
        );
    }
    return undefined;
}

// The image first creates the user by splicing the password into a JSON string, so a backslash
// escape such as `\n` changes the stored password. A leading `-` breaks startup like it does for
// usernames.
function getPasswordValidation(password: string): CredentialValidation | undefined {
    const invalid = (message: string): CredentialValidation => ({ field: 'password', message });
    if (CONTROL_CHARACTER.test(password)) {
        return invalid(l10n.t('Password must not contain control characters.'));
    }
    if (WHITESPACE.test(password.charAt(0))) {
        return invalid(l10n.t('Password must not start or end with a space.'));
    }
    if (WHITESPACE.test(password.charAt(password.length - 1))) {
        return { ...invalid(l10n.t('Password must not start or end with a space.')), transient: true };
    }
    if (password.includes('\\')) {
        return invalid(l10n.t('Password must not contain a backslash (\\).'));
    }
    if (password.startsWith('-')) {
        return invalid(l10n.t('Password must not start with a hyphen (-).'));
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return invalid(l10n.t('Password must be 256 characters or fewer.'));
    }
    return undefined;
}

/** Printable ASCII always passes SASLprep unchanged, so only other passwords need the host's check. */
export function needsPasswordEncodingCheck(password: string): boolean {
    return !/^[\x20-\x7e]*$/.test(password);
}

/** The SASLprep state of the current password. A verdict for an earlier password never applies to it. */
export function getPasswordEncodingState(input: {
    readonly useCustomCredentials: boolean;
    readonly password: string;
    readonly lastCheck: PasswordEncodingCheck | undefined;
}): PasswordEncodingProblem | 'ok' | 'checking' {
    if (!input.useCustomCredentials || !needsPasswordEncodingCheck(input.password)) {
        return 'ok';
    }
    return input.lastCheck?.password === input.password ? input.lastCheck.result : 'checking';
}

export function describePasswordEncodingProblem(problem: PasswordEncodingProblem): CredentialValidation {
    return {
        field: 'password',
        message:
            problem === 'rightToLeft'
                ? l10n.t(
                      "A password with right-to-left letters, such as Arabic or Hebrew, must start and end with one and can't also contain left-to-right letters.",
                  )
                : l10n.t(
                      "Password contains a character DocumentDB doesn't support, such as an emoji or a newer symbol.",
                  ),
    };
}
