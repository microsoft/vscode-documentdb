/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { buildReport, createBuiltInChecks, renderJson, runTroubleshooter } from '../index.js';

import { type DnsIo, type TroubleshooterEvent } from '../index.js';

const secrets = [
    'p@ssw0rd-xyz',
    'p%40ssw0rd-xyz',
    'k3y-s3cr3t',
    'pr0xy-s3cr3t',
    'hunter2-s3cr3t',
    'layer-s3cr3t',
    'proxy-pa55',
];
const connectionString =
    'mongodb://alice:p%40ssw0rd-xyz@db.test:27017/?tls=true&tlsCertificateKeyFilePassword=k3y-s3cr3t&proxyPassword=pr0xy-s3cr3t&unknownOpt=hunter2-s3cr3t';

const dns: DnsIo = {
    lookup: async (): ReturnType<DnsIo['lookup']> => [{ address: '192.0.2.1', family: 4 }],
    resolve4: async (): Promise<string[]> => ['192.0.2.1'],
    resolve6: async (): Promise<string[]> => [],
    resolveCname: async (): Promise<string[]> => [],
    resolveSrv: async (): Promise<never> => {
        throw new Error('Unexpected SRV');
    },
    resolveTxt: async (): Promise<never> => {
        throw new Error('Unexpected TXT');
    },
    getServers: (): string[] => ['192.0.2.53'],
    resolveSrvFallback: async (): Promise<never> => {
        throw new Error('Unexpected fallback');
    },
    resolveTxtFallback: async (): Promise<never> => {
        throw new Error('Unexpected fallback');
    },
};

describe('unconditional secret exclusion', (): void => {
    it.each([true, false])(
        'keeps secrets out of events and both report modes (unknown option: %s)',
        async (unknownOption): Promise<void> => {
            const events: TroubleshooterEvent<string>[] = [];
            let tlsAttempts = 0;
            const run = await runTroubleshooter({
                input: {
                    connectionString: unknownOption
                        ? connectionString
                        : connectionString.replace('&unknownOpt=hunter2-s3cr3t', ''),
                    networkOptionLayers: [
                        { origin: 'setting', options: { tlsCertificateKeyFilePassword: 'layer-s3cr3t' } },
                    ],
                },
                checks: createBuiltInChecks(),
                onEvent: (event): void => {
                    events.push(event);
                },
                io: {
                    dns,
                    net: {
                        connect: async (): Promise<Socket> => new Socket(),
                        connectTls: async (): Promise<never> => {
                            tlsAttempts++;
                            throw Object.assign(new Error(`Driver input: ${connectionString}; ${secrets.join(' ')}`), {
                                code: 'ECONNRESET',
                            });
                        },
                    },
                    environment: {
                        versions: { node: '22.18.0', ares: '1.34.6', openssl: '3.0.16' },
                        platform: 'linux',
                        release: 'test',
                        arch: 'x64',
                        timeZone: 'UTC',
                        env: { HTTPS_PROXY: 'http://bob:proxy-pa55@proxy.test:8080' },
                    },
                },
            });
            expect(tlsAttempts).toBe(1);
            expect(events.at(-1)?.type).toBe('runFinished');
            const report = buildReport(run);
            const outputs = [
                JSON.stringify(events),
                renderJson(report, { redact: false }),
                renderJson(report, { redact: true }),
            ];
            for (const output of outputs) {
                for (const secret of secrets) {
                    expect(output.includes(secret)).toBe(false);
                }
            }
            expect(report.results[0].facts.proxy).toEqual({
                variables: [
                    {
                        variable: 'HTTPS_PROXY',
                        scheme: 'http',
                        host: 'proxy.test',
                        port: 8080,
                        authenticationPresent: true,
                    },
                ],
            });
            expect(renderJson(report, { redact: false })).toContain('tlsCertificateKeyFilePassword');
            expect(renderJson(report, { redact: false })).toContain('proxyPassword');
        },
    );
});
