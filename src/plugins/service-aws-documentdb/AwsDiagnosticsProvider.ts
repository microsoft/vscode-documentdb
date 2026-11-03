/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { extractDomainFromHost, getHostsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import {
    type ConnectionDiagnosticsProvider,
    type ConnectionDiagnosticsRequest,
} from '../../services/connectionDiagnosticsService';
import { AWS_DISCOVERY_PROVIDER_ID } from './config';

export class AwsDiagnosticsProvider implements ConnectionDiagnosticsProvider {
    public readonly id = 'aws-documentdb';

    public async explain({ clusterId, error }: ConnectionDiagnosticsRequest): Promise<string | undefined> {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        const tlsFailure = /certificate|unable to verify|self.signed|tlsCAFile|PEM|ENOENT/i.test(message);
        const networkFailure =
            /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|server selection|serverSelectionTimeout/i.test(message);
        if (!tlsFailure && !networkFailure) {
            return undefined;
        }
        const connectionString = CredentialCache.getCredentials(clusterId)?.connectionString;
        const awsEndpoint =
            connectionString &&
            getHostsFromConnectionString(connectionString).some((host) =>
                /\.[a-z0-9-]+\.docdb\.amazonaws\.com(?:\.cn)?$/i.test(extractDomainFromHost(host)),
            );
        if (!clusterId.startsWith(`${AWS_DISCOVERY_PROVIDER_ID}_`) && !awsEndpoint) {
            return undefined;
        }
        return tlsFailure
            ? vscode.l10n.t(
                  'We could not verify the AWS DocumentDB connection certificate. Check that the selected AWS CA bundle exists on the extension host and is current. Keep certificate and hostname validation enabled.',
              )
            : vscode.l10n.t(
                  'We could not reach AWS DocumentDB. Check that the extension host has a network route to the cluster VPC, that DNS resolves, and that security groups permit the database port. AWS sign-in grants discovery access, not network access; this extension does not create tunnels.',
              );
    }
}
