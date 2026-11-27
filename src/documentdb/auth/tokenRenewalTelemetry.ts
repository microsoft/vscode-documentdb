/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

export interface EntraTokenLookupObservation {
    readonly outcome: 'returned' | 'noSession' | 'identityMismatch' | 'failed' | 'timedOut';
    readonly lifetimeSeconds?: number;
}

export function emitTokenRenewal(
    surface: 'extension' | 'shell' | 'playground',
    { outcome, lifetimeSeconds }: EntraTokenLookupObservation,
): void {
    void callWithTelemetryAndErrorHandling('connection.tokenRenewal', (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.surface = surface;
        context.telemetry.properties.renewalOutcome = outcome;
        if (
            outcome === 'returned' &&
            lifetimeSeconds !== undefined &&
            Number.isFinite(lifetimeSeconds) &&
            lifetimeSeconds > 0
        ) {
            context.telemetry.measurements.tokenLifetimeSeconds = lifetimeSeconds;
        }
    }).catch(() => {
        // Telemetry delivery must not affect authentication.
    });
}
