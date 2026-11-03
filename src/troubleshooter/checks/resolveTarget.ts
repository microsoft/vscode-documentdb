/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type Check,
    type CheckOutcome,
    type Finding,
    type RunContext,
} from '@documentdb-js/connectivity-troubleshooter';
import { type EphemeralClusterCredentials } from '../../tree/documentdb/ClusterItemBase';
import {
    ConnectionEndpointUnavailableError,
    ConnectionInputCancelledError,
    ConnectionSourceUnavailableError,
    type ConnectionDetailsSource,
} from '../../tree/documentdb/diagnosticCredentialRead';
import { safeErrorName } from '../outputTrace';
import { type FindingCode, type TroubleshootTarget } from '../types';

/** Why a source that holds the connection details could not be read. Bounded; safe for reports. */
export type SourceInaccessibleReason = 'signInRequired' | 'accessDenied' | 'unreachable' | 'notConnectable' | 'other';

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'REQUEST_SEND_ERROR',
    'UND_ERR_CONNECT_TIMEOUT',
]);

const SIGN_IN_ERROR_NAMES: ReadonlySet<string> = new Set([
    'AuthenticationError',
    'AuthenticationRequiredError',
    'CredentialUnavailableError',
    'NotSignedInError',
]);

function field(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** An HTTP status from Azure SDK (`statusCode`), Kubernetes client (`code`) or fetch-style (`status`) errors. */
function httpStatus(error: unknown): number | undefined {
    for (const candidate of [error, field(error, 'response')]) {
        for (const key of ['statusCode', 'status', 'code']) {
            const value = field(candidate, key);
            if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600) {
                return value;
            }
        }
    }
    return undefined;
}

function networkCode(error: unknown): boolean {
    for (
        let current = error, depth = 0;
        current !== undefined && depth < 3;
        current = field(current, 'cause'), depth++
    ) {
        const code = field(current, 'code');
        if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
            return true;
        }
    }
    return false;
}

function finding(code: FindingCode, data: Readonly<Record<string, unknown>>, text: string): Finding<FindingCode> {
    return { code, severity: 'error', data, detail: { language: 'en', text } };
}

function failed(found: Finding<FindingCode>): CheckOutcome<FindingCode> {
    return { status: 'fail', facts: { ...found.data }, findings: [found] };
}

/**
 * Maps a diagnostic read's failure to one typed outcome (review R2, option A). Only bounded fields
 * reach the result: the source, a classified reason, an allow-listed error name and an HTTP status.
 * Messages are never copied, because Azure and Kubernetes messages name subscriptions and resources.
 */
export function classifyResolutionFailure(error: unknown): Finding<FindingCode> {
    if (error instanceof ConnectionInputCancelledError) {
        return finding('target.inputCancelled', { input: error.input }, 'The port prompt was closed without a value.');
    }
    if (error instanceof ConnectionEndpointUnavailableError) {
        return finding(
            'target.endpointMissing',
            { source: error.source, reason: error.reason },
            'The connection source has no endpoint to connect to.',
        );
    }
    const source: ConnectionDetailsSource = error instanceof ConnectionSourceUnavailableError ? error.source : 'other';
    if (error instanceof ConnectionSourceUnavailableError && error.reason === 'notConnectable') {
        return finding(
            'target.sourceInaccessible',
            { source, reason: 'notConnectable' },
            'The source reports that the cluster cannot accept connections.',
        );
    }
    const cause = error instanceof ConnectionSourceUnavailableError ? error.sourceError : error;
    const status = httpStatus(cause);
    const evidence = { errorName: safeErrorName(cause), ...(status === undefined ? {} : { statusCode: status }) };
    if (status === 404) {
        return finding(
            'target.notFound',
            { source, ...evidence },
            'The source reports that the target does not exist.',
        );
    }
    let reason: SourceInaccessibleReason = 'other';
    if (status === 401 || (cause instanceof Error && SIGN_IN_ERROR_NAMES.has(cause.name))) {
        reason = 'signInRequired';
    } else if (status === 403) {
        reason = 'accessDenied';
    } else if (networkCode(cause)) {
        reason = 'unreachable';
    }
    return finding(
        'target.sourceInaccessible',
        { source, reason, ...evidence },
        'The connection details could not be read from their source.',
    );
}

/**
 * Reads the target's connection details as the run's first connection step (design §4.3, review
 * R2 option A): inside the runner, so the whole-run timeout and cancellation cover it and its
 * outcome is a row and a report entry rather than a pre-run error.
 *
 * It declares no timeout kind of its own: the read can include the Azure VM port prompt, so only the
 * whole-run timeout bounds it. On cancel or timeout the read is abandoned (decision 0017); a late
 * settlement is ignored and the node's read performs no side effect after its signal aborts.
 */
export function createResolveTargetCheck(
    target: TroubleshootTarget,
    onResolved: (credentials: EphemeralClusterCredentials) => void,
    onFailed: (error: unknown) => void,
): Check<RunContext, FindingCode> {
    return {
        id: 'resolveTarget',
        scope: 'run',
        async run(_context, signal): Promise<CheckOutcome<FindingCode>> {
            let credentials: EphemeralClusterCredentials | undefined;
            try {
                credentials = await target.getCredentials({ signal });
            } catch (error) {
                signal.throwIfAborted();
                onFailed(error);
                return failed(classifyResolutionFailure(error));
            }
            signal.throwIfAborted();
            if (!credentials) {
                return failed(
                    finding('target.notFound', { source: 'savedConnection' }, 'The connection no longer exists.'),
                );
            }
            if (!credentials.connectionString.trim()) {
                return failed(
                    finding(
                        'target.endpointMissing',
                        { source: 'other', reason: 'notProvided' },
                        'The connection has no connection string.',
                    ),
                );
            }
            onResolved(credentials);
            return { status: 'pass', facts: {}, findings: [] };
        },
    };
}
