/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import {
    MongoNetworkError,
    MongoParseError,
    MongoServerError,
    MongoServerSelectionError,
    type TopologyDescription,
} from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { allowListedErrorType, innermostCauseTypeOf } from '../../utils/telemetryErrorType';
import { applyStartupFailureTelemetry, classifyStartupFailure } from './startupFailureTelemetry';

vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    // `parseError` needs `CancellationError`, which the shared mock does not provide.
    class CancellationError extends Error {}
    return { ...actual, CancellationError, default: { ...(actual.default as object), CancellationError } };
});

function nodeError(code: string): Error {
    return Object.assign(new Error(`getaddrinfo ${code} private-host.example.com`), { code });
}

function selectionError(...serverErrors: Error[]): MongoServerSelectionError {
    const servers = new Map(serverErrors.map((error, index) => [`private-host-${index}:27017`, { error }]));
    return new MongoServerSelectionError('Server selection timed out after 30000 ms', {
        servers,
    } as unknown as TopologyDescription);
}

describe('allowListedErrorType', (): void => {
    it.each([
        ['MongoServerSelectionError', 'MongoServerSelectionError'],
        ['ENOTFOUND', 'ENOTFOUND'],
        ['11000', '11000'],
        ['18', '18'],
        ['Connection to private-host failed', 'other'],
        ['user@example.com', 'other'],
        ['1234567', 'other'],
        ['0f8fad5b-d9cb-469f-a165-70867728950e', 'other'],
        ['', 'other'],
        [undefined, 'other'],
    ])('keeps %j as %j', (type: string | undefined, expected: string): void => {
        expect(allowListedErrorType(type)).toBe(expected);
    });
});

describe('innermostCauseTypeOf', (): void => {
    it('returns the innermost specific cause type and skips a plain Error wrapper', (): void => {
        const serverError = new MongoServerError({ message: 'E11000 duplicate key', code: 11000 });
        const wrapper = new Error('Insert failed', { cause: new Error('Wrapped', { cause: serverError }) });
        expect(innermostCauseTypeOf(wrapper)).toBe('11000');
    });

    it('is undefined without a cause', (): void => {
        expect(innermostCauseTypeOf(new Error('no cause'))).toBeUndefined();
    });
});

describe('classifyStartupFailure', (): void => {
    it.each([
        ['server code 18', new MongoServerError({ message: 'Authentication failed.', code: 18 }), 'authentication'],
        ['server code 13', new MongoServerError({ message: 'not authorized', code: 13 }), 'authorization'],
        ['ENOTFOUND', nodeError('ENOTFOUND'), 'dns'],
        ['ECONNREFUSED', nodeError('ECONNREFUSED'), 'network'],
        ['ETIMEDOUT', nodeError('ETIMEDOUT'), 'timeout'],
        ['self-signed certificate', nodeError('SELF_SIGNED_CERT_IN_CHAIN'), 'tls'],
        ['an expired certificate', nodeError('CERT_HAS_EXPIRED'), 'tls'],
        ['MongoParseError', new MongoParseError('Invalid scheme'), 'invalidConnectionString'],
        ['a wrapped DNS failure', new MongoNetworkError('failed', { cause: nodeError('ENOTFOUND') }), 'dns'],
        ['server selection without server errors', selectionError(), 'serverSelection'],
        [
            'server selection where every server failed DNS',
            selectionError(
                new MongoNetworkError('a', { cause: nodeError('ENOTFOUND') }),
                new MongoNetworkError('b', { cause: nodeError('ENOTFOUND') }),
            ),
            'dns',
        ],
        [
            'server selection where servers failed differently',
            selectionError(nodeError('ENOTFOUND'), nodeError('ECONNREFUSED')),
            'serverSelection',
        ],
        ['an unknown error', new Error('private-message'), 'other'],
        ['a non-error value', 'private-message', 'other'],
    ])('classifies %s', (_label: string, error: unknown, expected: string): void => {
        expect(classifyStartupFailure(error)).toBe(expected);
    });

    it('reports missing cached credentials regardless of the error', (): void => {
        expect(classifyStartupFailure(new Error('No credentials found'), { credentialsMissing: true })).toBe(
            'credentialsUnavailable',
        );
    });
});

describe('applyStartupFailureTelemetry', (): void => {
    it('records only allow-listed values under names whole-error masking keeps', (): void => {
        const properties: ITelemetryContext['properties'] = {};
        applyStartupFailureTelemetry(properties, new Error('private-host private-user'));
        expect(properties).toEqual({ startupFailureType: 'Error', startupFailureCategory: 'other' });
        // azext redacts every property named like an error when `maskEntireErrorMessage` is set.
        expect(Object.keys(properties).filter((key): boolean => /(error|exception)/i.test(key))).toEqual([]);
    });

    it('uses a recorded Microsoft Entra ID failure only when the error itself is not recognized', (): void => {
        const properties: ITelemetryContext['properties'] = { entraFailureKind: 'tokenAcquisitionFailed' };
        applyStartupFailureTelemetry(properties, new Error('Failed to obtain Entra ID token.'));
        expect(properties.startupFailureCategory).toBe('entraToken');

        const resolved: ITelemetryContext['properties'] = { entraFailureKind: 'none' };
        applyStartupFailureTelemetry(resolved, new MongoServerError({ message: 'Authentication failed.', code: 18 }));
        expect(resolved.startupFailureCategory).toBe('authentication');
    });
});
