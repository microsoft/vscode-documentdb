/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CredentialCache } from '../../documentdb/CredentialCache';
import { AtlasDiagnosticsProvider } from './AtlasDiagnosticsProvider';

const TLS_REJECTION = new Error(
    '80B7A3E8B77F0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:1590:SSL alert number 80',
);

function mockConnectionString(connectionString: string | undefined): void {
    jest.spyOn(CredentialCache, 'getCredentials').mockReturnValue(
        connectionString ? ({ clusterId: 'c1', connectionString } as never) : undefined,
    );
}

describe('AtlasDiagnosticsProvider', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('explains a TLS handshake rejection on an Atlas host', async () => {
        mockConnectionString('mongodb+srv://cluster0.abcde.mongodb.net/');

        const result = await new AtlasDiagnosticsProvider().explain({ clusterId: 'c1', error: TLS_REJECTION });

        expect(result).toContain('MongoDB Atlas closed the TLS connection');
        expect(result).toContain('IP access list');
        // The diagnosis becomes a modal heading, so it must stay a single paragraph.
        expect(result).not.toContain('\n');
    });

    it('stays silent for the same failure on a non-Atlas host', async () => {
        mockConnectionString('mongodb://self-hosted.example.com:27017/');

        await expect(
            new AtlasDiagnosticsProvider().explain({ clusterId: 'c1', error: TLS_REJECTION }),
        ).resolves.toBeUndefined();
    });

    it('stays silent for an authentication failure on an Atlas host', async () => {
        const getCredentials = jest.spyOn(CredentialCache, 'getCredentials');

        await expect(
            new AtlasDiagnosticsProvider().explain({
                clusterId: 'c1',
                error: new Error('bad auth : Authentication failed.'),
            }),
        ).resolves.toBeUndefined();
        // The error shape is checked first, so we never even look the cluster up.
        expect(getCredentials).not.toHaveBeenCalled();
    });

    it('stays silent when no credentials are cached', async () => {
        mockConnectionString(undefined);

        await expect(
            new AtlasDiagnosticsProvider().explain({ clusterId: 'c1', error: TLS_REJECTION }),
        ).resolves.toBeUndefined();
    });
});
