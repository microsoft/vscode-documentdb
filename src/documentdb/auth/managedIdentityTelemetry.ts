/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { classifyManagedIdentityError, type ManagedIdentityFailureReason } from './managedIdentityErrors';

/**
 * Reports why a managed identity token could not be acquired.
 *
 * This is a dedicated event rather than a property on `connect`, because the failure happens inside
 * the driver's OIDC callback: by the time the error reaches a connect handler the driver has wrapped
 * it and the classification is no longer recoverable from the message, which is localized by then.
 *
 * The client ID is never emitted. It is not a secret, but it is a stable tenant-scoped identifier and
 * no analysis question needs it.
 */
export function reportManagedIdentityTokenFailure(error: unknown, clientId: string | undefined): void {
    reportManagedIdentityFailureReason(classifyManagedIdentityError(error), clientId);
}

/** Reports a failure whose cause is already known, without going through error classification. */
export function reportManagedIdentityFailureReason(
    reason: ManagedIdentityFailureReason,
    clientId: string | undefined,
): void {
    void callWithTelemetryAndErrorHandling('connect.managedIdentityToken', (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.managedIdentityFailureReason = reason;
        context.telemetry.properties.managedIdentityKind = clientId ? 'user' : 'system';
    });
}
