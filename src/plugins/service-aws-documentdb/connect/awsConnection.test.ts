/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    l10n: { t: (value: string): string => value },
    window: { showOpenDialog: jest.fn(), showWarningMessage: jest.fn() },
}));
jest.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
}));
jest.mock('../../../extensionVariables', () => ({ ext: {
    context: { globalState: { get: jest.fn().mockReturnValue({}), update: jest.fn() } },
    outputChannel: { warn: jest.fn() },
} }));
jest.mock('fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('crypto', () => ({
    ...jest.requireActual<typeof import('crypto')>('crypto'),
    X509Certificate: jest.fn(),
}));

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { NativeAuthHandler } from '../../../documentdb/auth/NativeAuthHandler';
import { type AwsCluster } from '../types';
import { buildAwsConnectionString, selectAwsCertificate, validateAwsCertificate } from './awsConnection';

const resource: AwsCluster = {
    id: 'id', arn: 'arn:aws:rds:us-east-1:123456789012:cluster:example',
    accountId: '123456789012', region: 'us-east-1', name: 'example',
    port: 27017, endpoint: 'example.cluster-abc.us-east-1.docdb.amazonaws.com',
    status: 'available', ownerCredentialId: 'credential-1',
};

describe('AWS database transport configuration', () => {
    it('keeps strict TLS and absolute CA paths in the URI shared by saved connections and clients', () => {
        const path = 'C:\\certificates\\AWS CA @bundle.pem';
        const uri = new DocumentDBConnectionString(buildAwsConnectionString(resource, path));
        expect(uri.username).toBe('');
        expect(uri.password).toBe('');
        expect(uri.searchParams.get('tls')).toBe('true');
        expect(uri.searchParams.get('tlsCAFile')).toBe(path);
        expect(uri.searchParams.get('replicaSet')).toBe('rs0');
        expect(uri.searchParams.get('readPreference')).toBe('secondaryPreferred');
        expect(uri.searchParams.get('retryWrites')).toBe('false');
        expect(uri.searchParams.get('authSource')).toBe('admin');
        expect(uri.searchParams.has('tlsAllowInvalidCertificates')).toBe(false);
        expect(uri.searchParams.has('tlsAllowInvalidHostnames')).toBe(false);
    });

    it('rejects unavailable clusters and invalid control-plane endpoints', () => {
        expect(() => buildAwsConnectionString({ ...resource, status: 'stopped' }, 'ca.pem')).toThrow();
        expect(() => buildAwsConnectionString({ ...resource, endpoint: 'host/?tls=false' }, 'ca.pem')).toThrow();
        expect(() => buildAwsConnectionString({ ...resource, port: 0 }, 'ca.pem')).toThrow();
    });

    it('preserves CA and strict TLS through the shared native-auth connection path', async () => {
        const path = resolve('certificates', 'AWS CA.pem');
        const connectionString = buildAwsConnectionString(resource, path);
        CredentialCache.setAuthCredentials('aws-test', AuthMethodId.NativeAuth, connectionString, {
            connectionUser: 'database-user', connectionPassword: 'test-password',
        });
        try {
            const cached = CredentialCache.getCredentials('aws-test');
            if (!cached) {
                throw new Error('Expected cached connection');
            }
            const configured = await new NativeAuthHandler(cached).configureAuth();
            const uri = new DocumentDBConnectionString(configured.connectionString);
            expect(uri.searchParams.get('tlsCAFile')).toBe(path);
            expect(uri.searchParams.get('tls')).toBe('true');
            expect(uri.searchParams.get('retryWrites')).toBe('false');
            expect(configured.options.tlsAllowInvalidCertificates).not.toBe(true);
            expect(uri.username).toBe('database-user');
        } finally {
            CredentialCache.deleteCredentials('aws-test');
        }
    });

    it('does not silently proceed without a CA bundle when the picker is cancelled', async () => {
        jest.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);
        await expect(selectAwsCertificate(resource)).rejects.toBeInstanceOf(UserCancelledError);
    });

    it('rejects unreadable or non-PEM bundles', async () => {
        jest.mocked(readFile).mockRejectedValueOnce(new Error('File missing'));
        await expect(validateAwsCertificate(resolve('ca.pem'))).rejects.toThrow('File missing');
        jest.mocked(readFile).mockResolvedValueOnce('not a certificate');
        await expect(validateAwsCertificate(resolve('ca.pem'))).rejects.toThrow('PEM');
        await expect(validateAwsCertificate('relative.pem')).rejects.toThrow('absolute');
    });
});
