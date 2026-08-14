/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';
import { nonNullValue } from '../../utils/nonNull';
import { type CachedClusterCredentials } from '../CredentialCache';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';

/**
 * Handler for native MongoDB authentication using username and password
 */
export class NativeAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public configureAuth(): Promise<AuthHandlerResponse> {
        const options: MongoClientOptions = {};

        const connectionString = nonNullValue(
            this.clusterCredentials.connectionStringWithPassword,
            'clusterCredentials.connectionStringWithPassword',
            'NativeAuthHandler.ts',
        );

        // Emulator-specific tuning: a shorter server-selection timeout fails fast against a
        // local instance that isn't up yet — also applied to a regular LOCAL connection that opted
        // into the TLS exception (§7). Host-gated the same way as the TLS option, so an orphaned
        // flag on a public host does NOT trigger the aggressive 4s fail-fast.
        if (
            this.clusterCredentials.emulatorConfiguration?.isEmulator ||
            resolveAllowInvalidCertificates(
                this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity,
                connectionString,
            )
        ) {
            options.serverSelectionTimeoutMS = 4000;
        }

        // TLS-allow-invalid is driven by `disableEmulatorSecurity` (design §7), honored ONLY for
        // local/private hosts ("hybrid" runtime policy): an orphaned flag on a public host is not
        // activated, while an explicit `tlsAllowInvalidCertificates` URL param is still honored by
        // the driver (we never force the option to `false`).
        if (
            resolveAllowInvalidCertificates(
                this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity,
                connectionString,
            )
        ) {
            options.tlsAllowInvalidCertificates = true;
        }

        return Promise.resolve({
            connectionString,
            options,
        });
    }
}
