/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emittedProperties: Record<string, string> = {};

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName: string, callback: (context: unknown) => void): Promise<void> => {
            callback({
                errorHandling: {},
                telemetry: { properties: emittedProperties, measurements: {} },
            });
        },
    ),
}));

import { reportManagedIdentityFailureReason } from './managedIdentityTelemetry';

describe('managed identity telemetry', () => {
    beforeEach(() => {
        for (const key of Object.keys(emittedProperties)) {
            delete emittedProperties[key];
        }
    });

    it('includes the token-attempt correlation ID on failure events', () => {
        reportManagedIdentityFailureReason('endpointUnreachable', undefined, 'correlation-id');

        expect(emittedProperties).toMatchObject({
            result: 'Failed',
            managedIdentityFailureReason: 'endpointUnreachable',
            managedIdentityKind: 'system',
            managedIdentityTokenCorrelationId: 'correlation-id',
        });
    });
});
