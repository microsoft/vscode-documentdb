/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runDiagnostics, type CheckOutcome, type TimeoutProfile } from '@documentdb-js/connection-diagnostics';
import { MongoServerError, type MongoClient } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClusterMetadata } from '../../documentdb/utils/getClusterMetadata';
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { type TroubleshooterSetup } from '../input';
import { type FindingCode } from '../types';
import { createServerFactsCheck } from './serverFacts';

vi.mock('../../documentdb/utils/getClusterMetadata', () => ({
    getClusterMetadata: vi.fn((): never => {
        throw new Error('Forbidden metadata collector');
    }),
}));

interface FixtureOptions {
    readonly build?: Record<string, unknown> | Error;
    readonly hello?: Record<string, unknown> | Error;
    readonly uri?: string;
    readonly providerId?: string;
    readonly properties?: Record<string, unknown>;
    readonly clientOptions?: Record<string, unknown>;
    readonly addresses?: readonly string[];
    readonly slowCommand?: string;
    readonly profile?: TimeoutProfile;
    readonly lateReply?: () => Promise<Record<string, unknown>>;
}

function fixture(options: FixtureOptions = {}): {
    running: Promise<CheckOutcome<FindingCode>>;
    command: ReturnType<typeof vi.fn>;
    db: ReturnType<typeof vi.fn>;
} {
    const input = { connectionString: options.uri ?? 'mongodb://private.example:27017/' };
    const setup: TroubleshooterSetup = {
        input,
        chosenAuthMethod: undefined,
        credentialState: 'available',
        transientCredentials: undefined,
        connectionProperties: options.properties,
    };
    const command = vi.fn(
        async (
            document: Record<string, unknown>,
            commandOptions: { signal: AbortSignal },
        ): Promise<Record<string, unknown>> => {
            const name = Object.keys(document)[0];
            if (name === options.slowCommand) {
                if (options.lateReply) return options.lateReply();
                return new Promise((_resolve, reject): void => {
                    commandOptions.signal.addEventListener(
                        'abort',
                        (): void =>
                            reject(
                                commandOptions.signal.reason instanceof Error
                                    ? commandOptions.signal.reason
                                    : new Error('Operation aborted', { cause: commandOptions.signal.reason }),
                            ),
                        {
                            once: true,
                        },
                    );
                });
            }
            const reply =
                name === 'buildInfo'
                    ? (options.build ?? { version: '8.0.1', secret: 'SECRET' })
                    : (options.hello ?? {});
            if (reply instanceof Error) throw reply;
            return reply;
        },
    );
    const db = vi.fn((): { command: typeof command } => ({ command }));
    const holder: RunOwnedClient = {
        client: {
            db,
            options: options.clientOptions ?? {},
            topology: {
                description: {
                    servers: new Map(
                        (options.addresses ?? ['private.example:27017']).map(
                            (address): [string, { address: string; type: string }] => [
                                address,
                                { address, type: 'Standalone' },
                            ],
                        ),
                    ),
                },
            },
        } as unknown as MongoClient,
    };
    const running = runDiagnostics<FindingCode>({
        input,
        timeoutProfile: options.profile,
        checks: [
            {
                id: 'prepare',
                scope: 'run',
                run: async (): Promise<CheckOutcome<FindingCode>> => ({
                    status: 'pass',
                    facts: { providerId: options.providerId },
                    findings: [],
                }),
            },
            {
                id: 'authenticate',
                scope: 'run',
                run: async (): Promise<CheckOutcome<FindingCode>> => ({ status: 'pass', facts: {}, findings: [] }),
            },
            createServerFactsCheck(
                (): TroubleshooterSetup => setup,
                (): RunOwnedClient => holder,
            ),
        ],
    }).then((run): CheckOutcome<FindingCode> => run.results[2]);
    return { running, command, db };
}

