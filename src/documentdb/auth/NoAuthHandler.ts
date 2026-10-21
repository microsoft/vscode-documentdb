/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';
import { type CachedClusterCredentials } from '../CredentialCache';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';

/**
 * Handler for anonymous ("no authentication") connections.
 *
 * The connection string is passed through verbatim — including any user-supplied
 * `tls`/`ssl` overrides — and no credentials are embedded. The extension never
 * forces TLS here; the only client options added are the TLS exception and its
 * fail-fast timeout, applied exactly as in {@link NativeAuthHandler}.
 */
export class NoAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public configureAuth(): Promise<AuthHandlerResponse> {
        const options: MongoClientOptions = {};
        const { connectionString, emulatorConfiguration } = this.clusterCredentials;

        // Host-gated like the other auth handlers: the stored flag is honored for any local or
        // private host, whether or not it was classified as an emulator, and never for a public host.
        const allowInvalidCertificates = resolveAllowInvalidCertificates(
            emulatorConfiguration?.disableEmulatorSecurity,
            connectionString,
        );

        // Fail fast against a local instance that isn't up yet.
        if (emulatorConfiguration?.isEmulator || allowInvalidCertificates) {
            options.serverSelectionTimeoutMS = 4000;
        }

        if (allowInvalidCertificates) {
            options.tlsAllowInvalidCertificates = true;
        }

        // Use the credential-free connection string. `connectionStringWithPassword` is
        // built with empty credentials for NoAuth and is therefore identical, but we
        // prefer the base `connectionString` to make the credential-free intent explicit.
        return Promise.resolve({
            connectionString,
            options,
        });
    }
}
