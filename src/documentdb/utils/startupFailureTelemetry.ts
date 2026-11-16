/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { telemetryErrorTypeOf } from '../../utils/telemetryErrorType';

/**
 * Why a `connect.startup` failed, derived from the original error object. Ordered from most to
 * least specific: when several errors in a cause chain match, the most specific category wins.
 */
export const STARTUP_FAILURE_CATEGORIES = [
    'credentialsUnavailable',
    'entraToken',
    'authentication',
    'authorization',
    'invalidConnectionString',
    'unsupported',
    'tls',
    'dns',
    'timeout',
    'network',
    'serverSelection',
    'other',
] as const;

export type StartupFailureCategory = (typeof STARTUP_FAILURE_CATEGORIES)[number];

/** Which code path asked for the client; recorded as `startupTrigger` on `connect.startup`. */
export type ClientStartupTrigger =
    | 'treeConnect'
    | 'treeChildren'
    | 'collectionView'
    | 'documentView'
    | 'clusterDashboard'
    | 'clusterDashboardPoll'
    | 'playgroundCompletion'
    | 'other';

export interface StartupFailureHints {
    /** No cached credentials existed for the cluster, so the startup never chose an auth method. */
    readonly credentialsMissing?: boolean;
}

const MAX_CAUSE_DEPTH = 5;
const MAX_SERVER_ERRORS = 8;

const CREDENTIALS_UNAVAILABLE_NAMES: ReadonlySet<string> = new Set([
    'AuthInputUnavailableError',
    'MongoMissingCredentialsError',
]);
const ENTRA_TOKEN_NAMES: ReadonlySet<string> = new Set([
    'EntraDestinationRejectedError',
    'TokenResourceResolutionError',
    'CredentialUnavailableError',
    'AuthenticationRequiredError',
    'AggregateAuthenticationError',
    'AuthenticationError',
]);
const DNS_CODES: ReadonlySet<string> = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENODATA',
    'ESERVFAIL',
    'EREFUSED',
    'ETIMEOUT',
]);
const TLS_CODES: ReadonlySet<string> = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
const TLS_CODE_PREFIX = /^(CERT_|UNABLE_TO_|ERR_TLS_|ERR_SSL_)/;
const TIMEOUT_CODES: ReadonlySet<string> = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);
const NETWORK_CODES: ReadonlySet<string> = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'EADDRNOTAVAIL',
]);
const SERVER_CODE_UNAUTHORIZED = 13;
const SERVER_CODE_AUTHENTICATION_FAILED = 18;
const SERVER_CODE_MECHANISM_UNAVAILABLE = 334;

