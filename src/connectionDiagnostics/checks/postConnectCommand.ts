/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTimeoutFinding, type Finding, type RunContext } from '@documentdb-js/connection-diagnostics';
import { MongoNetworkTimeoutError, MongoOperationTimeoutError, type MongoClient } from 'mongodb';
import { safeErrorName } from '../outputTrace';

export interface CommandFact {
    readonly command: string;
    /**
     * `signInRequired`: refused because the connection has not signed in; `denied`: refused although
     * it has (a permission). Server codes stay in `codeName` for the report only.
     */
    readonly outcome: 'ok' | 'denied' | 'signInRequired' | 'unsupported' | 'timedOut' | 'failed';
    readonly durationMs: number;
    readonly codeName?: string;
}

interface CommandObservation {
    readonly fact: CommandFact;
    readonly reply?: Record<string, unknown>;
    readonly errorName?: string;
    readonly errorCode?: number | string;
    readonly finding?: Finding<'check.timeout'>;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/**
 * A server's refusal to run a command before sign-in. The DocumentDB gateway says "Command
 * listDatabases is not allowed as the connection is not authenticated yet."; a MongoDB API server
 * with access control says "command listDatabases requires authentication". Only the classification
 * is kept; the message never leaves this function.
 */
const unauthenticatedMessage =
    /\bnot authenticated\b|\brequires authentication\b|\bauthentication (?:is )?required\b|\bunauthenticated\b/i;

/** Refused for lack of sign-in or permission: 13 `Unauthorized`, 18 `AuthenticationFailed`, or the message above. */
function isRefusal(error: unknown, code: unknown, codeName: string | undefined): boolean {
    if (code === 13 || code === 18 || codeName === 'Unauthorized' || codeName === 'AuthenticationFailed') {
        return true;
    }
    return error instanceof Error && unauthenticatedMessage.test(error.message);
}

/** Abort each command before moving on; late replies never contribute facts. */
export async function observePostConnectCommand(
    client: MongoClient,
    context: RunContext,
    signal: AbortSignal,
    checkId: string,
    command: string,
): Promise<CommandObservation> {
    signal.throwIfAborted();
    const clock = context.io.clock;
    const startedAt = clock.now();
    let { timeoutMs, source } = context.effectiveTimeout('postConnect');
    // CSOT overrides socketTimeoutMS in the driver; never lengthen a connection's own bound.
    for (const bound of [client.options?.timeoutMS, client.options?.socketTimeoutMS]) {
        if (
            typeof bound === 'number' &&
            Number.isFinite(bound) &&
            bound > 0 &&
            (timeoutMs === null || bound < timeoutMs)
        ) {
            timeoutMs = bound;
            source = 'connection';
        }
    }
    const controller = new AbortController();
    let timedOut = false;
    let timer: unknown;
    let hasTimer = false;
    const aborted = new Promise<never>((_resolve, reject): void => {
        controller.signal.addEventListener(
            'abort',
            (): void =>
                reject(
                    controller.signal.reason instanceof Error
                        ? controller.signal.reason
                        : new Error('Operation aborted', { cause: controller.signal.reason }),
                ),
            { once: true },
        );
    });
    const onAbort = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs !== null) {
        timer = clock.setTimeout((): void => {
            timedOut = true;
            controller.abort(new Error('Post-connect command timed out'));
        }, timeoutMs);
        hasTimer = true;
    }
    try {
        const reply: unknown = await Promise.race([
            client
                .db('admin')
                .command(
                    { [command]: 1 },
                    { signal: controller.signal, ...(timeoutMs === null ? {} : { timeoutMS: timeoutMs }) },
                ),
            aborted,
        ]);
        signal.throwIfAborted();
        return { fact: { command, outcome: 'ok', durationMs: clock.now() - startedAt }, reply: asRecord(reply) };
    } catch (error) {
        signal.throwIfAborted();
        const fields = asRecord(error);
        const code = fields?.code;
        const codeName =
            typeof fields?.codeName === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(fields.codeName)
                ? fields.codeName
                : undefined;
        const fact = { command, durationMs: clock.now() - startedAt, ...(codeName === undefined ? {} : { codeName }) };
        if (
            timeoutMs !== null &&
            (timedOut ||
                error instanceof MongoOperationTimeoutError ||
                error instanceof MongoNetworkTimeoutError ||
                code === 50 ||
                code === 262)
        ) {
            return {
                fact: { ...fact, outcome: 'timedOut' },
                finding: createTimeoutFinding({
                    operation: `${checkId}.${command}`,
                    timeoutMs,
                    source: source ?? 'check',
                }),
            };
        }
        if (isRefusal(error, code, codeName)) {
            // Only a run that is known not to have signed in (No authentication) reads as needing
            // sign-in; any other refusal is a permission.
            const signedOut = context.getResult('authenticate')?.facts.authenticated === false;
            return { fact: { ...fact, outcome: signedOut ? 'signInRequired' : 'denied' } };
        }
        if (
            code === 59 ||
            code === 115 ||
            codeName === 'CommandNotFound' ||
            codeName === 'CommandNotSupported' ||
            codeName === 'NotImplemented'
        ) {
            return { fact: { ...fact, outcome: 'unsupported' } };
        }
        const errorName =
            error instanceof Error && /^Mongo[A-Za-z]{1,60}Error$/.test(error.name) ? error.name : safeErrorName(error);
        let errorCode: number | string | undefined;
        if (typeof code === 'number' && Number.isInteger(code)) {
            errorCode = code;
        } else if (
            typeof code === 'string' &&
            [
                'ENOTFOUND',
                'EAI_AGAIN',
                'ECONNRESET',
                'ECONNREFUSED',
                'ETIMEDOUT',
                'ENETUNREACH',
                'EHOSTUNREACH',
                'EPIPE',
                'EPROTO',
            ].includes(code)
        ) {
            errorCode = code;
        }
        return { fact: { ...fact, outcome: 'failed' }, errorName, ...(errorCode === undefined ? {} : { errorCode }) };
    } finally {
        signal.removeEventListener('abort', onAbort);
        if (hasTimer) {
            clock.clearTimeout(timer);
        }
    }
}
