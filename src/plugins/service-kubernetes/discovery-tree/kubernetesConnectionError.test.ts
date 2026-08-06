/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { categorizeKubernetesConnectionError, classifyKubernetesConnectionError } from './kubernetesConnectionError';

jest.mock('vscode', () => ({
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
}));

function createNamedError(name: string, message: string): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}

const operationCopy = {
    unauthorized: { summary: 'op-unauthorized', hint: 'op-unauthorized-hint' },
    forbidden: { summary: 'op-forbidden', hint: 'op-forbidden-hint' },
    unknown: { summary: 'op-unknown', hint: 'op-unknown-hint' },
};

describe('categorizeKubernetesConnectionError', () => {
    it('classifies a branded API timeout as a timeout regardless of message', () => {
        const timeout = createNamedError('KubernetesApiTimeoutError', 'localized deadline message');
        expect(categorizeKubernetesConnectionError(timeout)).toBe('timeout');
    });

    it.each([
        ['401 message', 'request failed with 401', 'unauthorized'],
        ['unauthorized message', 'Unauthorized', 'unauthorized'],
        ['403 message', 'HTTP 403 returned', 'forbidden'],
        ['forbidden message', 'services is forbidden', 'forbidden'],
        ['connection refused', 'connect ECONNREFUSED 127.0.0.1:6443', 'connectionRefused'],
        ['dns failure', 'getaddrinfo ENOTFOUND cluster.example.com', 'dnsFailure'],
        ['socket timeout', 'connect ETIMEDOUT', 'timeout'],
        ['certificate error', 'unable to verify the first certificate', 'certificate'],
        ['not found', 'the server could not find the requested resource (404)', 'notFound'],
        ['generic', 'something unexpected happened', 'unknown'],
    ])('classifies %s', (_label, message, expected) => {
        expect(categorizeKubernetesConnectionError(new Error(message))).toBe(expected);
    });
});

describe('classifyKubernetesConnectionError', () => {
    it('uses the shared transport copy for a branded timeout', () => {
        const timeout = createNamedError('KubernetesApiTimeoutError', 'localized deadline message');
        expect(classifyKubernetesConnectionError(timeout, operationCopy).summary).toBe('Connection timed out');
    });

    it('uses caller-supplied copy for authentication failures and the generic fallback', () => {
        expect(classifyKubernetesConnectionError(new Error('401 Unauthorized'), operationCopy)).toEqual(
            operationCopy.unauthorized,
        );
        expect(classifyKubernetesConnectionError(new Error('403 Forbidden'), operationCopy)).toEqual(
            operationCopy.forbidden,
        );
        expect(classifyKubernetesConnectionError(new Error('mystery failure'), operationCopy)).toEqual(
            operationCopy.unknown,
        );
    });

    it('recognizes certificate and DNS failures even when the caller only overrides auth copy', () => {
        // Regression guard: these transport categories used to fall through to the
        // generic "unknown" copy in the namespace view.
        expect(classifyKubernetesConnectionError(new Error('SSL certificate problem'), operationCopy).summary).toBe(
            'Certificate error',
        );
        expect(classifyKubernetesConnectionError(new Error('getaddrinfo ENOTFOUND host'), operationCopy).summary).toBe(
            'Cluster not found (DNS resolution failed)',
        );
    });
});
