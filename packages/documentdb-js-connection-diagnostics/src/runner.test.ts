/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createTimeoutFinding,
    formatTarget,
    runDiagnostics,
    SAFETY_LIMITS,
    DiagnosticsCancelledError,
    DiagnosticsConfigurationError,
} from './index.js';

import {
    type BuiltInFindingCode,
    type Check,
    type CheckOutcome,
    type CheckStepResult,
    type EffectiveTimeout,
    type ProbeTarget,
    type RunContext,
    type DiagnosticsClock,
    type DiagnosticsEvent,
    type DiagnosticsInput,
    type DiagnosticsRun,
} from './index.js';

type Code = BuiltInFindingCode | 'custom.note';
type TestCheck = Check<RunContext, Code>;
type Outcome = CheckOutcome<Code>;
type Event = DiagnosticsEvent<Code>;

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise): void => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function pass(): Outcome {
    return { status: 'pass', findings: [], facts: {} };
}

function check(id: string, options: Partial<Omit<TestCheck, 'id'>> = {}): TestCheck {
    return { id, scope: 'run', run: async (): Promise<Outcome> => pass(), ...options };
}

function target(host: string, port = 27017): ProbeTarget {
    return { host, port, source: 'uri' };
}

function prepare(targets: readonly ProbeTarget[]): TestCheck {
    return check('prepare', {
        run: async (context): Promise<Outcome> => {
            context.setTargets(targets);
            return pass();
        },
    });
}

async function flush(): Promise<void> {
    for (let index = 0; index < 40; index++) {
        await Promise.resolve();
    }
}

const input: DiagnosticsInput = { connectionString: 'mongodb://example.test' };

