/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { maskSensitiveValuesInTelemetry } from '../../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { type ClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';

/**
 * Retrieves cluster information from Azure for RU accounts.
 */
export async function extractCredentialsFromRUAccount(
    context: IActionContext,
    subscription: AzureSubscription,
    resourceGroup: string,
    accountName: string,
): Promise<ClusterCredentials> {
    if (!resourceGroup || !accountName) {
        throw new Error(l10n.t('Account information is incomplete.'));
    }

    // subscription comes from different azure packages in callers; cast here intentionally
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const managementClient = await createCosmosDBManagementClient(context, subscription as any);

    const connectionStringsList = await managementClient.databaseAccounts.listConnectionStrings(
        resourceGroup,
        accountName,
    );

    /**
     * databaseAccounts.listConnectionStrings returns an array of (typically 4) connection string objects:
     *
     * interface DatabaseAccountConnectionString {
     *    readonly connectionString?: string;
     *    readonly description?: string;
     *    readonly keyKind?: Kind;
     *    readonly type?: Type;
     * }
     *
     * Today we're interested in the one where "keyKind" is "Primary", but this might change in the future.
     * Other known values:
     *  - Primary
     *  - Secondary
     *  - PrimaryReadonly
     *  - SecondaryReadonly
     */

    // More efficient approach
    const primaryConnectionString = connectionStringsList?.connectionStrings?.find(
        (cs) => cs.keyKind?.toLowerCase() === 'primary',
    )?.connectionString;

    // Validate connection string's presence
    if (!primaryConnectionString) {
        context.telemetry.properties.error = 'missing-connection-string';
        throw new Error(
            l10n.t('Authentication data (primary connection string) is missing for "{cluster}".', {
                cluster: accountName,
            }),
        );
    }

    context.valuesToMask.push(primaryConnectionString);

    const parsedCS = new DocumentDBConnectionString(primaryConnectionString);
    maskSensitiveValuesInTelemetry(context, parsedCS);

    const username = parsedCS.username;
    const password = parsedCS.password;
    // do not keep secrets in the connection string
    parsedCS.username = '';
    parsedCS.password = '';

    // the connection string received sometimes contains an 'appName' entry
    // with a value that's not escaped, let's just remove it as we don't use
    // it here anyway.
    parsedCS.searchParams.delete('appName');

    const clusterCredentials: ClusterCredentials = {
        connectionString: parsedCS.toString(),
        availableAuthMethods: [AuthMethodId.NativeAuth],
        selectedAuthMethod: AuthMethodId.NativeAuth,
        // Legacy fields for backward compatibility
        connectionUser: username,
        connectionPassword: password,
        // Auth configs
        nativeAuthConfig: {
            connectionUser: username,
            connectionPassword: password,
        },
    };

    return clusterCredentials;
}
