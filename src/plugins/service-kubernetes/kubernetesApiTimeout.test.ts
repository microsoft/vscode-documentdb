/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createKubernetesApiOperationError,
    getKubernetesApiErrorMessage,
    isKubernetesApiTimeoutError,
    normalizeKubernetesApiError,
} from './kubernetesApiTimeout';

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

describe('kubernetesApiTimeout', () => {
    it.each(['AbortError', 'TimeoutError'])('normalizes generated-client %s failures as timeouts', (name) => {
        const rawError = createNamedError(name, 'transport abort');

        expect(isKubernetesApiTimeoutError(rawError)).toBe(false);

        const normalized = normalizeKubernetesApiError(rawError);
        expect(isKubernetesApiTimeoutError(normalized)).toBe(true);
        expect(normalized.message).toBe('Operation timed out after 30 seconds.');
        expect(normalized.cause).toBe(rawError);
    });

    it('does not classify an arbitrary AbortError until it crosses a known API boundary', () => {
        const abortError = createNamedError('AbortError', 'request cancelled during teardown');

        expect(isKubernetesApiTimeoutError(abortError)).toBe(false);
        expect(getKubernetesApiErrorMessage(abortError)).toBe('request cancelled during teardown');
    });

    it('preserves contextual messages on an already-wrapped timeout error', () => {
        const contextualError = createNamedError(
            'KubernetesApiTimeoutError',
            'Failed to list services in namespace "app": Operation timed out after 30 seconds.',
        );

        expect(normalizeKubernetesApiError(contextualError)).toBe(contextualError);
        expect(getKubernetesApiErrorMessage(contextualError)).toBe(contextualError.message);
    });

    it('brands a contextual operation error when its cause is a generated-client timeout', () => {
        const normalizedCause = normalizeKubernetesApiError(createNamedError('AbortError', 'transport abort'));
        const operationError = createKubernetesApiOperationError(
            'Failed to list namespaces: Operation timed out after 30 seconds.',
            normalizedCause,
        );

        expect(isKubernetesApiTimeoutError(operationError)).toBe(true);
        expect(operationError.message).toBe('Failed to list namespaces: Operation timed out after 30 seconds.');
        expect(operationError.cause).toBe(normalizedCause);
    });

    it('does not brand a contextual operation error from an unnormalized AbortError', () => {
        const abortError = createNamedError('AbortError', 'request cancelled during teardown');
        const operationError = createKubernetesApiOperationError('Port-forward setup was cancelled.', abortError);

        expect(isKubernetesApiTimeoutError(operationError)).toBe(false);
        expect(operationError.cause).toBe(abortError);
    });

    it('preserves non-Error values as causes when normalizing them', () => {
        const rawError = 'Forbidden';

        const normalized = normalizeKubernetesApiError(rawError);

        expect(normalized.message).toBe(rawError);
        expect(normalized.cause).toBe(rawError);
    });

    it('preserves an extractable message when normalizing a record-shaped API error', () => {
        // The generated client can reject with a plain object rather than an Error;
        // normalizing it must not collapse the message to "[object Object]".
        const apiException = { body: { message: 'services is forbidden' } };

        const normalized = normalizeKubernetesApiError(apiException);

        expect(normalized.message).toBe('services is forbidden');
        expect(normalized.cause).toBe(apiException);
        expect(getKubernetesApiErrorMessage(normalized)).toBe('services is forbidden');
    });
});
