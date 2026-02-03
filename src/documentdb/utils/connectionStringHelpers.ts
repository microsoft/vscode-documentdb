/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DocumentDBConnectionString } from './DocumentDBConnectionString';

export const removePasswordFromConnectionString = (connectionString: string): string => {
    const connectionStringOb = new DocumentDBConnectionString(connectionString);
    connectionStringOb.password = '';
    return connectionStringOb.toString();
};

export const addAuthenticationDataToConnectionString = (
    connectionString: string,
    username: string,
    password: string | undefined,
): string => {
    const connectionStringOb = new DocumentDBConnectionString(connectionString);
    connectionStringOb.username = username;
    connectionStringOb.password = password ?? '';
    return connectionStringOb.toString();
};

export const getUserNameFromConnectionString = (connectionString: string): string => {
    return new DocumentDBConnectionString(connectionString).username;
};

export const getPasswordFromConnectionString = (connectionString: string): string => {
    return new DocumentDBConnectionString(connectionString).password;
};

export const getHostsFromConnectionString = (connectionString: string): string[] => {
    return new DocumentDBConnectionString(connectionString).hosts;
};

export const addDatabasePathToConnectionString = (connectionString: string, databaseName: string): string => {
    const connectionStringOb = new DocumentDBConnectionString(connectionString);
    connectionStringOb.pathname = databaseName;
    return connectionStringOb.toString();
};

/**
 * Masks sensitive values from DocumentDB connection string in telemetry.
 * This includes username, password, port, and hosts.
 */
export function maskSensitiveValuesInTelemetry(context: IActionContext, parsedCS: DocumentDBConnectionString): void {
    [parsedCS.username, parsedCS.password, parsedCS.port, ...(parsedCS.hosts || [])]
        .filter(Boolean)
        .forEach((value) => context.valuesToMask.push(value));
}

/**
 * Checks if any of the given hosts end with the provided domain name suffix.
 *
 * @param hosts - An array of host strings to check.
 * @param tld - The domain suffix to check against the hosts.
 * @returns True if any host ends with the suffix, false otherwise.
 */
export function hasDomainSuffix(tld: string, ...hosts: string[]): boolean {
    return hosts.some((host) => {
        const hostWithoutPort = extractDomainFromHost(host);
        return hostWithoutPort.endsWith(tld);
    });
}

export function hasAzureDomain(...hosts: string[]): boolean {
    return hasDomainSuffix(AzureDomains.GeneralAzure, ...hosts);
}

export function extractDomainFromHost(host: string): string {
    return host.split(':')[0].toLowerCase();
}

export const AzureDomains = {
    RU: 'mongo.cosmos.azure.com',
    vCore: 'mongocluster.cosmos.azure.com',
    GeneralAzure: 'azure.com',
};

/**
 * Normalizes a connection string by removing duplicate query parameters.
 * This is useful for cleaning up connection strings that may have been corrupted
 * by bugs in previous versions.
 *
 * @param connectionString - The connection string to normalize
 * @returns A normalized connection string with duplicate parameters removed
 */
export const normalizeConnectionString = (connectionString: string): string => {
    return DocumentDBConnectionString.normalize(connectionString);
};

/**
 * Checks if a connection string has duplicate query parameters.
 *
 * @param connectionString - The connection string to check
 * @returns true if there are duplicate parameters
 */
export const hasDuplicateParameters = (connectionString: string): boolean => {
    if (!connectionString) {
        return false;
    }

    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        return parsed.hasDuplicateParameters();
    } catch {
        return false;
    }
};
