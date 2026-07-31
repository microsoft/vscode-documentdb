/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isKubernetesApiTimeoutError } from '../kubernetesApiTimeout';

/**
 * A coarse category for a Kubernetes API/connection failure.
 *
 * Derived once from the raw error so every discovery-tree view classifies
 * failures the same way; callers map the category to view-specific wording.
 */
export type KubernetesConnectionErrorCategory =
    | 'timeout'
    | 'unauthorized'
    | 'forbidden'
    | 'connectionRefused'
    | 'dnsFailure'
    | 'certificate'
    | 'notFound'
    | 'unknown';

/** User-facing summary and actionable hint for a connection error node. */
export interface ConnectionErrorCopy {
    summary: string;
    hint: string;
}

/**
 * Classifies a Kubernetes error into a single category. This is the one place
 * that inspects error names and messages, so views stay consistent instead of
 * each maintaining its own drifting chain of string checks.
 */
export function categorizeKubernetesConnectionError(error: unknown): KubernetesConnectionErrorCategory {
    if (isKubernetesApiTimeoutError(error)) {
        return 'timeout';
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const lower = errorMessage.toLowerCase();

    if (lower.includes('401') || lower.includes('unauthorized')) {
        return 'unauthorized';
    }
    if (lower.includes('403') || lower.includes('forbidden')) {
        return 'forbidden';
    }
    if (lower.includes('econnrefused') || lower.includes('connection refused')) {
        return 'connectionRefused';
    }
    if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
        return 'dnsFailure';
    }
    if (lower.includes('etimedout') || lower.includes('timeout') || lower.includes('timed out')) {
        return 'timeout';
    }
    if (lower.includes('certificate') || lower.includes('cert') || lower.includes('ssl') || lower.includes('tls')) {
        return 'certificate';
    }
    if (lower.includes('not found') || lower.includes('404')) {
        return 'notFound';
    }
    return 'unknown';
}

/**
 * Maps a classified error to user-facing copy.
 *
 * Transport-level failures (timeout, refused, DNS, certificate, not-found)
 * describe cluster reachability and read the same in every view, so their copy
 * lives here. The operation-specific cases — authentication failures and the
 * generic fallback — are supplied by the caller so a namespace view can say
 * "listing services" where a context view says "connecting".
 */
export function classifyKubernetesConnectionError(
    error: unknown,
    operationCopy: {
        unauthorized: ConnectionErrorCopy;
        forbidden: ConnectionErrorCopy;
        unknown: ConnectionErrorCopy;
    },
): ConnectionErrorCopy {
    const timedOut: ConnectionErrorCopy = {
        summary: vscode.l10n.t('Connection timed out'),
        hint: vscode.l10n.t(
            'The cluster did not respond in time. Check your network connection and firewall settings.',
        ),
    };

    switch (categorizeKubernetesConnectionError(error)) {
        case 'timeout':
            return timedOut;
        case 'unauthorized':
            return operationCopy.unauthorized;
        case 'forbidden':
            return operationCopy.forbidden;
        case 'connectionRefused':
            return {
                summary: vscode.l10n.t('Connection refused'),
                hint: vscode.l10n.t(
                    'The cluster may be stopped or unreachable. Verify the cluster is running and the server URL is correct.',
                ),
            };
        case 'dnsFailure':
            return {
                summary: vscode.l10n.t('Cluster not found (DNS resolution failed)'),
                hint: vscode.l10n.t(
                    'The server hostname could not be resolved. The cluster may have been deleted or the URL may be incorrect.',
                ),
            };
        case 'certificate':
            return {
                summary: vscode.l10n.t('Certificate error'),
                hint: vscode.l10n.t(
                    'The cluster certificate may have changed or expired. Update your kubeconfig with fresh credentials.',
                ),
            };
        case 'notFound':
            return {
                summary: vscode.l10n.t('Resource not found'),
                hint: vscode.l10n.t(
                    'The cluster or API endpoint may have been deleted. Verify your kubeconfig is up to date.',
                ),
            };
        case 'unknown':
        default:
            return operationCopy.unknown;
    }
}
