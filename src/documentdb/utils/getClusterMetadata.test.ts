/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClient } from 'mongodb';

import { getClusterMetadata, getTelemetryShape } from './getClusterMetadata';

describe('getTelemetryShape', () => {
    it('collects hello keys and value types without raw values', () => {
        const helloInfo = {
            isWritablePrimary: true,
            msg: 'isdbgrid',
            hosts: ['host-a', 'host-b'],
            maxBsonObjectSize: 16777216,
            maxMessageSizeBytes: 48000000,
            maxWriteBatchSize: 25000,
            maxWireVersion: 25,
            minWireVersion: 0,
            connectionId: 1339367315,
            localTime: 1782455165668,
            logicalSessionTimeoutMinutes: 30,
            operationTime: {
                $timestamp: {
                    t: 1782455165,
                    i: 668,
                },
            },
            internal: {
                documentdb_versions: ['1.112-0', '1.113.0'],
                kind: 'azuredocumentdb',
            },
            saslSupportedMechs: ['SCRAM-SHA-256', 'MONGODB-OIDC'],
            readOnly: false,
            ok: 1,
        };

        const result = getTelemetryShape(helloInfo, ['$', 'connectionId', 'localTime']);

        expect(result).toBe(
            [
                'hosts:array:string',
                'internal.documentdb_versions:array:string',
                'internal.kind:string',
                'isWritablePrimary:boolean',
                'logicalSessionTimeoutMinutes:number',
                'maxBsonObjectSize:number',
                'maxMessageSizeBytes:number',
                'maxWireVersion:number',
                'maxWriteBatchSize:number',
                'minWireVersion:number',
                'msg:string',
                'ok:number',
                'readOnly:boolean',
                'saslSupportedMechs:array:string',
            ].join(';'),
        );

        expect(result).not.toContain('host-a');
        expect(result).not.toContain('connectionId');
        expect(result).not.toContain('localTime');
        expect(result).not.toContain('$timestamp');
    });
});

describe('getClusterMetadata', () => {
    it('collects only allow-listed hello values plus hello shape', async () => {
        const helloInfo = {
            msg: 'isdbgrid',
            hosts: ['host-a', 'host-b'],
            maxWireVersion: 25,
            minWireVersion: 0,
            connectionId: 1339367315,
            localTime: 1782455165668,
            internal: {
                documentdb_versions: ['1.112-0', '1.113.0', '12.1-1'],
                kind: 'azuredocumentdb',
            },
            saslSupportedMechs: ['SCRAM-SHA-256', 'MONGODB-OIDC'],
            readOnly: false,
            ok: 1,
        };

        const adminDb = {
            command: jest.fn(async (command: Record<string, number>): Promise<unknown> => {
                if (command.buildInfo === 1) {
                    return { version: '1.0.0', platform: 'test', storageEngines: ['wiredTiger'] };
                }

                if (command.serverStatus === 1) {
                    return { uptime: 10 };
                }

                if (command.hello === 1) {
                    return helloInfo;
                }

                if (command.hostInfo === 1) {
                    return { currentTime: 1782455165668 };
                }

                throw new Error('Unexpected command');
            }),
        };

        const client = { db: () => ({ admin: () => adminDb }) } as unknown as MongoClient;

        const result = await getClusterMetadata(client, ['host-a.example.com']);

        expect(result['topology_type']).toBe('isdbgrid');
        expect(result['topology_numberOfServers']).toBe('2');
        expect(result['topology_maxWireVersion']).toBe('25');
        expect(result['topology_minWireVersion']).toBe('0');
        expect(result['topology_hello_saslSupportedMechs']).toBe('SCRAM-SHA-256;MONGODB-OIDC');
        expect(result['topology_hello_internal_documentdb_versions']).toBe('1.112-0;1.113.0;12.1-1');
        expect(result['topology_hello_internal_kind']).toBe('azuredocumentdb');
        expect(result['topology_helloShape']).toContain('hosts:array:string');
        expect(result['topology_helloShape']).not.toContain('host-a');
        expect(result['topology_hello_hosts_0']).toBeUndefined();
        expect(result['topology_hello_connectionId']).toBeUndefined();
    });
});
