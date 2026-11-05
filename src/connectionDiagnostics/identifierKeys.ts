/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IdentifierKind } from '@documentdb-js/connection-diagnostics';

/**
 * Identifier keys for facts the extension's checks add, on top of the package defaults, so
 * "Hide identifiers" covers them (design §6.3).
 */
export const troubleshooterIdentifierKeys: Readonly<Record<string, IdentifierKind>> = Object.freeze({
    connectionName: 'connectionName',
    account: 'account',
    tenantId: 'tenant',
    clientId: 'clientId',
    'roles.role': 'role',
    'roles.db': 'database',
    answeredBy: 'host',
    seedHosts: 'host',
    'providerIdentifiers.service': 'service',
    'providerIdentifiers.namespace': 'namespace',
});
