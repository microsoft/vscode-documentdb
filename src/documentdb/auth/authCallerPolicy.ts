/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-only callbacks that report the authentication phases in the order they really happen.
 *
 * Observers never change the auth flow: their exceptions are caught and ignored.
 */
export interface AuthPhaseObserver {
    onSignInConfigurationResolved?(info: {
        readonly details: Readonly<Record<string, string | boolean>>;
        readonly cloudCategory: string;
        readonly tokenResourceReason: string;
        readonly allowedHosts: readonly string[];
    }): void;
    onSignInConfigurationFailed?(info: {
        readonly kind: string;
        readonly details: Readonly<Record<string, string | boolean>>;
    }): void;
    onTokenStarted?(): void;
    /** Host-only: the access token is passed so the caller can summarize claims immediately; never store or log it. */
    onTokenAcquired?(info: {
        readonly accessToken: string;
        readonly account?: { readonly label: string; readonly id: string };
        readonly tenantId?: string;
    }): void;
    onTokenFailed?(error: unknown): void;
}

/**
 * How the caller wants authentication to behave. Ordinary connects are interactive; connection
 * diagnostics are not, and never open sign-in UI.
 */
export interface AuthCallerPolicy {
    readonly interactive: boolean;
    readonly observer?: AuthPhaseObserver;
}

/**
 * A non-interactive caller needs an input that only a prompt could supply. This is not an
 * authentication failure and is never recorded as one.
 */
export class AuthInputUnavailableError extends Error {
    constructor(public readonly missing: 'entraSession' | 'password' | 'method') {
        super(`Authentication input unavailable without prompting: ${missing}`);
        this.name = 'AuthInputUnavailableError';
    }
}

export function notifyAuthPhaseObserver(
    observer: AuthPhaseObserver | undefined,
    notify: (observer: AuthPhaseObserver) => void,
): void {
    if (!observer) {
        return;
    }
    try {
        notify(observer);
    } catch {
        // Observers never change the auth flow.
    }
}
