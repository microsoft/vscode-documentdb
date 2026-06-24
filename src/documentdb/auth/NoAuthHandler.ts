/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';
import { type CachedClusterCredentials } from '../CredentialCache';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';

/**
 * Handler for anonymous ("no authentication") connections.
 *
 * The connection string is passed through verbatim — including any user-supplied
 * `tls`/`ssl` overrides — and no credentials are embedded. The extension never
 * forces TLS here; the only client option added is the emulator-specific
 * `tlsAllowInvalidCertificates` rule, mirroring {@link NativeAuthHandler}.
 */
export class NoAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public configureAuth(): Promise<AuthHandlerResponse> {
        const options: MongoClientOptions = {};

        // Apply emulator-specific configuration if needed
        if (this.clusterCredentials.emulatorConfiguration?.isEmulator) {
            options.serverSelectionTimeoutMS = 4000;

            if (this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity) {
                // Prevents self signed certificate error for emulator
                options.tlsAllowInvalidCertificates = true;
            }
        }

        // Use the credential-free connection string. `connectionStringWithPassword` is
        // built with empty credentials for NoAuth and is therefore identical, but we
        // prefer the base `connectionString` to make the credential-free intent explicit.
        return Promise.resolve({
            connectionString: this.clusterCredentials.connectionString,
            options,
        });
    }
}
