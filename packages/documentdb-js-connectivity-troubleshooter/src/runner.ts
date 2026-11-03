/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';

import { TroubleshooterCancelledError, TroubleshooterConfigurationError } from './errors.js';
import { resolveTimeouts, SAFETY_LIMITS } from './timeouts.js';

import { type BuiltInFindingCode } from './findingCodes.js';
import { type EffectiveTimeout, type TimeoutKind, type TimeoutProfile, type TimeoutSource } from './timeouts.js';
import {
    type Check,
    type CheckOutcome,
    type CheckResult,
    type Finding,
    type ProbeTarget,
    type RunContext,
    type TimedOutOperation,
    type TroubleshooterClock,
    type TroubleshooterEvent,
    type TroubleshooterInput,
    type TroubleshooterIo,
    type TroubleshooterRun,
    type TroubleshooterTimeouts,
} from './types.js';

const defaultClock: TroubleshooterClock = {
    now: (): number => Date.now(),
    setTimeout: (callback, ms): unknown => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle): void => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function formatTarget(target: ProbeTarget): string {
    const host = target.host.includes(':') && !target.host.startsWith('[') ? `[${target.host}]` : target.host;
    return `${host}:${target.port}`;
}

export function createTimeoutFinding(data: {
    operation: string;
    timeoutMs: number;
    source: TimeoutSource;
    target?: string;
}): Finding<'check.timeout'> {
    const duration = data.timeoutMs < 1000 ? `${data.timeoutMs} ms` : `${data.timeoutMs / 1000} seconds`;
    return {
        code: 'check.timeout',
        severity: 'error',
        data: {
            operation: data.operation,
            timeoutMs: data.timeoutMs,
            source: data.source,
            ...(data.target === undefined ? {} : { target: data.target }),
        },
        detail: { language: 'en', text: `The ${data.operation} check did not finish within ${duration}.` },
    };
}

