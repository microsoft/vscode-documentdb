/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

/**
 * Helpers for detecting and recovering from URL-encoded passwords.
 *
 * Users sometimes paste a password copied from a connection-string URL and
 * forget to URL-decode it. The server then rejects the credentials because
 * the actual password characters differ from the encoded form (e.g. "p%40ss"
 * vs. "p@ss"). Rather than silently retrying — which could trip brute-force
 * lockouts on the server side — we show a one-time prompt and let the user
 * decide whether to retry with the decoded value.
 */

/** Matches a `%XX` percent-encoded byte. */
const URL_ENCODED_BYTE_PATTERN = /%[0-9A-Fa-f]{2}/;

/**
 * Returns the decoded password if `password` contains `%XX` sequences and
 * `decodeURIComponent` produces a different, non-empty string; otherwise
 * returns `undefined`. Intended as a hint — callers must never auto-apply
 * the decoded value without user consent.
 */
export function tryDecodeUrlEncodedPassword(password: string | undefined): string | undefined {
    if (!password || !URL_ENCODED_BYTE_PATTERN.test(password)) {
        return undefined;
    }

    let decoded: string;
    try {
        decoded = decodeURIComponent(password);
    } catch {
        return undefined;
    }

    if (decoded.length === 0 || decoded === password) {
        return undefined;
    }

    return decoded;
}

/**
 * Telemetry property keys reported by {@link showConnectionFailedAndMaybeOfferDecodedRetry}.
 * No password material is ever recorded — only boolean indicators about the flow.
 */
export const UrlEncodedPasswordTelemetry = {
    /** `true` when the original password looked URL-encoded and a decoded variant was available. */
    Detected: 'urlDecodePasswordDetected',
    /** `true` when the user was shown the "Retry with decoded password" button. */
    Offered: 'urlDecodePasswordOffered',
    /** `true` when the user clicked the retry button. */
    Accepted: 'urlDecodePasswordAccepted',
} as const;

export interface ShowConnectionFailedOptions {
    /** Display name of the cluster shown in the error dialog. */
    readonly clusterName: string;
    /** The password that was used for the failed connection attempt (may be undefined for non-password auth). */
    readonly password: string | undefined;
    /** Whether the failed attempt used password-based (native) auth. Retry is only offered for native auth. */
    readonly isNativeAuth: boolean;
    /** The error returned by the failed connection attempt. */
    readonly originalError: unknown;
    /** Action context used to record non-sensitive telemetry about the retry flow. */
    readonly context: IActionContext;
}

export interface ShowConnectionFailedResult {
    /**
     * Populated with the decoded password only when the user explicitly chose to retry.
     * Callers must mask this value via `context.valuesToMask` before use.
     */
    readonly decodedPassword?: string;
}

/**
 * Shows the "Failed to connect" modal. If the password looks URL-encoded, adds a
 * one-time "Retry with decoded password" button. Records telemetry about whether
 * the hint was offered and accepted.
 */
export async function showConnectionFailedAndMaybeOfferDecodedRetry(
    options: ShowConnectionFailedOptions,
): Promise<ShowConnectionFailedResult> {
    const { clusterName, password, isNativeAuth, originalError, context } = options;

    const decodedPassword = isNativeAuth ? tryDecodeUrlEncodedPassword(password) : undefined;
    const canOfferRetry = decodedPassword !== undefined;

    context.telemetry.properties[UrlEncodedPasswordTelemetry.Detected] = canOfferRetry ? 'true' : 'false';
    context.telemetry.properties[UrlEncodedPasswordTelemetry.Offered] = canOfferRetry ? 'true' : 'false';

    const errorMessage = originalError instanceof Error ? originalError.message : String(originalError);

    let detail =
        l10n.t('Revisit connection details and try again.') +
        '\n\n' +
        l10n.t('Error: {error}', { error: errorMessage });

    const retryButton = l10n.t('Retry with Decoded Password');
    const buttons: string[] = [];

    if (canOfferRetry) {
        detail += '\n\n' + l10n.t('Your password appears to be URL-encoded.');
        buttons.push(retryButton);
    }

    const selected = await vscode.window.showErrorMessage(
        l10n.t('Failed to connect to "{cluster}"', { cluster: clusterName }),
        { modal: true, detail },
        ...buttons,
    );

    const accepted = canOfferRetry && selected === retryButton;
    context.telemetry.properties[UrlEncodedPasswordTelemetry.Accepted] = accepted ? 'true' : 'false';

    return { decodedPassword: accepted ? decodedPassword : undefined };
}
