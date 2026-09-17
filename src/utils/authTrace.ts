import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { ext } from '../extensionVariables';

const knownErrorNames = new Set([
    'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'RestError', 'NotSignedInError',
    'AuthenticationError', 'AuthenticationRequiredError', 'CredentialUnavailableError',
    'AggregateAuthenticationError', 'AbortError', 'UserCancelledError', 'GoBackError',
]);

const knownErrorCodes = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
    'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
    'REQUEST_SEND_ERROR', 'PARSE_ERROR', 'InvalidAuthenticationToken', 'ExpiredAuthenticationToken',
    'AuthenticationFailed', 'AuthorizationFailed', 'InteractionRequiredAuthError',
    'interaction_required', 'consent_required', 'invalid_grant',
]);

export function describeAuthError(error: unknown): string {
    const errorName = error instanceof Error && knownErrorNames.has(error.name) ? error.name : 'unknown';
    const errorCode =
        typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined;
    const code = errorCode && knownErrorCodes.has(errorCode) ? errorCode : 'unknown';
    const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    const httpStatus =
        typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
            ? statusCode
            : 'unknown';
    const aadstsCode = error instanceof Error ? /\bAADSTS\d{5,9}\b/.exec(error.message)?.[0] : undefined;
    return `type=${errorName}; code=${code}; httpStatus=${httpStatus}; aadsts=${aadstsCode ?? 'none'}`;
}

type AuthTraceDetails = Readonly<Record<string, string | number | boolean>>;

export function traceAuthFlow(operation: string, details: AuthTraceDetails, correlationId?: string): void {
    ext.outputChannel.info(
        l10n.t('[Authentication {0}] {1}: {2}', correlationId ?? 'flow', operation, JSON.stringify(details)),
    );
}

export async function traceAuthOperation<T>(
    operation: string,
    action: () => Promise<T>,
    details: AuthTraceDetails = {},
    correlationId: string = randomUUID(),
): Promise<T> {
    const startedAt = Date.now();
    traceAuthFlow(operation, { ...details, outcome: 'started' }, correlationId);
    try {
        const result = await action();
        traceAuthFlow(operation, { outcome: 'completed', durationMs: Date.now() - startedAt }, correlationId);
        return result;
    } catch (error) {
        ext.outputChannel.error(
            l10n.t(
                '[Authentication {0}] {1}: failed or cancelled after {2} ms; {3}.',
                correlationId,
                operation,
                Date.now() - startedAt,
                describeAuthError(error),
            ),
        );
        throw error;
    }
}