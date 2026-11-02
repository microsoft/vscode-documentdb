/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ l10n: { t: (value: string): string => value } }));
jest.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { getCredentials: jest.fn() },
}));
jest.mock('../../documentdb/utils/connectionStringHelpers', () => ({
    getHostsFromConnectionString: (uri: string): string[] => [uri.replace('mongodb://', '').split('/')[0]],
    extractDomainFromHost: (host: string): string => host.split(':')[0],
}));
import { CredentialCache } from '../../documentdb/CredentialCache';
import { AwsDiagnosticsProvider } from './AwsDiagnosticsProvider';

describe('AWS error translation', () => {
    const provider = new AwsDiagnosticsProvider();

    beforeEach(() => jest.mocked(CredentialCache.getCredentials).mockReset());

    it('explains string-only webview network errors for discovered clusters without blaming database credentials', async () => {
        expect(await provider.explain({
            clusterId: 'aws-documentdb-discovery_aws-resource', error: 'server selection timed out',
        })).toContain('network route');
    });

    it('recognizes saved AWS endpoints with explicit ports and explains certificate failures', async () => {
        jest.mocked(CredentialCache.getCredentials).mockReturnValue({
            clusterId: 'saved-id',
            connectionString: 'mongodb://example.cluster-abc.us-east-1.docdb.amazonaws.com:27017/',
        });
        expect(await provider.explain({
            clusterId: 'saved-id', error: new Error('unable to verify the first certificate'),
        })).toContain('CA bundle');
    });

    it('does not claim unrelated connections or database authorization errors', async () => {
        expect(await provider.explain({ clusterId: 'other', error: 'ETIMEDOUT' })).toBeUndefined();
        expect(await provider.explain({
            clusterId: 'aws-documentdb-discovery_aws-resource', error: 'Authentication failed',
        })).toBeUndefined();
    });
});