function field(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function nameOf(value: unknown): string | undefined {
    const name = field(value, 'name');
    return typeof name === 'string' ? name : undefined;
}

/** The category one error object shows on its own, ignoring its causes. */
function categoryOfNode(node: unknown): StartupFailureCategory | undefined {
    const name = nameOf(node);
    const code = field(node, 'code');
    const codeName = field(node, 'codeName');

    if (name !== undefined && CREDENTIALS_UNAVAILABLE_NAMES.has(name)) {
        return 'credentialsUnavailable';
    }
    if (name !== undefined && ENTRA_TOKEN_NAMES.has(name)) {
        return 'entraToken';
    }
    if (code === SERVER_CODE_AUTHENTICATION_FAILED || codeName === 'AuthenticationFailed') {
        return 'authentication';
    }
    if (code === SERVER_CODE_UNAUTHORIZED || codeName === 'Unauthorized') {
        return 'authorization';
    }
    if (name === 'MongoInvalidArgumentError') {
        // The driver's own OIDC host check is a Microsoft Entra ID configuration problem.
        const message = field(node, 'message');
        return typeof message === 'string' && message.includes('OIDC') ? 'entraToken' : 'invalidConnectionString';
    }
    if (name === 'MongoParseError') {
        return 'invalidConnectionString';
    }
    if (
        name === 'MongoCompatibilityError' ||
        code === SERVER_CODE_MECHANISM_UNAVAILABLE ||
        codeName === 'MechanismUnavailable'
    ) {
        return 'unsupported';
    }
    if (typeof code === 'string') {
        if (TLS_CODES.has(code) || TLS_CODE_PREFIX.test(code)) {
            return 'tls';
        }
        if (DNS_CODES.has(code)) {
            return 'dns';
        }
        if (TIMEOUT_CODES.has(code)) {
            return 'timeout';
        }
        if (NETWORK_CODES.has(code)) {
            return 'network';
        }
    }
    if (name === 'MongoNetworkTimeoutError' || name === 'MongoOperationTimeoutError') {
        return 'timeout';
    }
    if (name === 'MongoNetworkError') {
        return 'network';
    }
    if (name === 'MongoServerSelectionError') {
        return 'serverSelection';
    }
    return undefined;
}

function mostSpecific(categories: readonly StartupFailureCategory[]): StartupFailureCategory | undefined {
    let best: StartupFailureCategory | undefined;
    for (const category of categories) {
        if (best === undefined || STARTUP_FAILURE_CATEGORIES.indexOf(category) < STARTUP_FAILURE_CATEGORIES.indexOf(best)) {
            best = category;
        }
    }
    return best;
}

/**
 * The category the per-server errors of a server selection failure agree on. When servers failed
 * for different reasons, none of them is THE cause, so the caller keeps `serverSelection`.
 */
function agreedServerCategory(selectionError: unknown, depth: number): StartupFailureCategory | undefined {
    const servers = field(field(selectionError, 'reason'), 'servers');
    if (!(servers instanceof Map)) {
        return undefined;
    }
    const categories = new Set<StartupFailureCategory | undefined>();
    let inspected = 0;
    for (const description of servers.values()) {
        if (inspected >= MAX_SERVER_ERRORS) {
            break;
        }
        const serverError = field(description, 'error');
        if (serverError === undefined || serverError === null) {
            continue;
        }
        inspected++;
        categories.add(categoryOfChain(serverError, depth + 1));
    }
    const [only] = categories;
    return categories.size === 1 ? only : undefined;
}

function categoryOfChain(error: unknown, depth: number): StartupFailureCategory | undefined {
    const categories: StartupFailureCategory[] = [];
    for (
        let current = error, level = 0;
        current !== undefined && current !== null && level < MAX_CAUSE_DEPTH;
        current = field(current, 'cause'), level++
    ) {
        const category = categoryOfNode(current);
        if (category !== undefined) {
            categories.push(category);
        }
        if (category === 'serverSelection' && depth < 2) {
            const serverCategory = agreedServerCategory(current, depth);
            if (serverCategory !== undefined) {
                categories.push(serverCategory);
            }
        }
    }
    return mostSpecific(categories);
}

/**
 * Classifies a failed client startup into a closed set. Reads only error classes and codes,
 * never reports messages, and answers `other` rather than guess.
 */
export function classifyStartupFailure(error: unknown, hints: StartupFailureHints = {}): StartupFailureCategory {
    if (hints.credentialsMissing) {
        return 'credentialsUnavailable';
    }
    return categoryOfChain(error, 0) ?? 'other';
}

/**
 * Records why a `connect.startup` failed. The property names avoid `error`/`exception` so
 * whole-error masking (`maskEntireErrorMessage`) keeps these allow-listed values.
 */
export function applyStartupFailureTelemetry(
    properties: ITelemetryContext['properties'],
    error: unknown,
    hints: StartupFailureHints = {},
): void {
    properties.startupFailureType = telemetryErrorTypeOf(error);
    // A failed Microsoft Entra ID sign-in or token request is already recorded by the auth handler.
    const entraFailed = properties.entraFailureKind !== undefined && properties.entraFailureKind !== 'none';
    const category = classifyStartupFailure(error, hints);
    properties.startupFailureCategory = entraFailed && category === 'other' ? 'entraToken' : category;
}