export async function runTroubleshooter<TCode extends string>(options: {
    input: TroubleshooterInput;
    checks: readonly Check<RunContext, TCode | BuiltInFindingCode>[];
    timeoutProfile?: TimeoutProfile;
    timeouts?: Partial<TroubleshooterTimeouts>;
    signal?: AbortSignal;
    onEvent?: (event: TroubleshooterEvent<TCode | BuiltInFindingCode>) => void;
    io?: Partial<TroubleshooterIo>;
    runId?: string;
}): Promise<TroubleshooterRun<TCode | BuiltInFindingCode>> {
    type Code = TCode | BuiltInFindingCode;
    const { checks, signal } = options;
    const timeoutProfile = options.timeoutProfile ?? 'default';
    const timeouts = resolveTimeouts(timeoutProfile, options.timeouts);
    const connectionTimeouts = options.input.connectionTimeouts;
    const kinds: readonly TimeoutKind[] = ['preparation', 'srv', 'probe', 'authentication', 'postConnect'];
    for (const kind of kinds) {
        if (connectionTimeouts && Object.hasOwn(connectionTimeouts, kind)) {
            const value = connectionTimeouts[kind];
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                throw new TroubleshooterConfigurationError(`Invalid connection timeout: ${kind}`);
            }
        }
    }

    const checksById = new Map<string, Check<RunContext, Code>>();
    for (const check of checks) {
        if (checksById.has(check.id)) {
            throw new TroubleshooterConfigurationError(`Duplicate check ID: ${check.id}`);
        }
        checksById.set(check.id, check);
    }
    const preceding = new Set<string>();
    for (const check of checks) {
        for (const id of check.dependsOn ?? []) {
            const dependency = checksById.get(id);
            if (!dependency || !preceding.has(id)) {
                throw new TroubleshooterConfigurationError(`Unknown or forward dependency: ${id}`);
            }
            if (check.scope === 'run' && dependency.scope === 'host') {
                throw new TroubleshooterConfigurationError(`Run check cannot depend on host check: ${id}`);
            }
        }
        preceding.add(check.id);
    }
    if (signal?.aborted) {
        throw new TroubleshooterCancelledError();
    }

    const io: TroubleshooterIo = {
        clock: options.io?.clock ?? defaultClock,
        environment: options.io?.environment,
        dns: options.io?.dns,
        net: options.io?.net,
        readFile: options.io?.readFile,
    };
    const { clock } = io;
    const runId = options.runId ?? randomUUID();
    const startedAt = clock.now();
    const stored = new Map<string, Map<string, CheckResult<Code>>>();
    const orderedResults: CheckResult<Code>[][] = checks.map((): CheckResult<Code>[] => []);
    const timedOut: TimedOutOperation[] = [];
    const activeChecks = new Set<() => void>();
    const cleanups: (() => void | Promise<void>)[] = [];
    let targets: readonly ProbeTarget[] = [];
    let omittedTargetCount = 0;
    let notStartedCount = 0;
    let cancelled = false;
    let ended = false;

    function ensureNotCancelled(): void {
        if (cancelled || signal?.aborted) {
            throw new TroubleshooterCancelledError();
        }
    }

    function cancel(): void {
        cancelled = true;
        for (const cancelCheck of activeChecks) {
            cancelCheck();
        }
    }

    function emit(event: TroubleshooterEvent<Code>): void {
        if (!ended && !cancelled && !signal?.aborted) {
            try {
                options.onEvent?.(event);
            } catch {
                // Observers cannot interrupt scheduling or resource cleanup.
            }
        }
    }

    async function runCleanup(cleanup: () => void | Promise<void>): Promise<void> {
        try {
            await cleanup();
        } catch {
            // Cleanup is best-effort, including for abandoned operations that settle later.
        }
    }

    function addCleanup(cleanup: () => void | Promise<void>): void {
        if (ended) {
            void runCleanup(cleanup);
        } else {
            cleanups.push(cleanup);
        }
    }

    function targetKey(target?: ProbeTarget): string {
        return target ? JSON.stringify([target.host, target.port]) : '';
    }

    function getResult(checkId: string, target?: ProbeTarget): CheckResult<Code> | undefined {
        return stored.get(checkId)?.get(targetKey(target));
    }

    function remainingRunMs(): number | null {
        return timeouts.runTimeoutMs === null ? null : Math.max(0, timeouts.runTimeoutMs - (clock.now() - startedAt));
    }

    function effectiveTimeout(kind?: TimeoutKind): EffectiveTimeout {
        let selected: EffectiveTimeout = { timeoutMs: null, source: null };
        // Strict comparison keeps the tie priority: connection, check, run.
        const candidates: readonly EffectiveTimeout[] = [
            { timeoutMs: kind ? (connectionTimeouts?.[kind] ?? null) : null, source: 'connection' },
            { timeoutMs: kind ? timeouts[`${kind}TimeoutMs`] : null, source: 'check' },
            { timeoutMs: remainingRunMs(), source: 'run' },
        ];
        for (const candidate of candidates) {
            if (
                candidate.timeoutMs !== null &&
                (selected.timeoutMs === null || candidate.timeoutMs < selected.timeoutMs)
            ) {
                selected = candidate;
            }
        }
        return selected;
    }

    function recordResult(index: number, result: CheckResult<Code>, target?: ProbeTarget, targetIndex = 0): void {
        ensureNotCancelled();
        let byTarget = stored.get(result.checkId);
        if (!byTarget) {
            byTarget = new Map();
            stored.set(result.checkId, byTarget);
        }
        byTarget.set(targetKey(target), result);
        orderedResults[index][targetIndex] = result;
        if (result.skippedBecause?.reason === 'runTimeoutExceeded') {
            notStartedCount++;
        }
        for (const finding of result.findings) {
            const data = finding.data;
            if (
                finding.code === 'check.timeout' &&
                data &&
                typeof data.timeoutMs === 'number' &&
                Number.isFinite(data.timeoutMs) &&
                data.timeoutMs > 0 &&
                (data.source === 'check' || data.source === 'run' || data.source === 'connection')
            ) {
                const timeoutTarget = typeof data.target === 'string' ? data.target : result.target;
                timedOut.push({
                    checkId: result.checkId,
                    ...(timeoutTarget === undefined ? {} : { target: timeoutTarget }),
                    timeoutMs: data.timeoutMs,
                    source: data.source,
                });
            }
        }
        emit({ type: 'checkFinished', runId, result, at: clock.now() });
    }

    async function execute(index: number, target?: ProbeTarget, targetIndex = 0): Promise<void> {
        ensureNotCancelled();
        const check = checks[index];
        const dependencies = (check.dependsOn ?? [])
            .filter((id): boolean => target !== undefined || checksById.get(id)?.scope === 'run')
            .map((id): CheckResult<Code> | undefined =>
                getResult(id, checksById.get(id)?.scope === 'host' ? target : undefined),
            );
        const failed = dependencies.find((result): boolean => result?.status === 'fail');
        const skipped = dependencies.find(
            (result): boolean => result?.status === 'skipped' && result.skippedBecause?.reason !== 'notApplicable',
        );
        let skippedBecause: CheckResult<Code>['skippedBecause'];
        if (failed) {
            skippedBecause = { reason: 'dependencyFailed', checkId: failed.checkId };
        } else if (skipped) {
            const reason = skipped.skippedBecause?.reason;
            const origin =
                reason === 'dependencyFailed' || reason === 'dependencySkipped'
                    ? (skipped.skippedBecause?.checkId ?? skipped.checkId)
                    : skipped.checkId;
            skippedBecause = { reason: 'dependencySkipped', checkId: origin };
        } else if (remainingRunMs() === 0) {
            skippedBecause = { reason: 'runTimeoutExceeded' };
        } else if ((check.scope === 'host' && !target) || dependencies.some((result): boolean => !result)) {
            skippedBecause = { reason: 'inputUnavailable' };
        }
        const identity = { checkId: check.id, ...(target ? { target: formatTarget(target) } : {}) };
        if (skippedBecause) {
            recordResult(
                index,
                { ...identity, status: 'skipped', skippedBecause, durationMs: 0, findings: [], facts: {} },
                target,
                targetIndex,
            );
            return;
        }

        const checkStartedAt = clock.now();
        const timeout = effectiveTimeout(check.timeout);
        let active = true;
        const context: RunContext = {
            runId,
            input: options.input,
            io,
            ...(target ? { target } : {}),
            get targets(): readonly ProbeTarget[] {
                return targets;
            },
            setTargets: (nextTargets): void => {
                if (check.scope !== 'run' || !active || ended || cancelled || signal?.aborted) {
                    throw new TroubleshooterConfigurationError('Only an active run-scope check may set targets');
                }
                const seen = new Set<string>();
                const selected: ProbeTarget[] = [];
                let omitted = 0;
                for (const nextTarget of nextTargets) {
                    const key = targetKey(nextTarget);
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    if (selected.length < SAFETY_LIMITS.maxTargets) {
                        selected.push({ host: nextTarget.host, port: nextTarget.port, source: nextTarget.source });
                    } else {
                        omitted++;
                    }
                }
                targets = selected;
                omittedTargetCount = omitted;
            },
            getResult,
            effectiveTimeout,
            addCleanup,
        };
        const settled = await new Promise<{ outcome: CheckOutcome<Code>; finishedAt: number }>(
            (resolve, reject): void => {
                const controller = new AbortController();
                let timer: unknown;
                let hasTimer = false;
                function detach(): void {
                    active = false;
                    if (hasTimer) {
                        clock.clearTimeout(timer);
                        hasTimer = false;
                    }
                    activeChecks.delete(cancelCheck);
                }
                function cancelCheck(): void {
                    if (active) {
                        detach();
                        reject(new TroubleshooterCancelledError());
                        controller.abort();
                    }
                }
                function finish(outcome: CheckOutcome<Code>): void {
                    if (active) {
                        detach();
                        resolve({ outcome, finishedAt: clock.now() });
                    }
                }
                function fail(error: unknown): void {
                    finish({
                        status: 'fail',
                        findings: [],
                        facts: { unexpectedError: true, errorName: error instanceof Error ? error.name : 'Error' },
                    });
                }
                activeChecks.add(cancelCheck);
                if (timeout.timeoutMs !== null && timeout.source !== null) {
                    const { timeoutMs, source } = timeout;
                    timer = clock.setTimeout((): void => {
                        if (active) {
                            finish({
                                status: 'fail',
                                findings: [
                                    createTimeoutFinding({
                                        operation: check.id,
                                        timeoutMs,
                                        source,
                                        ...(identity.target === undefined ? {} : { target: identity.target }),
                                    }),
                                ],
                                facts: {},
                            });
                            controller.abort();
                        }
                    }, timeoutMs);
                    hasTimer = true;
                }
                emit({ type: 'checkStarted', runId, ...identity, at: checkStartedAt });
                if (!active || cancelled || signal?.aborted) {
                    return;
                }
                try {
                    void check.run(context, controller.signal).then(finish, fail);
                } catch (error) {
                    fail(error);
                }
            },
        );
        ensureNotCancelled();
        const outcome = { ...settled.outcome };
        Reflect.deleteProperty(outcome, 'target');
        recordResult(
            index,
            { ...outcome, ...identity, durationMs: settled.finishedAt - checkStartedAt },
            target,
            targetIndex,
        );
    }

    signal?.addEventListener('abort', cancel, { once: true });
    try {
        ensureNotCancelled();
        let index = 0;
        while (index < checks.length) {
            if (checks[index].scope === 'run') {
                await execute(index++);
                continue;
            }
            const phaseStart = index;
            while (index < checks.length && checks[index].scope === 'host') {
                index++;
            }
            const phaseEnd = index;
            const phaseTargets = targets;
            ensureNotCancelled();
            emit({
                type: 'hostPhaseStarted',
                runId,
                checkIds: checks.slice(phaseStart, phaseEnd).map((check): string => check.id),
                targets: phaseTargets.map(formatTarget),
                at: clock.now(),
            });
            if (phaseTargets.length === 0) {
                for (let hostCheck = phaseStart; hostCheck < phaseEnd; hostCheck++) {
                    await execute(hostCheck);
                }
                continue;
            }
            let nextTarget = 0;
            async function runHostChains(): Promise<void> {
                while (nextTarget < phaseTargets.length) {
                    ensureNotCancelled();
                    const targetIndex = nextTarget++;
                    for (let hostCheck = phaseStart; hostCheck < phaseEnd; hostCheck++) {
                        await execute(hostCheck, phaseTargets[targetIndex], targetIndex);
                    }
                }
            }
            await Promise.all(
                Array.from(
                    { length: Math.min(SAFETY_LIMITS.maxParallelHostChains, phaseTargets.length) },
                    runHostChains,
                ),
            );
        }
        ensureNotCancelled();
        const finishedAt = clock.now();
        const run: TroubleshooterRun<Code> = {
            runId,
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            timeoutProfile,
            timeouts,
            targets,
            results: orderedResults.flat(),
            coverage: {
                limited: timedOut.length > 0 || notStartedCount > 0 || omittedTargetCount > 0,
                timedOut,
                notStartedCount,
                omittedTargetCount,
                retryWouldHelp:
                    notStartedCount > 0 || timedOut.some((operation): boolean => operation.source !== 'connection'),
            },
        };
        emit({ type: 'runFinished', runId, run, at: finishedAt });
        ensureNotCancelled();
        return run;
    } finally {
        ended = true;
        signal?.removeEventListener('abort', cancel);
        for (const cancelCheck of activeChecks) {
            cancelCheck();
        }
        for (const cleanup of cleanups.reverse()) {
            await runCleanup(cleanup);
        }
        cleanups.length = 0;
    }
}