afterEach((): void => {
    expect(getClusterMetadata).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('serverFacts', (): void => {
    it('reports a DocumentDB gateway and all engine versions in server order', async (): Promise<void> => {
        const { running, command, db } = fixture({
            build: { version: '8.0.1', secret: 'SECRET' },
            hello: {
                msg: 'isdbgrid',
                internal: { documentdb_versions: ['1.112-0', '1.113.0', '12.1-1'], secret: 'SECRET' },
                readOnly: true,
                minWireVersion: 0,
                maxWireVersion: 21,
                secret: 'SECRET',
                setName: 'not-a-replica-set',
                hosts: ['not-members'],
            },
        });
        const result = await running;
        expect(result).toMatchObject({
            status: 'pass',
            facts: {
                serverVersion: '8.0.1',
                documentdbVersions: ['1.112-0', '1.113.0', '12.1-1'],
                versions: { engine: '1.112-0 · 1.113.0 · 12.1-1', api: '8.0.1', server: undefined },
                topology: 'documentdbGateway',
                readOnly: true,
                minWireVersion: 0,
                maxWireVersion: 21,
                answeredBy: 'private.example:27017',
                seedHosts: ['private.example:27017'],
            },
        });
        expect(result.facts).not.toHaveProperty('setName');
        expect(result.facts).not.toHaveProperty('memberCount');
        expect(JSON.stringify(result)).not.toMatch(/SECRET|replicaSet|not-members|not-a-replica-set/);
        expect(command.mock.calls.map((args): unknown => args[0])).toEqual([{ buildInfo: 1 }, { hello: 1 }]);
        expect(db.mock.calls).toEqual([['admin'], ['admin']]);
    });

    it('caps DocumentDB versions at eight strings, excluding other types', async (): Promise<void> => {
        const result = await fixture({
            hello: {
                msg: 'isdbgrid',
                internal: { documentdb_versions: [null, ...Array<string>(12).fill('1.0.0'), { secret: 'SECRET' }] },
            },
        }).running;
        expect(result.facts.documentdbVersions).toEqual(Array<string>(8).fill('1.0.0'));
        expect(JSON.stringify(result)).not.toContain('SECRET');
    });

    it('reports a replica set, primary and distinct members including passives and arbiters', async (): Promise<void> => {
        const result = await fixture({
            hello: {
                setName: 'rs0',
                primary: 'a.test:27017',
                hosts: ['a.test:27017', 'b.test:27017'],
                passives: ['b.test:27017', 'c.test:27017'],
                arbiters: ['d.test:27017'],
            },
        }).running;
        expect(result.facts).toMatchObject({
            topology: 'replicaSet',
            setName: 'rs0',
            primary: 'a.test:27017',
            memberCount: 4,
        });
    });

    it('uses the server-version key, never engine or API, without DocumentDB metadata', async (): Promise<void> => {
        const result = await fixture().running;
        expect(result.facts).toMatchObject({
            topology: 'standalone',
            versions: { engine: undefined, api: undefined, server: '8.0.1' },
        });
        expect(result.facts).not.toHaveProperty('documentdbVersions');
    });

    it.each([
        ['mongodb://fixture.mongocluster.cosmos.azure.com/', 'public'],
        ['mongodb://fixture.mongocluster.cosmos.azure.us/', 'usGovernment'],
        ['mongodb://fixture.mongocluster.cosmos.azure.cn/', 'china'],
        ['mongodb://fixture.mongocluster.cosmos.azure.com,private.example/', 'public'],
        ['mongodb://fixture.mongocluster.cosmos.azure.us,private.example/', 'usGovernment'],
        ['mongodb://fixture.mongocluster.cosmos.azure.cn,private.example/', 'china'],
    ])('classifies Azure endpoints with their cloud: %s', async (uri, cloud): Promise<void> => {
        expect((await fixture({ uri }).running).facts).toMatchObject({
            platform: 'azureDocumentDB',
            platformCloud: cloud,
            platformEvidence: 'hostSuffix',
        });
    });

    it('does not assign a platform cloud when the Azure hosts conflict', async (): Promise<void> => {
        const { facts } = await fixture({
            uri: 'mongodb://fixture.mongocluster.cosmos.azure.us,fixture.mongocluster.cosmos.azure.cn/',
        }).running;

        expect(facts).toMatchObject({ platform: 'other', platformEvidence: 'none' });
        expect(facts).not.toHaveProperty('platformCloud');
    });

    it('recognizes Atlas without trusting lookalike domains', async (): Promise<void> => {
        expect((await fixture({ uri: 'mongodb+srv://cluster.mongodb.net/' }).running).facts).toMatchObject({
            platform: 'atlas',
            platformEvidence: 'hostSuffix',
        });
        expect((await fixture({ uri: 'mongodb://cluster.mongodb.net.evil.example/' }).running).facts).toMatchObject({
            platform: 'other',
            platformEvidence: 'none',
        });
    });

    it('uses the preparation provider to recognize Kubernetes, not its forwarded loopback host', async (): Promise<void> => {
        expect(
            (await fixture({ uri: 'mongodb://127.0.0.1:38000/', providerId: 'kubernetes-port-forward' }).running).facts,
        ).toMatchObject({ platform: 'kubernetes', platformEvidence: 'preparationProvider' });
        expect((await fixture({ uri: 'mongodb://localhost:27017/' }).running).facts).toMatchObject({
            platform: 'other',
            platformEvidence: 'none',
        });
    });

    it('uses the existing emulator configuration for Local Quick Start', async (): Promise<void> => {
        expect(
            (
                await fixture({
                    properties: { emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true } },
                }).running
            ).facts,
        ).toMatchObject({ platform: 'localQuickStart', platformEvidence: 'connectionProperties' });
    });

    it('does not pretend a multi-server description identifies the answering endpoint', async (): Promise<void> => {
        expect((await fixture({ addresses: ['a.test:27017', 'b.test:27017'] }).running).facts.answeredBy).toBeNull();
        expect((await fixture({ addresses: [] }).running).facts.answeredBy).toBeNull();
    });

    it.each([
        [{ msg: 'isdbgrid' }, {}, 'shardedRouter'],
        [{}, { loadBalanced: true }, 'loadBalanced'],
        [{ serviceId: 'server-service-id' }, {}, 'loadBalanced'],
    ] as const)(
        'classifies the remaining topologies without leaking service IDs',
        async (hello, clientOptions, topology): Promise<void> => {
            const result = await fixture({ hello, clientOptions }).running;
            expect(result.facts.topology).toBe(topology);
            expect(JSON.stringify(result)).not.toContain('server-service-id');
        },
    );

    it.each([13, 59, 115])(
        'keeps buildInfo code %s as a fact, not a failure or cached version',
        async (code): Promise<void> => {
            const result = await fixture({
                build: new MongoServerError({
                    code,
                    codeName: code === 13 ? 'Unauthorized' : 'CommandNotSupported',
                    errmsg: 'SECRET',
                }),
                hello: { msg: 'isdbgrid' },
            }).running;
            expect(result).toMatchObject({
                status: 'pass',
                findings: [],
                facts: {
                    topology: 'shardedRouter',
                    commands: [
                        { command: 'buildInfo', outcome: code === 13 ? 'denied' : 'unsupported' },
                        { command: 'hello', outcome: 'ok' },
                    ],
                },
            });
            expect(result.facts).not.toHaveProperty('serverVersion');
            expect(JSON.stringify(result)).not.toContain('SECRET');
        },
    );

    it('keeps denied hello metadata unavailable instead of using stale topology facts', async (): Promise<void> => {
        const result = await fixture({
            hello: new MongoServerError({ code: 13, codeName: 'Unauthorized', errmsg: 'SECRET' }),
        }).running;
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                commands: [
                    { command: 'buildInfo', outcome: 'ok' },
                    { command: 'hello', outcome: 'denied', codeName: 'Unauthorized' },
                ],
                versions: { server: '8.0.1' },
            },
        });
        for (const key of [
            'topology',
            'setName',
            'primary',
            'memberCount',
            'readOnly',
            'minWireVersion',
            'maxWireVersion',
        ]) {
            expect(result.facts).not.toHaveProperty(key);
        }
        expect(JSON.stringify(result)).not.toContain('SECRET');
    });

    for (const [profile, timeoutMs] of [
        ['default', 5000],
        ['longer', 10000],
    ] as const) {
        it.each(['buildInfo', 'hello'])(
            `bounds %s under ${profile} and continues to the next command`,
            async (slowCommand): Promise<void> => {
                vi.useFakeTimers();
                const { running, command } = fixture({ slowCommand, profile });
                await vi.advanceTimersByTimeAsync(timeoutMs - 1);
                expect(command).toHaveBeenCalledTimes(slowCommand === 'buildInfo' ? 1 : 2);
                await vi.advanceTimersByTimeAsync(1);
                expect(await running).toMatchObject({
                    status: 'warning',
                    findings: [
                        {
                            code: 'check.timeout',
                            data: { operation: `serverFacts.${slowCommand}`, timeoutMs, source: 'check' },
                        },
                    ],
                });
                expect(command).toHaveBeenCalledTimes(2);
            },
        );
    }

    it('does not impose a diagnostic timeout in the unbounded profile', async (): Promise<void> => {
        vi.useFakeTimers();
        let release: (reply: Record<string, unknown>) => void = (): void => {};
        const { running, command } = fixture({
            slowCommand: 'buildInfo',
            profile: 'noDiagnosticTimeouts',
            lateReply: (): Promise<Record<string, unknown>> =>
                new Promise((resolve): void => {
                    release = resolve;
                }),
        });
        await vi.advanceTimersByTimeAsync(20000);
        expect(command).toHaveBeenCalledTimes(1);
        release({ version: '8.0.2' });
        expect(await running).toMatchObject({ status: 'pass', facts: { serverVersion: '8.0.2' } });
    });

    it('ignores a late reply after a command timeout', async (): Promise<void> => {
        vi.useFakeTimers();
        let release: (reply: Record<string, unknown>) => void = (): void => {};
        const { running } = fixture({
            slowCommand: 'buildInfo',
            lateReply: (): Promise<Record<string, unknown>> =>
                new Promise((resolve): void => {
                    release = resolve;
                }),
        });
        await vi.advanceTimersByTimeAsync(5000);
        const result = await running;
        release({ version: '99.0.0', password: 'SECRET' });
        await vi.advanceTimersByTimeAsync(0);
        expect(result.facts).not.toHaveProperty('serverVersion');
        expect(JSON.stringify(result)).not.toMatch(/99.0.0|SECRET/);
    });
});
