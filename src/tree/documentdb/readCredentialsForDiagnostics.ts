/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import {
    ConnectionEndpointUnavailableError,
    ConnectionInputCancelledError,
    ConnectionSourceUnavailableError,
    type ConnectionDetailsSource,
    type DiagnosticCredentialRead,
} from './diagnosticCredentialRead';

function isTypedDiagnosticError(error: unknown): boolean {
    return (
        error instanceof ConnectionSourceUnavailableError ||
        error instanceof ConnectionEndpointUnavailableError ||
        error instanceof ConnectionInputCancelledError
    );
}

/**
 * Runs a node's credential read in diagnostic intent: its telemetry is still recorded, but errors are
 * neither displayed nor swallowed. Untyped failures are wrapped as {@link ConnectionSourceUnavailableError}
 * for `source`, so the caller sees which source failed without parsing messages.
 */
export async function readCredentialsForDiagnostics<T>(
    callbackId: string,
    source: ConnectionDetailsSource,
    read: DiagnosticCredentialRead,
    callback: (context: IActionContext) => Promise<T>,
): Promise<T | undefined> {
    read.signal.throwIfAborted();
    try {
        return await callWithTelemetryAndErrorHandling(callbackId, async (context: IActionContext): Promise<T> => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.suppressReportIssue = true;
            context.telemetry.properties.connectionIntent = 'diagnostic';
            return await callback(context);
        });
    } catch (error) {
        if (read.signal.aborted || isTypedDiagnosticError(error)) {
            throw error;
        }
        throw new ConnectionSourceUnavailableError(source, error);
    }
}

/** A VS Code cancellation token that fires when `signal` aborts, for an accepted diagnostic prompt. */
export function cancellationTokenFromSignal(signal: AbortSignal): vscode.Disposable & {
    readonly token: vscode.CancellationToken;
} {
    const source = new vscode.CancellationTokenSource();
    const onAbort = (): void => source.cancel();
    if (signal.aborted) {
        source.cancel();
    } else {
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return {
        token: source.token,
        dispose(): void {
            signal.removeEventListener('abort', onAbort);
            source.dispose();
        },
    };
}
