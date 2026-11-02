/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type AwsDiscoveryFailure } from '../types';

export class AwsInteractionRequiredError extends Error {
    constructor() {
        super(vscode.l10n.t('AWS sign-in requires interaction. Verify this credential again, or renew its AWS profile session.'));
        this.name = 'AwsInteractionRequiredError';
    }
}

export class AwsValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AwsValidationError';
    }
}

export function abortError(): Error {
    const error = new Error(vscode.l10n.t('AWS operation cancelled.'));
    error.name = 'AbortError';
    return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw abortError();
    }
}

export function errorName(error: unknown): string {
    if (error instanceof Error) {
        return error.name;
    }
    if (typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string') {
        return error.name;
    }
    return '';
}

export function failureKind(error: unknown): AwsDiscoveryFailure['kind'] {
    const name = errorName(error);
    if (/AccessDenied|UnauthorizedOperation|Forbidden/.test(name)) {
        return 'permission';
    }
    if (/InteractionRequired|ExpiredToken|InvalidClientToken|UnrecognizedClient|CredentialsProvider|TokenProvider|Unauthorized|InvalidGrant|InvalidIdentity|SignatureDoesNotMatch/.test(name)) {
        return 'auth';
    }
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (/Timeout|Networking|RequestTimeout/.test(name) || (typeof code === 'string' && /^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)/.test(code))) {
        return 'network';
    }
    return 'other';
}

/** Never propagate SDK messages, causes or request objects across the host/UI boundary. */
export function safeAwsError(error: unknown): Error {
    if (errorName(error) === 'AbortError') {
        return abortError();
    }
    if (error instanceof AwsInteractionRequiredError || error instanceof AwsValidationError) {
        return error;
    }
    switch (failureKind(error)) {
        case 'auth':
            return new AwsInteractionRequiredError();
        case 'permission':
            return new Error(vscode.l10n.t('AWS denied this operation. Check the credential and its DocumentDB discovery permissions in this region.'));
        case 'network':
            return new Error(vscode.l10n.t('Unable to reach AWS. Check your network, proxy settings, and selected region, then retry.'));
        default:
            return new Error(vscode.l10n.t('The AWS operation failed. Check your sign-in and selected region, then retry.'));
    }
}

/** Waiters can cancel without cancelling a credential refresh shared with other callers. */
export async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    if (!signal) {
        return operation;
    }
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = (): void => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([operation, cancelled]);
    } finally {
        if (onAbort) {
            signal.removeEventListener('abort', onAbort);
        }
    }
}