beforeEach((): void => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

afterEach((): void => {
    vi.useRealTimers();
});

describe('ordered host chains', (): void => {
    it('stores check order then target order despite reverse completion, and waits before run checks', async (): Promise<void> => {
        const targets = [target('a'), target('b'), target('c')];
        const pending = targets.map((): Deferred<Outcome> => deferred<Outcome>());
        const starts: string[] = [];
        const events: Event[] = [];
        const promise = runDiagnostics({
            input,
            checks: [
                prepare(targets),
                check('dns', {
                    scope: 'host',
                    run: (context): Promise<Outcome> => {
                        starts.push(`dns:${context.target?.host}`);
                        return pending[targets.findIndex((entry): boolean => entry.host === context.target?.host)]
                            .promise;
                    },
                }),
                check('tcp', {
                    scope: 'host',
                    dependsOn: ['dns'],
                    run: async (context): Promise<Outcome> => {
                        expect(context.getResult('dns', context.target)?.status).toBe('pass');
                        starts.push(`tcp:${context.target?.host}`);
                        return pass();
                    },
                }),
                check('authenticate', {
                    run: async (): Promise<Outcome> => {
                        expect(starts.filter((entry): boolean => entry.startsWith('tcp:'))).toHaveLength(3);
                        starts.push('authenticate');
                        return pass();
                    },
                }),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        await flush();
        pending[2].resolve(pass());
        await flush();
        pending[1].resolve(pass());
        await flush();
        expect(starts).not.toContain('authenticate');
        pending[0].resolve(pass());
        const run = await promise;
        expect(run.results.map((result): string => `${result.checkId}:${result.target ?? ''}`)).toEqual([
            'prepare:',
            'dns:a:27017',
            'dns:b:27017',
            'dns:c:27017',
            'tcp:a:27017',
            'tcp:b:27017',
            'tcp:c:27017',
            'authenticate:',
        ]);
        expect(
            events
                .filter((event): boolean => event.type === 'checkFinished')
                .map((event): string | undefined => (event.type === 'checkFinished' ? event.result.target : undefined)),
        ).toEqual([undefined, 'c:27017', 'c:27017', 'b:27017', 'b:27017', 'a:27017', 'a:27017', undefined]);
    });

    it('announces each host phase once with ordered checks and fixed formatted targets before any check starts', async (): Promise<void> => {
        const events: Event[] = [];
        await runDiagnostics({
            input,
            runId: 'phases',
            checks: [
                prepare([target('b', 10260), target('::1'), target('b', 10260), target('a')]),
                check('dns', { scope: 'host' }),
                check('tcp', { scope: 'host' }),
                check('replace', {
                    run: async (context): Promise<Outcome> => {
                        context.setTargets([target('replacement')]);
                        return pass();
                    },
                }),
                check('tls', { scope: 'host' }),
                check('hello', { scope: 'host' }),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        expect(events.filter((event): boolean => event.type === 'hostPhaseStarted')).toEqual([
            {
                type: 'hostPhaseStarted',
                runId: 'phases',
                checkIds: ['dns', 'tcp'],
                targets: ['b:10260', '[::1]:27017', 'a:27017'],
                at: 0,
            },
            {
                type: 'hostPhaseStarted',
                runId: 'phases',
                checkIds: ['tls', 'hello'],
                targets: ['replacement:27017'],
                at: 0,
            },
        ]);
        for (const [phase, firstCheck] of [
            ['dns', 'dns'],
            ['tls', 'tls'],
        ]) {
            expect(
                events.findIndex((event): boolean => event.type === 'hostPhaseStarted' && event.checkIds[0] === phase),
            ).toBeLessThan(
                events.findIndex((event): boolean => event.type === 'checkStarted' && event.checkId === firstCheck),
            );
        }
    });

    it('does not announce a host phase after cancellation, including cancellation during an announcement', async (): Promise<void> => {
        for (const cancelOn of ['checkFinished', 'hostPhaseStarted'] as const) {
            const controller = new AbortController();
            const events: Event[] = [];
            const promise = runDiagnostics({
                input,
                signal: controller.signal,
                checks: [prepare([target('a')]), check('dns', { scope: 'host' })],
                onEvent: (event): void => {
                    events.push(event);
                    if (event.type === cancelOn) {
                        controller.abort();
                    }
                },
            });
            await expect(promise).rejects.toBeInstanceOf(DiagnosticsCancelledError);
            expect(events.filter((event): boolean => event.type === 'hostPhaseStarted')).toHaveLength(
                cancelOn === 'checkFinished' ? 0 : 1,
            );
            expect(events.at(-1)?.type).toBe(cancelOn);
            expect(events.some((event): boolean => event.type === 'checkStarted' && event.checkId === 'dns')).toBe(
                false,
            );
        }
    });

    it('runs at most four of six chains concurrently', async (): Promise<void> => {
        const targets = Array.from({ length: 6 }, (_, index): ProbeTarget => target(`host${index}`));
        const pending = targets.map((): Deferred<Outcome> => deferred<Outcome>());
        let inFlight = 0;
        let peak = 0;
        const started: string[] = [];
        const promise = runDiagnostics({
            input,
            checks: [
                prepare(targets),
                check('probe', {
                    scope: 'host',
                    run: async (context): Promise<Outcome> => {
                        inFlight++;
                        peak = Math.max(peak, inFlight);
                        started.push(context.target?.host ?? '');
                        const result =
                            await pending[targets.findIndex((entry): boolean => entry.host === context.target?.host)]
                                .promise;
                        inFlight--;
                        return result;
                    },
                }),
            ],
        });
        await flush();
        expect(started).toHaveLength(4);
        pending[3].resolve(pass());
        await flush();
        expect(started).toHaveLength(5);
        pending[2].resolve(pass());
        await flush();
        expect(started).toHaveLength(6);
        pending.forEach((entry): void => entry.resolve(pass()));
        await promise;
        expect(peak).toBe(SAFETY_LIMITS.maxParallelHostChains);
    });

    it('supports multiple host phases and target replacement between them', async (): Promise<void> => {
        const run = await runDiagnostics({
            input,
            checks: [
                prepare([target('first')]),
                check('firstProbe', { scope: 'host' }),
                check('replace', {
                    run: async (context): Promise<Outcome> => {
                        context.setTargets([target('second')]);
                        return pass();
                    },
                }),
                check('secondProbe', { scope: 'host' }),
            ],
        });
        expect(run.results.map((result): string | undefined => result.target)).toEqual([
            undefined,
            'first:27017',
            undefined,
            'second:27017',
        ]);
    });

    it('skips missing required host inputs when a later phase probes a new target', async (): Promise<void> => {
        const run = await runDiagnostics({
            input,
            checks: [
                prepare([target('first')]),
                check('dns', { scope: 'host' }),
                check('replace', {
                    run: async (context): Promise<Outcome> => {
                        context.setTargets([target('second')]);
                        return pass();
                    },
                }),
                check('tcp', { scope: 'host', dependsOn: ['dns'] }),
            ],
        });
        expect(run.results[3]).toMatchObject({
            status: 'skipped',
            skippedBecause: { reason: 'inputUnavailable' },
            target: 'second:27017',
        });
    });

    it('deduplicates host and port in order, and disallows host-scope target changes', async (): Promise<void> => {
        const a = target('a');
        const run = await runDiagnostics({
            input,
            checks: [
                prepare([a, { ...a, source: 'srv' }, target('a', 27018), target('::1')]),
                check('probe', {
                    scope: 'host',
                    run: async (context): Promise<Outcome> => {
                        expect(context.targets).toHaveLength(3);
                        expect((): void => context.setTargets([])).toThrow(DiagnosticsConfigurationError);
                        return pass();
                    },
                }),
            ],
        });
        expect(run.targets).toEqual([a, target('a', 27018), target('::1')]);
        expect(run.results[3].target).toBe('[::1]:27017');
        expect(run.results.every((result): boolean => result.status === 'pass')).toBe(true);
        expect(formatTarget(target('[::1]'))).toBe('[::1]:27017');
    });
});

describe('required input dependencies', (): void => {
    it('accepts notApplicable, warning and pass as satisfied dependencies', async (): Promise<void> => {
        for (const outcome of [
            pass(),
            { ...pass(), status: 'warning' as const },
            {
                ...pass(),
                status: 'skipped' as const,
                skippedBecause: { reason: 'notApplicable' as const },
            },
        ]) {
            const run = await runDiagnostics({
                input,
                checks: [
                    check('dns', { run: async (): Promise<Outcome> => outcome }),
                    check('tcp', { dependsOn: ['dns'] }),
                ],
            });
            expect(run.results[1].status).toBe('pass');
        }
    });

    it('propagates failure origins within the same target only', async (): Promise<void> => {
        const run = await runDiagnostics({
            input,
            checks: [
                prepare([target('bad'), target('good')]),
                check('dns', {
                    scope: 'host',
                    run: async (context): Promise<Outcome> => ({
                        ...pass(),
                        status: context.target?.host === 'bad' ? 'fail' : 'pass',
                    }),
                }),
                check('tcp', { scope: 'host', dependsOn: ['dns'] }),
                check('tls', { scope: 'host', dependsOn: ['tcp'] }),
            ],
        });
        expect(run.results[3]).toMatchObject({
            status: 'skipped',
            skippedBecause: { reason: 'dependencyFailed', checkId: 'dns' },
            durationMs: 0,
            findings: [],
            facts: {},
        });
        expect(run.results[5].skippedBecause).toEqual({ reason: 'dependencySkipped', checkId: 'dns' });
        expect(run.results[6].status).toBe('pass');
    });

    it('names the skipped dependency itself unless it was a dependency skip', async (): Promise<void> => {
        const run = await runDiagnostics({
            input,
            checks: [
                check('origin', {
                    run: async (): Promise<Outcome> => ({
                        ...pass(),
                        status: 'skipped',
                        skippedBecause: { reason: 'inputUnavailable', checkId: 'unrelated' },
                    }),
                }),
                check('next', { dependsOn: ['origin'] }),
                check('last', { dependsOn: ['next'] }),
            ],
        });
        expect(run.results[1].skippedBecause).toEqual({ reason: 'dependencySkipped', checkId: 'origin' });
        expect(run.results[2].skippedBecause).toEqual({ reason: 'dependencySkipped', checkId: 'origin' });
    });

    it('records each empty-target host check once without starting it', async (): Promise<void> => {
        const events: Event[] = [];
        const run = await runDiagnostics({
            input,
            checks: [check('dns', { scope: 'host' }), check('tcp', { scope: 'host', dependsOn: ['dns'] })],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        expect(run.results).toHaveLength(2);
        for (const result of run.results) {
            expect(result).toEqual({
                checkId: result.checkId,
                status: 'skipped',
                skippedBecause: { reason: 'inputUnavailable' },
                durationMs: 0,
                findings: [],
                facts: {},
            });
        }
        expect(events.map((event): string => event.type)).toEqual([
            'hostPhaseStarted',
            'checkFinished',
            'checkFinished',
            'runFinished',
        ]);
        expect(events[0]).toEqual({
            type: 'hostPhaseStarted',
            runId: run.runId,
            checkIds: ['dns', 'tcp'],
            targets: [],
            at: 0,
        });
    });

    it.each(['fail', 'skipped'] as const)(
        'uses the run dependency origin for empty targets after %s',
        async (status): Promise<void> => {
            const run = await runDiagnostics({
                input,
                checks: [
                    check('origin', {
                        run: async (): Promise<Outcome> => ({
                            ...pass(),
                            status,
                            ...(status === 'skipped'
                                ? { skippedBecause: { reason: 'inputUnavailable' as const } }
                                : {}),
                        }),
                    }),
                    check('prepare', { dependsOn: ['origin'] }),
                    check('dns', { scope: 'host', dependsOn: ['prepare'] }),
                    check('tcp', { scope: 'host', dependsOn: ['dns'] }),
                ],
            });
            expect(run.results[2].skippedBecause).toEqual({ reason: 'dependencySkipped', checkId: 'origin' });
            expect(run.results[3].skippedBecause).toEqual({ reason: 'inputUnavailable' });
        },
    );

    it('names a directly failed run dependency when no targets are available', async (): Promise<void> => {
        const run = await runDiagnostics({
            input,
            checks: [
                check('prepare', { run: async (): Promise<Outcome> => ({ ...pass(), status: 'fail' }) }),
                check('dns', { scope: 'host', dependsOn: ['prepare'] }),
            ],
        });
        expect(run.results[1].skippedBecause).toEqual({ reason: 'dependencyFailed', checkId: 'prepare' });
    });
});

describe('configuration validation', (): void => {
    it.each([
        ['duplicate', [check('a'), check('a')]],
        ['unknown', [check('a', { dependsOn: ['missing'] })]],
        ['forward', [check('a', { dependsOn: ['b'] }), check('b')]],
        ['self', [check('a', { dependsOn: ['a'] })]],
        ['run-on-host', [check('a', { scope: 'host' }), check('b', { dependsOn: ['a'] })]],
    ] as const)('rejects %s dependencies before any events', async (_name, checks): Promise<void> => {
        const events: Event[] = [];
        await expect(
            runDiagnostics({
                input,
                checks,
                onEvent: (event): void => {
                    events.push(event);
                },
            }),
        ).rejects.toBeInstanceOf(DiagnosticsConfigurationError);
        expect(events).toEqual([]);
    });

    it('rejects invalid diagnostic and connection timeouts before events', async (): Promise<void> => {
        const onEvent = vi.fn();
        await expect(
            runDiagnostics({ input, checks: [], timeouts: { probeTimeoutMs: 0 }, onEvent }),
        ).rejects.toThrow('probeTimeoutMs');
        await expect(
            runDiagnostics({ input: { ...input, connectionTimeouts: { probe: -1 } }, checks: [], onEvent }),
        ).rejects.toBeInstanceOf(DiagnosticsConfigurationError);
        expect(onEvent).not.toHaveBeenCalled();
    });
});

describe('timeouts and coverage', (): void => {
    it('times out at the effective deadline, never one unit before, with no host in English detail', async (): Promise<void> => {
        const pending = deferred<Outcome>();
        const promise = runDiagnostics({
            input,
            checks: [
                prepare([target('private-host')]),
                check('dns', {
                    scope: 'host',
                    timeout: 'probe',
                    run: (): Promise<Outcome> => pending.promise,
                }),
            ],
            timeouts: { probeTimeoutMs: 125 },
        });
        let finished = false;
        void promise.then((): void => {
            finished = true;
        });
        await vi.advanceTimersByTimeAsync(124);
        expect(finished).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const run = await promise;
        expect(run.results[1]).toMatchObject({
            status: 'fail',
            durationMs: 125,
            facts: {},
            findings: [
                {
                    code: 'check.timeout',
                    severity: 'error',
                    data: { operation: 'dns', timeoutMs: 125, source: 'check', target: 'private-host:27017' },
                    detail: { language: 'en', text: 'The dns check did not finish within 125 ms.' },
                },
            ],
        });
        expect(run.results[1].findings).toHaveLength(1);
        expect(run.coverage).toEqual({
            limited: true,
            timedOut: [
                {
                    checkId: 'dns',
                    target: 'private-host:27017',
                    timeoutMs: 125,
                    source: 'check',
                },
            ],
            notStartedCount: 0,
            omittedTargetCount: 0,
            retryWouldHelp: true,
        });
        expect(run.durationMs).toBe(125);
    });

    it('keeps a default probe pending at five seconds and until ten seconds', async (): Promise<void> => {
        const pending = deferred<Outcome>();
        const events: Event[] = [];
        const promise = runDiagnostics({
            input,
            checks: [
                check('dns', {
                    timeout: 'probe',
                    run: (): Promise<Outcome> => pending.promise,
                }),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(events.map((event): string => event.type)).toEqual(['checkStarted']);
        await vi.advanceTimersByTimeAsync(4999);
        expect(events).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        const run = await promise;
        expect(run.results[0].findings[0].data).toEqual({ operation: 'dns', timeoutMs: 10_000, source: 'check' });
        expect(run.results[0].findings[0].detail.text).toBe('The dns check did not finish within 10 seconds.');
    });

    it('honors a shorter connection timeout without suggesting a diagnostic retry', async (): Promise<void> => {
        const promise = runDiagnostics({
            input: { ...input, connectionTimeouts: { probe: 200 } },
            checks: [check('tcp', { timeout: 'probe', run: (): Promise<Outcome> => deferred<Outcome>().promise })],
        });
        await vi.advanceTimersByTimeAsync(200);
        const run = await promise;
        expect(run.results[0].findings[0].data).toEqual({ operation: 'tcp', timeoutMs: 200, source: 'connection' });
        expect(run.coverage).toMatchObject({ limited: true, retryWouldHelp: false });
    });

    it('bounds in-flight work by the whole run and skips unstarted checks and queued targets', async (): Promise<void> => {
        const targets = Array.from({ length: 6 }, (_, index): ProbeTarget => target(`host${index}`));
        const promise = runDiagnostics({
            input,
            timeouts: { runTimeoutMs: 50 },
            checks: [
                prepare(targets),
                check('tcp', {
                    scope: 'host',
                    timeout: 'probe',
                    run: (): Promise<Outcome> => deferred<Outcome>().promise,
                }),
                check('tls', { scope: 'host', dependsOn: ['tcp'] }),
                check('authenticate'),
            ],
        });
        await vi.advanceTimersByTimeAsync(50);
        const run = await promise;
        expect(run.results.slice(1, 5).every((result): boolean => result.findings[0]?.data?.source === 'run')).toBe(
            true,
        );
        expect(run.results.slice(5, 7).map((result): unknown => result.skippedBecause)).toEqual([
            { reason: 'runTimeoutExceeded' },
            { reason: 'runTimeoutExceeded' },
        ]);
        expect(run.results[7].skippedBecause).toEqual({ reason: 'dependencyFailed', checkId: 'tcp' });
        expect(run.results.at(-1)?.skippedBecause).toEqual({ reason: 'runTimeoutExceeded' });
        expect(run.coverage).toMatchObject({ limited: true, notStartedCount: 3, retryWouldHelp: true });
        expect(run.coverage.timedOut).toHaveLength(4);
    });

    it('bounds checks without a timeout kind by only the whole-run timeout', async (): Promise<void> => {
        const promise = runDiagnostics({
            input,
            timeouts: { runTimeoutMs: 100 },
            checks: [check('work', { run: (): Promise<Outcome> => deferred<Outcome>().promise }), check('later')],
        });
        await vi.advanceTimersByTimeAsync(100);
        const run = await promise;
        expect(run.results[0].findings[0].data).toEqual({ operation: 'work', timeoutMs: 100, source: 'run' });
        expect(run.results[1].skippedBecause).toEqual({ reason: 'runTimeoutExceeded' });
    });

    it('skips dependents of a diagnostic timeout as dependencyFailed', async (): Promise<void> => {
        const promise = runDiagnostics({
            input,
            timeouts: { probeTimeoutMs: 50 },
            checks: [
                check('dns', { timeout: 'probe', run: (): Promise<Outcome> => deferred<Outcome>().promise }),
                check('tcp', { dependsOn: ['dns'] }),
            ],
        });
        await vi.advanceTimersByTimeAsync(50);
        const run = await promise;
        expect(run.results[1].skippedBecause).toEqual({ reason: 'dependencyFailed', checkId: 'dns' });
        expect(run.coverage.notStartedCount).toBe(0);
    });

    it('removes diagnostic deadlines without removing target limits', async (): Promise<void> => {
        const pending = deferred<Outcome>();
        const targets = Array.from({ length: 20 }, (_, index): ProbeTarget => target(`host${index}`));
        const promise = runDiagnostics({
            input,
            timeoutProfile: 'noDiagnosticTimeouts',
            checks: [
                prepare([...targets, targets[0]]),
                check('wait', { timeout: 'probe', run: (): Promise<Outcome> => pending.promise }),
            ],
        });
        await vi.advanceTimersByTimeAsync(1_000_000);
        expect(vi.getTimerCount()).toBe(0);
        pending.resolve(pass());
        const run = await promise;
        expect(run.targets).toEqual(targets.slice(0, 16));
        expect(run.timeoutProfile).toBe('noDiagnosticTimeouts');
        expect(run.coverage).toEqual({
            limited: true,
            timedOut: [],
            notStartedCount: 0,
            omittedTargetCount: 4,
            retryWouldHelp: false,
        });
    });

    it('retains connection deadlines under noDiagnosticTimeouts', async (): Promise<void> => {
        const promise = runDiagnostics({
            input: { ...input, connectionTimeouts: { probe: 5 } },
            timeoutProfile: 'noDiagnosticTimeouts',
            checks: [
                check('probe', {
                    timeout: 'probe',
                    run: (): Promise<Outcome> => deferred<Outcome>().promise,
                }),
            ],
        });
        await vi.advanceTimersByTimeAsync(5);
        const run = await promise;
        expect(run.coverage).toMatchObject({ limited: true, retryWouldHelp: false });
    });

    it.each(['resolve', 'reject'] as const)(
        'discards late %s after timeout with no more events',
        async (settlement): Promise<void> => {
            const pending = deferred<Outcome>();
            const events: Event[] = [];
            const promise = runDiagnostics({
                input,
                timeouts: { probeTimeoutMs: 10 },
                checks: [check('dns', { timeout: 'probe', run: (): Promise<Outcome> => pending.promise })],
                onEvent: (event): void => {
                    events.push(event);
                },
            });
            await vi.advanceTimersByTimeAsync(10);
            const run = await promise;
            const snapshot = JSON.stringify(run);
            const eventCount = events.length;
            if (settlement === 'resolve') {
                pending.resolve(pass());
            } else {
                pending.reject(new Error('must not leak'));
            }
            await flush();
            expect(JSON.stringify(run)).toBe(snapshot);
            expect(events).toHaveLength(eventCount);
        },
    );

    it('reports the least timeout with connection, check, run tie priority and remaining time', async (): Promise<void> => {
        const observed: EffectiveTimeout[] = [];
        const pending = deferred<Outcome>();
        const promise = runDiagnostics({
            input: { ...input, connectionTimeouts: { probe: 100 } },
            timeouts: { probeTimeoutMs: 100, runTimeoutMs: 100, srvTimeoutMs: 100, preparationTimeoutMs: null },
            checks: [
                check('observe', {
                    run: async (context): Promise<Outcome> => {
                        observed.push(context.effectiveTimeout('probe'), context.effectiveTimeout('srv'));
                        await pending.promise;
                        observed.push(context.effectiveTimeout('probe'));
                        return pass();
                    },
                }),
            ],
        });
        await vi.advanceTimersByTimeAsync(20);
        pending.resolve(pass());
        await promise;
        expect(observed).toEqual([
            { timeoutMs: 100, source: 'connection' },
            { timeoutMs: 100, source: 'check' },
            { timeoutMs: 80, source: 'run' },
        ]);
        const unbounded = await runDiagnostics({
            input,
            timeoutProfile: 'noDiagnosticTimeouts',
            checks: [
                check('unbounded', {
                    run: async (context): Promise<Outcome> => {
                        expect(context.effectiveTimeout('probe')).toEqual({ timeoutMs: null, source: null });
                        return pass();
                    },
                }),
            ],
        });
        expect(unbounded.results[0].status).toBe('pass');
    });

    it('includes inner-operation timeout findings in coverage', async (): Promise<void> => {
        const finding = createTimeoutFinding({ operation: 'ping', timeoutMs: 5000, source: 'check' });
        const run = await runDiagnostics({
            input,
            checks: [
                check('postConnect', {
                    run: async (): Promise<Outcome> => ({ ...pass(), status: 'fail', findings: [finding] }),
                }),
            ],
        });
        expect(run.coverage).toMatchObject({
            limited: true,
            retryWouldHelp: true,
            timedOut: [
                {
                    checkId: 'postConnect',
                    timeoutMs: 5000,
                    source: 'check',
                },
            ],
        });
    });
});

describe('cancellation and cleanup', (): void => {
    it('rejects before starting with an AbortError and emits nothing', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort();
        const onEvent = vi.fn();
        const run = vi.fn(async (): Promise<Outcome> => pass());
        const promise = runDiagnostics({ input, checks: [check('a', { run })], signal: controller.signal, onEvent });
        await expect(promise).rejects.toBeInstanceOf(DiagnosticsCancelledError);
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(onEvent).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
    });

    it('abandons in-flight checks, runs cleanups once in reverse, and emits nothing after abort', async (): Promise<void> => {
        const controller = new AbortController();
        const pending = deferred<Outcome>();
        const events: Event[] = [];
        const cleanupOrder: number[] = [];
        let checkSignal: AbortSignal | undefined;
        const promise = runDiagnostics({
            input,
            signal: controller.signal,
            checks: [
                check('a', {
                    run: (context, signal): Promise<Outcome> => {
                        checkSignal = signal;
                        context.addCleanup((): void => {
                            cleanupOrder.push(1);
                        });
                        context.addCleanup(async (): Promise<void> => {
                            cleanupOrder.push(2);
                            throw new Error('ignored');
                        });
                        context.addCleanup((): void => {
                            cleanupOrder.push(3);
                            throw new Error('ignored');
                        });
                        return pending.promise;
                    },
                }),
                check('never'),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        const rejection = expect(promise).rejects.toBeInstanceOf(DiagnosticsCancelledError);
        await flush();
        controller.abort();
        const eventCount = events.length;
        await rejection;
        expect(checkSignal?.aborted).toBe(true);
        expect(cleanupOrder).toEqual([3, 2, 1]);
        expect(vi.getTimerCount()).toBe(0);
        pending.reject(new Error('private late rejection'));
        await flush();
        expect(events).toHaveLength(eventCount);
        expect(events.map((event): string => event.type)).toEqual(['checkStarted']);
        expect(cleanupOrder).toEqual([3, 2, 1]);
    });

    it('cancels all parallel chains and does not start queued chains', async (): Promise<void> => {
        const controller = new AbortController();
        const cleanup = vi.fn();
        const starts = vi.fn();
        const promise = runDiagnostics({
            input,
            signal: controller.signal,
            checks: [
                prepare(Array.from({ length: 6 }, (_, index): ProbeTarget => target(`host${index}`))),
                check('wait', {
                    scope: 'host',
                    run: (context): Promise<Outcome> => {
                        starts();
                        context.addCleanup(cleanup);
                        return deferred<Outcome>().promise;
                    },
                }),
                check('later'),
            ],
        });
        const rejection = expect(promise).rejects.toBeInstanceOf(DiagnosticsCancelledError);
        await flush();
        expect(starts).toHaveBeenCalledTimes(4);
        controller.abort();
        await rejection;
        expect(cleanup).toHaveBeenCalledTimes(4);
        expect(starts).toHaveBeenCalledTimes(4);
    });

    it('runs late registered cleanup immediately after completion or cancellation', async (): Promise<void> => {
        for (const shouldCancel of [false, true]) {
            let saved: RunContext | undefined;
            const controller = new AbortController();
            const pending = deferred<Outcome>();
            const cleanup = vi.fn();
            const promise = runDiagnostics({
                input,
                signal: controller.signal,
                checks: [
                    check('work', {
                        run: (context): Promise<Outcome> => {
                            saved = context;
                            return pending.promise;
                        },
                    }),
                ],
            });
            const observed = promise.catch((error: unknown): unknown => error);
            await flush();
            if (shouldCancel) {
                controller.abort();
            } else {
                pending.resolve(pass());
            }
            await observed;
            saved?.addCleanup(cleanup);
            expect(cleanup).toHaveBeenCalledTimes(1);
            saved?.addCleanup((): void => {
                throw new Error('ignored');
            });
            await flush();
        }
    });

    it('cleans up after successful and timed-out runs', async (): Promise<void> => {
        for (const timeout of [false, true]) {
            const cleanup = vi.fn();
            const promise = runDiagnostics({
                input,
                timeouts: { probeTimeoutMs: 1 },
                checks: [
                    check('work', {
                        timeout: 'probe',
                        run: (context): Promise<Outcome> => {
                            context.addCleanup(cleanup);
                            return timeout ? deferred<Outcome>().promise : Promise.resolve(pass());
                        },
                    }),
                ],
            });
            if (timeout) {
                await vi.advanceTimersByTimeAsync(1);
            }
            await promise;
            expect(cleanup).toHaveBeenCalledTimes(1);
        }
    });

    it('cleans up and detaches observers on unexpected runner errors', async (): Promise<void> => {
        const cleanup = vi.fn();
        const controller = new AbortController();
        const clock: DiagnosticsClock = {
            now: (): number => Date.now(),
            setTimeout: (): unknown => {
                throw new Error('clock failed');
            },
            clearTimeout: (): void => {},
        };
        // No timer for preparation; the following check exercises a runner-owned timer failure.
        const promise = runDiagnostics({
            input,
            signal: controller.signal,
            io: { clock },
            timeoutProfile: 'noDiagnosticTimeouts',
            timeouts: { probeTimeoutMs: 1 },
            checks: [
                check('prepare', {
                    run: async (context): Promise<Outcome> => {
                        context.addCleanup(cleanup);
                        return pass();
                    },
                }),
                check('probe', { timeout: 'probe' }),
            ],
        });
        await expect(promise).rejects.toThrow('clock failed');
        controller.abort();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});

describe('results, clock and events', (): void => {
    it('records unexpected error names only, never messages or inputs', async (): Promise<void> => {
        const secret = 'private-credentials';
        const events: Event[] = [];
        const cleanup = vi.fn();
        const run = await runDiagnostics({
            input: { connectionString: secret },
            checks: [
                check('named', {
                    run: async (context): Promise<Outcome> => {
                        context.addCleanup(cleanup);
                        throw new TypeError(secret);
                    },
                }),
                check('value', {
                    run: async (): Promise<Outcome> => {
                        throw new Error(secret);
                    },
                }),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        expect(run.results[0]).toMatchObject({
            status: 'fail',
            findings: [],
            facts: { unexpectedError: true, errorName: 'TypeError' },
        });
        expect(run.results[1].facts).toEqual({ unexpectedError: true, errorName: 'Error' });
        expect(JSON.stringify([run, events])).not.toContain(secret);
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('passes steps unchanged, emits no step events, and finishes the run last', async (): Promise<void> => {
        const events: Event[] = [];
        const steps: readonly CheckStepResult<Code>[] = [
            {
                stepId: 'auth.configuration',
                status: 'pass',
                durationMs: 3,
                findings: [],
                facts: {},
            },
        ];
        const run = await runDiagnostics({
            input,
            runId: 'chosen',
            checks: [
                check('auth', {
                    run: async (context): Promise<Outcome> => {
                        expect(context.runId).toBe('chosen');
                        expect(context.input).toBe(input);
                        expect(context.target).toBeUndefined();
                        expect(context.getResult('missing')).toBeUndefined();
                        return { ...pass(), steps };
                    },
                }),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        expect(run.results[0].steps).toBe(steps);
        expect(run.results[0].status).toBe('pass');
        expect(events).toEqual([
            { type: 'checkStarted', runId: 'chosen', checkId: 'auth', at: 0 },
            { type: 'checkFinished', runId: 'chosen', result: run.results[0], at: 0 },
            { type: 'runFinished', runId: 'chosen', run, at: 0 },
        ]);
        expect(run.coverage).toEqual({
            limited: false,
            timedOut: [],
            notStartedCount: 0,
            omittedTargetCount: 0,
            retryWouldHelp: false,
        });
    });

    it('uses the injected clock for timers, events and durations', async (): Promise<void> => {
        const pending = deferred<Outcome>();
        let now = 120;
        let fire: (() => void) | undefined;
        const clearTimeout = vi.fn();
        const clock: DiagnosticsClock = {
            now: (): number => now,
            setTimeout: (callback, ms): unknown => {
                expect(ms).toBe(25);
                fire = callback;
                return 'handle';
            },
            clearTimeout,
        };
        const events: Event[] = [];
        const promise = runDiagnostics({
            input,
            io: { clock },
            timeouts: { probeTimeoutMs: 25 },
            checks: [
                check('probe', {
                    timeout: 'probe',
                    run: (context): Promise<Outcome> => {
                        expect(context.io.clock).toBe(clock);
                        return pending.promise;
                    },
                }),
            ],
            onEvent: (event): void => {
                events.push(event);
            },
        });
        now = 145;
        fire?.();
        const run = await promise;
        expect(run).toMatchObject({ startedAt: 120, finishedAt: 145, durationMs: 25 });
        expect(run.results[0].durationMs).toBe(25);
        expect(events.map((event): number => event.at)).toEqual([120, 145, 145]);
        expect(clearTimeout).toHaveBeenCalledWith('handle');
    });

    it('creates fresh run IDs for each invocation', async (): Promise<void> => {
        const first: DiagnosticsRun<Code> = await runDiagnostics({ input, checks: [] });
        const second = await runDiagnostics({ input, checks: [] });
        expect(first.runId).not.toBe(second.runId);
        expect(first.runId).toMatch(/^[a-f0-9-]{36}$/);
    });
});
