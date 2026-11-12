/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CachedClusterCredentials } from '../CredentialCache';
import { type AuthCallerPolicy } from './authCallerPolicy';
import { buildAuthConnectionTarget } from './authConnectionTarget';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { AuthMethodId } from './AuthMethod';

/**
 * Handler for anonymous ("no authentication") connections.
 *
 * Conflicting URI OIDC declarations are removed; otherwise the connection string is passed through
 * verbatim — including any user-supplied `tls`/`ssl` overrides — and no credentials are embedded. The extension never
 * forces TLS here; the only client options added are the TLS exception and its
 * fail-fast timeout, applied exactly as in {@link NativeAuthHandler}
 * (see {@link buildAuthConnectionTarget}).
 */
export class NoAuthHandler implements AuthHandler {
    constructor(
        private readonly clusterCredentials: CachedClusterCredentials,
        public readonly policy: AuthCallerPolicy = { interactive: true },
    ) {}

    public configureAuth(): Promise<AuthHandlerResponse> {
        const { connectionString, networkOptions } = buildAuthConnectionTarget(
            AuthMethodId.NoAuth,
            this.clusterCredentials,
        );

        return Promise.resolve({
            connectionString,
            options: { ...networkOptions },
        });
    }
}
