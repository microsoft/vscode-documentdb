/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Middleware } from '@kubernetes/client-node';
import * as vscode from 'vscode';

export const KUBERNETES_API_TIMEOUT_MS = 30_000;

const KUBERNETES_API_TIMEOUT_SECONDS = KUBERNETES_API_TIMEOUT_MS / 1000;
const KUBERNETES_API_TIMEOUT_ERROR_NAME = 'KubernetesApiTimeoutError';

export const kubernetesApiTimeoutMiddleware: Middleware = {
    async pre(context) {
        // A signal cannot be reused after it aborts. Create a fresh deadline for
        // every generated-client request when the middleware runs.
        context.setSignal(AbortSignal.timeout(KUBERNETES_API_TIMEOUT_MS));
        return context;
    },
    async post(context) {
        return context;
    },
};

export function isKubernetesApiTimeoutError(error: unknown): error is Error {
    return error instanceof Error && error.name === KUBERNETES_API_TIMEOUT_ERROR_NAME;
}

export function getKubernetesApiErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    if (isRecord(error)) {
        const message = error.message;
        if (typeof message === 'string') {
            return message;
        }

        const body = error.body;
        if (typeof body === 'string') {
            return body;
        }
        if (isRecord(body) && typeof body.message === 'string') {
            return body.message;
        }
    }

    return String(error);
}

export function createKubernetesApiOperationError(message: string, cause: unknown): Error {
    const error = new Error(message, { cause });
    if (isKubernetesApiTimeoutError(cause)) {
        error.name = KUBERNETES_API_TIMEOUT_ERROR_NAME;
    }
    return error;
}

export function normalizeKubernetesApiError(error: unknown): Error {
    if (isKubernetesApiTimeoutError(error)) {
        return error;
    }

    if (!isAbortSignalTimeoutError(error)) {
        // Wrap non-Error values (e.g. the generated client's record-shaped API
        // exceptions) without discarding the message getKubernetesApiErrorMessage
        // can extract from them — String(error) would collapse to "[object Object]".
        return error instanceof Error ? error : new Error(getKubernetesApiErrorMessage(error), { cause: error });
    }

    const timeoutError = new Error(
        vscode.l10n.t('Operation timed out after {0} seconds.', String(KUBERNETES_API_TIMEOUT_SECONDS)),
        { cause: error },
    );
    timeoutError.name = KUBERNETES_API_TIMEOUT_ERROR_NAME;
    return timeoutError;
}

function isAbortSignalTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    // The generated client uses node-fetch v2, which reports our timed signal
    // as AbortError. TimeoutError covers runtimes that preserve
    // AbortSignal.timeout()'s native reason. Only normalize these names at
    // known generated-client request boundaries.
    return error.name === 'AbortError' || error.name === 'TimeoutError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
