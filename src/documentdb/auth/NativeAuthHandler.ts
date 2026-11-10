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
 * Handler for native MongoDB authentication using username and password
 */
export class NativeAuthHandler implements AuthHandler {
    constructor(
        private readonly clusterCredentials: CachedClusterCredentials,
        public readonly policy: AuthCallerPolicy = { interactive: true },
    ) {}

    public configureAuth(): Promise<AuthHandlerResponse> {
        // The password-bearing connection string, the TLS exception and its fail-fast timeout.
        const { connectionString, networkOptions } = buildAuthConnectionTarget(
            AuthMethodId.NativeAuth,
            this.clusterCredentials,
        );

        return Promise.resolve({
            connectionString,
            options: { ...networkOptions },
        });
    }
}
