/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    runDiagnostics,
    type CheckOutcome,
    type CheckStatus,
    type TimeoutProfile,
} from '@documentdb-js/connection-diagnostics';
import { MongoMissingDependencyError, MongoServerError, type MongoClient } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { type FindingCode } from '../types';
import { createConnectionAccessCheck } from './connectionAccess';

interface CommandOptions {
    readonly signal: AbortSignal;
    readonly timeoutMS?: number;
}
type CommandScript = (command: string, options: CommandOptions) => Promise<Record<string, unknown>>;

function fixture(
    script: CommandScript,
    clientOptions: Record<string, unknown> = {},
): {
    holder: RunOwnedClient;
    command: ReturnType<typeof vi.fn>;
    db: ReturnType<typeof vi.fn>;
} {
    const command = vi.fn(
        (document: Record<string, unknown>, options: CommandOptions): Promise<Record<string, unknown>> =>
            script(Object.keys(document)[0], options),
    );
    const db = vi.fn((): { command: typeof command } => ({ command }));
    return { holder: { client: { db, options: clientOptions } as unknown as MongoClient }, command, db };
}

async function runAccess(
    holder: RunOwnedClient,
    options: {
        profile?: TimeoutProfile;
        authStatus?: CheckStatus;
        authFacts?: Record<string, unknown>;
        connectionTimeoutMs?: number;
    } = {},
): Promise<CheckOutcome<FindingCode>> {
    const run = await runDiagnostics<FindingCode>({
        input: {
            connectionString: 'mongodb://private.example/',
            ...(options.connectionTimeoutMs === undefined
                ? {}
                : { connectionTimeouts: { postConnect: options.connectionTimeoutMs } }),
        },
        timeoutProfile: options.profile,
        checks: [
            {
                id: 'authenticate',
                scope: 'run',
                run: async (): Promise<CheckOutcome<FindingCode>> => ({
                    status: options.authStatus ?? 'pass',
                    facts: options.authFacts ?? {},
                    findings: [],
                    ...(options.authStatus === 'skipped'
                        ? { skippedBecause: { reason: 'inputUnavailable' as const } }
                        : {}),
                }),
            },
            createConnectionAccessCheck((): RunOwnedClient => holder),
        ],
    });
    return run.results[1];
}

async function ok(command: string): Promise<Record<string, unknown>> {
    if (command === 'connectionStatus')
        return { authInfo: { authenticatedUserRoles: [{ role: 'customRole', db: 'app' }], secret: 'never-output' } };
    if (command === 'listDatabases')
        return { databases: [{ name: 'SECRET-DATABASE-NAME', empty: false }, { name: 'ANOTHER-NAME' }] };
    return { ok: 1 };
}

async function pending(options: CommandOptions): Promise<never> {
    return new Promise((_resolve, reject): void => {
        options.signal.addEventListener(
            'abort',
            (): void =>
                reject(
                    options.signal.reason instanceof Error
                        ? options.signal.reason
                        : new Error('Operation aborted', { cause: options.signal.reason }),
                ),
            { once: true },
        );
    });
}

afterEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('connectionAccess', (): void => {
    it('passes with allowlisted facts and exactly the tree database-list request', async (): Promise<void> => {
        const { holder, command, db } = fixture(ok);
        const result = await runAccess(holder);
        expect(result).toMatchObject({
            status: 'pass',
            facts: {
                pingMs: expect.any(Number),
                databaseCount: 2,
                roles: [{ role: 'customRole', db: 'app' }],
                commands: ['ping', 'connectionStatus', 'listDatabases'].map((name): object => ({
                    command: name,
                    outcome: 'ok',
                    durationMs: expect.any(Number),
                })),
            },
        });
        expect(command.mock.calls.map((args): unknown => args[0])).toEqual([
            { ping: 1 },
            { connectionStatus: 1 },
            { listDatabases: 1 },
        ]);
        expect(db.mock.calls).toEqual([['admin'], ['admin'], ['admin']]);
        expect(JSON.stringify(result)).not.toMatch(/SECRET-DATABASE-NAME|ANOTHER-NAME|never-output/);
        const check = createConnectionAccessCheck((): RunOwnedClient => holder);
        expect(check).toMatchObject({ id: 'connectionAccess', scope: 'run', dependsOn: ['authenticate'] });
        expect(check.timeout).toBeUndefined();
    });

    it('warns when listing is denied, without failing a connected run', async (): Promise<void> => {
        const { holder } = fixture(async (command): Promise<Record<string, unknown>> => {
            if (command === 'listDatabases')
                throw new MongoServerError({ code: 13, codeName: 'Unauthorized', errmsg: 'secret' });
            return ok(command);
        });
        const result = await runAccess(holder);
        expect(result).toMatchObject({
            status: 'warning',
            findings: [{ code: 'access.listDatabasesDenied', severity: 'warning', data: { codeName: 'Unauthorized' } }],
            facts: {
                commands: [
                    { outcome: 'ok' },
                    { outcome: 'ok' },
                    { command: 'listDatabases', outcome: 'denied', codeName: 'Unauthorized' },
                ],
            },
        });
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    describe('WI-27: refusals before sign-in (decision 0048)', (): void => {
        const noAuth = { authMethod: 'NoAuth', authenticated: false };
        const native = { authMethod: 'NativeAuth', authenticated: true };
        const gatewayMessage = (command: string): string =>
            `Command ${command} is not allowed as the connection is not authenticated yet.`;

        function refuse(code: number, codeName: string, message = gatewayMessage): CommandScript {
            return async (command): Promise<Record<string, unknown>> => {
                if (command === 'ping') {
                    return { ok: 1 };
                }
                throw new MongoServerError({ message: message(command), code, codeName });
            };
        }

        function outcomes(result: CheckOutcome<FindingCode>): Record<string, unknown> {
            return Object.fromEntries(
                (result.facts.commands as { command: string; outcome: string }[]).map((item) => [
                    item.command,
                    item.outcome,
                ]),
            );
        }

        it.each([
            [13, 'Unauthorized'],
            [115, 'CommandNotSupported'],
            [18, 'AuthenticationFailed'],
        ])(
            'No authentication and a %s %s refusal require sign-in, as a warning',
            async (code, codeName): Promise<void> => {
                const result = await runAccess(fixture(refuse(code, codeName)).holder, { authFacts: noAuth });
                expect(result.status).toBe('warning');
                expect(outcomes(result)).toEqual({
                    ping: 'ok',
                    connectionStatus: 'signInRequired',
                    listDatabases: 'signInRequired',
                });
                expect(result.findings).toEqual([
                    expect.objectContaining({
                        code: 'access.signInRequired',
                        severity: 'warning',
                        data: { command: 'listDatabases' },
                    }),
                ]);
                expect(JSON.stringify(result)).not.toContain('not authenticated yet');
            },
        );

        it('a MongoDB API server with access control asks for authentication the same way', async (): Promise<void> => {
            const result = await runAccess(
                fixture(refuse(13, 'Unauthorized', (command) => `command ${command} requires authentication`)).holder,
                { authFacts: noAuth },
            );
            expect(outcomes(result).listDatabases).toBe('signInRequired');
            expect(result.findings.map((finding) => finding.code)).toEqual(['access.signInRequired']);
        });

        it('a signed-in method refused the same way is a permission: listing denied', async (): Promise<void> => {
            const result = await runAccess(fixture(refuse(13, 'Unauthorized')).holder, { authFacts: native });
            expect(result.status).toBe('warning');
            expect(outcomes(result)).toMatchObject({ connectionStatus: 'denied', listDatabases: 'denied' });
            expect(result.findings.map((finding) => finding.code)).toEqual(['access.listDatabasesDenied']);
        });

        it('unsupported commands stay "not supported", with or without authentication', async (): Promise<void> => {
            for (const authFacts of [noAuth, native]) {
                const result = await runAccess(
                    fixture(refuse(59, 'CommandNotFound', (command) => `no such command: '${command}'`)).holder,
                    { authFacts },
                );
                expect(result.status).toBe('pass');
                expect(outcomes(result)).toMatchObject({
                    connectionStatus: 'unsupported',
                    listDatabases: 'unsupported',
                });
                expect(result.findings).toEqual([]);
            }
        });
    });

    it('reports an empty listing as informational', async (): Promise<void> => {
        const { holder } = fixture(
            async (command): Promise<Record<string, unknown>> =>
                command === 'listDatabases' ? { databases: [] } : ok(command),
        );
        expect(await runAccess(holder)).toMatchObject({
            status: 'pass',
            facts: { databaseCount: 0 },
            findings: [{ code: 'access.noDatabasesVisible', severity: 'info', data: {} }],
        });
    });

    it.each(['read', 'readWrite', 'dbOwner', 'readAnyDatabase', 'readWriteAnyDatabase', 'root'])(
        'reports the first built-in read role: %s',
        async (role): Promise<void> => {
            const { holder } = fixture(
                async (command): Promise<Record<string, unknown>> =>
                    command === 'connectionStatus'
                        ? {
                              authInfo: {
                                  authenticatedUserRoles: [
                                      { role: 'custom', db: 'app' },
                                      { role, db: 'app' },
                                      { role: 'root', db: 'admin' },
                                  ],
                              },
                          }
                        : ok(command),
            );
            expect(await runAccess(holder)).toMatchObject({
                status: 'pass',
                findings: [{ code: 'access.readRoleReported', severity: 'info', data: { role, database: 'app' } }],
            });
        },
    );

    it('bounds reported roles and excludes users and privileges', async (): Promise<void> => {
        const { holder } = fixture(
            async (command): Promise<Record<string, unknown>> =>
                command === 'connectionStatus'
                    ? {
                          authInfo: {
                              authenticatedUserRoles: Array.from({ length: 40 }, (): object => ({
                                  role: 'custom',
                                  db: 'app',
                                  password: 'SECRET',
                              })),
                              authenticatedUsers: ['SECRET'],
                          },
                      }
                    : ok(command),
        );
        const result = await runAccess(holder);
        expect(result.facts.roles).toHaveLength(32);
        expect(JSON.stringify(result)).not.toContain('SECRET');
    });

    it.each([13, 59, 115])(
        'keeps denied or unsupported connectionStatus as a fact: %s',
        async (code): Promise<void> => {
            const { holder } = fixture(async (command): Promise<Record<string, unknown>> => {
                if (command === 'connectionStatus') throw new MongoServerError({ code, errmsg: 'SECRET' });
                return ok(command);
            });
            expect(await runAccess(holder)).toMatchObject({
                status: 'pass',
                findings: [],
                facts: {
                    commands: [
                        { outcome: 'ok' },
                        { outcome: code === 13 ? 'denied' : 'unsupported' },
                        { outcome: 'ok' },
                    ],
                },
            });
        },
    );

    it('fails an optional compressor error on ping without publishing its text', async (): Promise<void> => {
        const { holder } = fixture(async (command): Promise<Record<string, unknown>> => {
            if (command === 'ping')
                throw new MongoMissingDependencyError('SECRET', {
                    dependencyName: 'snappy',
                    cause: new Error('module unavailable'),
                });
            return ok(command);
        });
        const result = await runAccess(holder);
        expect(result).toMatchObject({
            status: 'fail',
            findings: [],
            facts: {
                command: 'ping',
                errorName: 'MongoMissingDependencyError',
                commands: [{ outcome: 'failed' }, { outcome: 'ok' }, { outcome: 'ok' }],
            },
        });
        expect(JSON.stringify(result)).not.toContain('SECRET');
    });

    it('keeps safe named-driver errors and codes but rejects arbitrary names and string codes', async (): Promise<void> => {
        for (const [name, code, errorName, errorCode] of [
            ['MongoNetworkError', 'ECONNRESET', 'MongoNetworkError', 'ECONNRESET'],
            ['SECRET-NAME', 'SECRET-CODE', 'unknown', undefined],
        ] as const) {
            const { holder } = fixture(async (command): Promise<Record<string, unknown>> => {
                if (command === 'ping') throw Object.assign(new Error('SECRET-MESSAGE'), { name, code });
                return ok(command);
            });
            const result = await runAccess(holder);
            expect(result).toMatchObject({ status: 'fail', facts: { errorName } });
            expect(result.facts.errorCode).toBe(errorCode);
            expect(JSON.stringify(result)).not.toContain('SECRET');
        }
    });

    it.each(['ping', 'connectionStatus', 'listDatabases'])(
        'does not fail a denied %s command',
        async (denied): Promise<void> => {
            const { holder } = fixture(async (command): Promise<Record<string, unknown>> => {
                if (command === denied) throw new MongoServerError({ code: 13, errmsg: 'denied' });
                return ok(command);
            });
            expect((await runAccess(holder)).status).toBe(denied === 'listDatabases' ? 'warning' : 'pass');
        },
    );

    for (const [profile, timeoutMs] of [
        ['default', 5000],
        ['longer', 10000],
    ] as const) {
        it.each(['ping', 'connectionStatus', 'listDatabases'])(
            `bounds %s at ${timeoutMs} ms under ${profile} and continues`,
            async (slow): Promise<void> => {
                vi.useFakeTimers();
                const { holder, command } = fixture(
                    async (name, options): Promise<Record<string, unknown>> =>
                        name === slow ? pending(options) : ok(name),
                );
                let finished = false;
                const running = runAccess(holder, { profile });
                void running.then((): void => {
                    finished = true;
                });
                await vi.advanceTimersByTimeAsync(timeoutMs - 1);
                expect(finished).toBe(false);
                await vi.advanceTimersByTimeAsync(1);
                const result = await running;
                expect(result).toMatchObject({
                    status: 'warning',
                    findings: [
                        {
                            code: 'check.timeout',
                            data: { operation: `connectionAccess.${slow}`, timeoutMs, source: 'check' },
                        },
                    ],
                });
                expect(result.facts.commands).toContainEqual({
                    command: slow,
                    outcome: 'timedOut',
                    durationMs: timeoutMs,
                });
                expect(command).toHaveBeenCalledTimes(3);
                expect(command.mock.calls.every((args): boolean => args[1].timeoutMS === timeoutMs)).toBe(true);
            },
        );
    }

    it('runs commands one at a time, with an independent timeout for each', async (): Promise<void> => {
        vi.useFakeTimers();
        let active = 0;
        let maximum = 0;
        const { holder, command } = fixture(async (_name, options): Promise<Record<string, unknown>> => {
            active++;
            maximum = Math.max(maximum, active);
            try {
                return await pending(options);
            } finally {
                active--;
            }
        });
        const running = runAccess(holder);
        await vi.advanceTimersByTimeAsync(4999);
        expect(command).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        expect(command).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5001);
        const result = await running;
        expect(result.status).toBe('warning');
        expect(result.findings).toHaveLength(3);
        expect(maximum).toBe(1);
        expect(active).toBe(0);
    });

    it.each(['ping', 'connectionStatus', 'listDatabases'])(
        'does not impose a diagnostic timeout on %s in the unbounded profile',
        async (slow): Promise<void> => {
            vi.useFakeTimers();
            let release: () => void = (): void => {};
            const { holder, command } = fixture(async (name): Promise<Record<string, unknown>> => {
                if (name === slow)
                    await new Promise<void>((resolve): void => {
                        release = resolve;
                    });
                return ok(name);
            });
            const running = runAccess(holder, { profile: 'noDiagnosticTimeouts' });
            await vi.advanceTimersByTimeAsync(20000);
            expect(command.mock.calls.every((args): boolean => args[1].timeoutMS === undefined)).toBe(true);
            release();
            expect((await running).status).toBe('pass');
        },
    );

    it.each(['context', 'client'] as const)(
        'lets a shorter %s connection timeout win',
        async (source): Promise<void> => {
            vi.useFakeTimers();
            const { holder } = fixture(
                async (name, options): Promise<Record<string, unknown>> =>
                    name === 'ping' ? pending(options) : ok(name),
                source === 'client' ? { timeoutMS: 200 } : {},
            );
            const running = runAccess(holder, { connectionTimeoutMs: source === 'context' ? 200 : undefined });
            await vi.advanceTimersByTimeAsync(200);
            expect(await running).toMatchObject({
                status: 'warning',
                findings: [
                    {
                        code: 'check.timeout',
                        data: { operation: 'connectionAccess.ping', timeoutMs: 200, source: 'connection' },
                    },
                ],
            });
        },
    );

    it.each(['fail', 'skipped'] as const)('is skipped when authentication is %s', async (authStatus): Promise<void> => {
        const { holder, command } = fixture(ok);
        expect(await runAccess(holder, { authStatus })).toMatchObject({
            status: 'skipped',
            skippedBecause: {
                reason: authStatus === 'fail' ? 'dependencyFailed' : 'dependencySkipped',
                checkId: 'authenticate',
            },
        });
        expect(command).not.toHaveBeenCalled();
    });
});
