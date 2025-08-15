/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';
import { nonNullValue } from '../../utils/nonNull';
import { type ClustersCredentials } from '../CredentialCache';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';

/**
 * Handler for native MongoDB authentication using username and password
 */
export class NativeAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: ClustersCredentials) {}

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

        return Promise.resolve({
            connectionString: nonNullValue(
                this.clusterCredentials.connectionStringWithPassword,
                'connectionStringWithPassword',
            ),
            options,
        });
    }
}
