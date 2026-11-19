/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoNetworkError, MongoServerSelectionError, type TopologyDescription } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { EntraIdentityMismatchError, EntraSignInRequiredError, TokenCallbackError } from './entraCallbackErrors';
import { EntraSignInRequiredErrorExplainer } from './EntraSignInRequiredErrorExplainer';

describe('EntraSignInRequiredErrorExplainer', () => {
    const explainer = new EntraSignInRequiredErrorExplainer();
    const clusterId = 'private-cluster';

    it('explains a typed sign-in error two causes deep without changing the errors', async () => {
        const signIn = Object.freeze(new EntraSignInRequiredError('providerChanged'));
        const wrapper = Object.freeze(new TokenCallbackError(signIn));
        const error = Object.freeze(new Error('private-detail', { cause: wrapper }));

        await expect(explainer.explain({ clusterId, error })).resolves.toBe(
            'Your Microsoft sign-in for this connection expired. Sign in again to continue.',
        );
        expect(error.cause).toBe(wrapper);
        expect(wrapper.cause).toBe(signIn);
    });

    it('recognizes the bounded name on an Error reconstructed at a boundary', async () => {
        const error = new Error('private-account');
        error.name = 'EntraIdentityMismatchError';

        await expect(explainer.explain({ clusterId, error })).resolves.toBe(
            'VS Code returned a different Microsoft account for this connection.',
        );
    });

    it('finds a typed cause in the driver’s per-server errors', async () => {
        const mismatch = new EntraIdentityMismatchError();
        const servers = new Map([
            ['private-host:27017', { error: new MongoNetworkError('private-detail', { cause: mismatch }) }],
            ['unrelated-host:27017', { error: new MongoNetworkError('unrelated') }],
        ]);
        const error = new MongoServerSelectionError('selection failed', { servers } as unknown as TopologyDescription);

        await expect(explainer.explain({ clusterId, error })).resolves.toBe(
            'VS Code returned a different Microsoft account for this connection.',
        );
    });

    it('declines strings, message-only matches, and unrelated cyclic callback errors', async () => {
        const unrelated = new Error('EntraSignInRequiredError');
        const wrapper = new TokenCallbackError(unrelated);
        unrelated.cause = wrapper;

        await expect(explainer.explain({ clusterId, error: 'EntraIdentityMismatchError' })).resolves.toBeUndefined();
        await expect(explainer.explain({ clusterId, error: wrapper })).resolves.toBeUndefined();
    });
});
