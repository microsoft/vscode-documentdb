import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { ext } from '../../../extensionVariables';
import { valueOnTimeout } from '../../../utils/timeout';

interface LookupTimeout<T> {
    timeoutMs: number;
    fallbackValue: T;
    onTimeout?: () => void;
}

export interface TenantLookupResult {
    tenants: AzureTenant[];
    status: 'success' | 'timeout' | 'error';
}

const knownErrorNames = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'RestError',
    'NotSignedInError',
    'AuthenticationError',
    'AuthenticationRequiredError',
    'CredentialUnavailableError',
    'AggregateAuthenticationError',
    'AbortError',
    'UserCancelledError',
]);

const knownErrorCodes = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'REQUEST_SEND_ERROR',
    'PARSE_ERROR',
    'InvalidAuthenticationToken',
    'ExpiredAuthenticationToken',
    'AuthenticationFailed',
    'AuthorizationFailed',
    'InteractionRequiredAuthError',
    'interaction_required',
    'consent_required',
    'invalid_grant',
]);

function describeLookupError(error: unknown): string {
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

export async function traceTenantLookup<T extends boolean | AzureTenant[]>(
    operation: string,
    action: () => Promise<T>,
    timeout?: LookupTimeout<T>,
): Promise<T> {
    const label = `[Azure tenant lookup ${randomUUID()}] ${operation}`;
    const startTime = Date.now();
    let timedOut = false;
    let failed = false;

    ext.outputChannel.info(
        timeout
            ? l10n.t('{0}: started; timeout={1} ms.', label, timeout.timeoutMs)
            : l10n.t('{0}: started; no timeout.', label),
    );

    const tracedAction = async (): Promise<T> => {
        try {
            const result = await action();
            const summary =
                typeof result === 'boolean'
                    ? `signedIn=${result}`
                    : `tenants=${result.length}; accountsWithTenants=${new Set(result.map((tenant) => tenant.account.id)).size}`;
            ext.outputChannel.info(
                timedOut
                    ? l10n.t(
                          '{0}: completed after timeout in {1} ms; {2}. Result is not applied to the picker.',
                          label,
                          Date.now() - startTime,
                          summary,
                      )
                    : l10n.t('{0}: completed in {1} ms; {2}.', label, Date.now() - startTime, summary),
            );
            return result;
        } catch (error) {
            failed = true;
            ext.outputChannel.error(
                timedOut
                    ? l10n.t(
                          '{0}: failed after timeout in {1} ms; {2}.',
                          label,
                          Date.now() - startTime,
                          describeLookupError(error),
                      )
                    : l10n.t('{0}: failed in {1} ms; {2}.', label, Date.now() - startTime, describeLookupError(error)),
            );
            throw error;
        }
    };

    if (!timeout) {
        return await tracedAction();
    }

    const result = await valueOnTimeout<T | undefined>(timeout.timeoutMs, undefined, tracedAction);
    if (result !== undefined) {
        return result;
    }

    if (!failed) {
        timedOut = true;
        timeout.onTimeout?.();
        ext.outputChannel.warn(
            l10n.t(
                '{0}: timed out after {1} ms; using fallback ({2}). The underlying request has not been cancelled.',
                label,
                Date.now() - startTime,
                typeof timeout.fallbackValue === 'boolean' ? `signedIn=${timeout.fallbackValue}` : 'tenants=0',
            ),
        );
    }
    return timeout.fallbackValue;
}