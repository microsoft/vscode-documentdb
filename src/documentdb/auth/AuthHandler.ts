/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';

/**
 * Interface for authentication handlers that configure MongoDB client options
 * for specific authentication methods.
 */
export interface AuthHandler {
    /**
     * Configures MongoDB client options for the specific authentication method
     * and returns the connection string to use.
     *
     * @param connectionString The base connection string without authentication
     * @returns Connection string and MongoDB client options
     */
    configureAuth(): Promise<AuthHandlerResponse>;
}

export interface AuthHandlerResponse {
    connectionString: string;
    options: MongoClientOptions;
}
