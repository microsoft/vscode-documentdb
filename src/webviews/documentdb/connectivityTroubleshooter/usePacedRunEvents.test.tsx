/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, useEffect, type JSX } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

import { type RunUpdate } from './connectivityTroubleshooterTypes';
import { panelRowIds, type PanelRow, type PanelRowId, type PanelRowStatus } from './panelTypes';
import { defaultStepPacing, RunEventPacer, usePacedRunEvents, type StepPacing } from './usePacedRunEvents';

vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixed: StepPacing = { stepMs: 300, jitterMs: 0 };

function rows(statuses: Partial<Record<PanelRowId, PanelRowStatus>>): PanelRow[] {
    return panelRowIds.map((id): PanelRow => ({ id, status: statuses[id] ?? 'pending', segments: [] }));
}

/** Rows 1..`settled` done, the next one checking. */
function progress(settled: number): PanelRow[] {
    return panelRowIds.map(
        (id, index): PanelRow => ({
            id,
            status: index < settled ? 'done' : index === settled ? 'active' : 'pending',
            segments: index === settled ? [{ kind: 'checking' }] : [],
        }),
    );
}

const started = (runId = 'run-1'): RunUpdate => ({ type: 'started', runId, startedAt: 0, rows: rows({}) });
const finished = (runId = 'run-1', final = progress(8)): RunUpdate => ({
    type: 'finished',
    runId,
    finishedAt: 1,
    rows: final,
    outcome: 'connected',
    result: {
        outcome: 'connected',
        firewallHint: false,
        earlierSignInFailure: false,
        runTimeoutBeforeAttempt: false,
        authenticated: true,
    },
    coverage: { limited: false, retryWouldHelp: false, connectionTimeoutLimited: false },
});

/** Every update a fast run sends: each row starts, then settles, and then the run finishes. */
function instantRun(runId = 'run-1'): RunUpdate[] {
    const updates: RunUpdate[] = [started(runId)];
    for (let index = 0; index < panelRowIds.length; index++) {
        updates.push({ type: 'rows', runId, rows: progress(index) });
    }
    updates.push(finished(runId));
    return updates;
}

interface Shown {
    readonly at: number;
    readonly type: RunUpdate['type'];
    readonly statuses: string;
}

const symbol: Record<PanelRowStatus, string> = {
    pending: '.',
    active: 'a',
    done: 'd',
    warning: 'w',
    error: 'e',
    skipped: 's',
};

function harness(pacing: StepPacing = fixed, random?: () => number): { pacer: RunEventPacer; shown: Shown[] } {
    const shown: Shown[] = [];
    const pacer = new RunEventPacer(
        (update): void => {
            shown.push({
                at: performance.now(),
                type: update.type,
                statuses: 'rows' in update ? update.rows.map((row): string => symbol[row.status]).join('') : '',
            });
        },
        { pacing, random },
    );
    return { pacer, shown };
}

/** The times at which each settled row and the card were first shown, relative to `start`. */
function settleTimes(shown: readonly Shown[], startAt: number): number[] {
    const times: number[] = [];
    let settled = 0;
    for (const entry of shown) {
        const count = [...entry.statuses].filter((status): boolean => 'dwes'.includes(status)).length;
        for (; settled < count; settled++) times.push(entry.at - startAt);
        if (entry.type === 'finished') times.push(entry.at - startAt);
    }
    return times;
}

describe('RunEventPacer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('defaults to 400 ms per step with 100 ms of jitter either way (decision 0043)', () => {
        expect(defaultStepPacing).toEqual({ stepMs: 400, jitterMs: 100 });
    });

    it('shows each settled row and then the card at least one step after the previous one', () => {
        const { pacer, shown } = harness();
        const startAt = performance.now();
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        // `started` and the first row's "Checking…" show at once; nothing has settled yet.
        expect(shown.map((entry): string => entry.statuses)).toEqual(['........', 'a.......']);
        vi.advanceTimersByTime(299);
        expect(shown).toHaveLength(2);
        vi.advanceTimersByTime(1);
        expect(shown.slice(2).map((entry): string => entry.statuses)).toEqual(['d.......', 'da......']);
        vi.runAllTimers();
        expect(settleTimes(shown, startAt)).toEqual([300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700]);
        expect(shown[shown.length - 1]).toMatchObject({ type: 'finished', statuses: 'dddddddd' });
    });

    it('shows a row checking only after the row before it settles, and never checking once settled', () => {
        const { pacer, shown } = harness();
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        vi.runAllTimers();
        const statuses = shown.map((entry): string => entry.statuses);
        expect(statuses).toEqual([
            '........',
            'a.......',
            'd.......',
            'da......',
            'dd......',
            'dda.....',
            'ddd.....',
            'ddda....',
            'dddd....',
            'dddda...',
            'ddddd...',
            'ddddda..',
            'dddddd..',
            'dddddda.',
            'ddddddd.',
            'ddddddda',
            'dddddddd',
            'dddddddd',
        ]);
        for (const id of panelRowIds.keys()) {
            const firstSettled = statuses.findIndex((value): boolean => value[id] === 'd');
            expect(statuses.slice(firstSettled).every((value): boolean => value[id] === 'd')).toBe(true);
        }
    });

    it('splits an update that settles several rows into one step per row, in row order', () => {
        const { pacer, shown } = harness();
        const startAt = performance.now();
        pacer.start(1);
        pacer.push(1, started());
        pacer.push(1, {
            type: 'rows',
            runId: 'run-1',
            rows: rows({
                setup: 'done',
                connectionSettings: 'error',
                serverAddress: 'skipped',
                networkConnection: 'skipped',
            }),
        });
        vi.runAllTimers();
        expect(shown.map((entry): string => entry.statuses)).toEqual([
            '........',
            'd.......',
            'de......',
            'des.....',
            'dess....',
        ]);
        expect(settleTimes(shown, startAt)).toEqual([300, 600, 900, 1200]);
    });

    it('keeps the rhythm for a failed row and the skipped rows after it', () => {
        const { pacer, shown } = harness();
        const startAt = performance.now();
        pacer.start(1);
        pacer.push(1, started());
        const failed = rows({
            setup: 'done',
            connectionSettings: 'done',
            serverAddress: 'error',
            networkConnection: 'skipped',
            secureConnection: 'skipped',
            serverResponse: 'skipped',
            authentication: 'skipped',
            databaseAccess: 'skipped',
        });
        pacer.push(1, finished('run-1', failed));
        vi.runAllTimers();
        expect(settleTimes(shown, startAt)).toEqual([300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700]);
        expect(shown[shown.length - 1]).toMatchObject({ type: 'finished', statuses: 'ddesssss' });
    });

    it('adds no delay to a step that took longer than its minimum', () => {
        const { pacer, shown } = harness();
        const startAt = performance.now();
        pacer.start(1);
        pacer.push(1, started());
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(0) });
        vi.advanceTimersByTime(1_000);
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(1) });
        // Shown the moment it arrives; the next fast step then waits one step from here.
        expect(settleTimes(shown, startAt)).toEqual([1_000]);
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(2) });
        vi.advanceTimersByTime(299);
        expect(settleTimes(shown, startAt)).toEqual([1_000]);
        vi.advanceTimersByTime(1);
        expect(settleTimes(shown, startAt)).toEqual([1_000, 1_300]);
    });

    it('draws every minimum from 300 to 500 ms with the default jitter', () => {
        const draws = [0, 0.999_999, 0.5, 0.25, 0.75, 0.1, 0.9, 0.4, 0.6];
        const random = vi.fn((): number => draws.shift() ?? 0.5);
        const { pacer, shown } = harness(defaultStepPacing, random);
        const startAt = performance.now();
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        vi.runAllTimers();
        const times = settleTimes(shown, startAt);
        const gaps = times.map((time, index): number => time - (index === 0 ? 0 : times[index - 1]));
        expect(random).toHaveBeenCalledTimes(9);
        expect(gaps.map(Math.round)).toEqual([300, 500, 400, 350, 450, 320, 480, 380, 420]);
    });

    it('keeps every sampled minimum within 300 to 500 ms for any random source value', () => {
        for (let trial = 0; trial < 50; trial++) {
            const { pacer, shown } = harness(defaultStepPacing, Math.random);
            const startAt = performance.now();
            pacer.start(trial);
            for (const update of instantRun()) pacer.push(trial, update);
            vi.runAllTimers();
            const times = settleTimes(shown, startAt);
            expect(times).toHaveLength(9);
            times.forEach((time, index): void => {
                const gap = time - (index === 0 ? 0 : times[index - 1]);
                expect(gap).toBeGreaterThanOrEqual(300);
                expect(gap).toBeLessThanOrEqual(500);
            });
        }
    });

    it('shows everything at once with no pacing', () => {
        const { pacer, shown } = harness({ stepMs: 0, jitterMs: 0 });
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        expect(shown[shown.length - 1]).toMatchObject({ type: 'finished', statuses: 'dddddddd' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('flushes everything queued on Cancel, then drops the run’s late updates', () => {
        const { pacer, shown } = harness();
        pacer.start(1);
        pacer.push(1, started());
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(3) });
        expect(pacer.flush(1)).toBe(false);
        expect(shown[shown.length - 1].statuses).toBe('ddda....');
        expect(vi.getTimerCount()).toBe(0);
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(5) });
        pacer.push(1, finished());
        vi.runAllTimers();
        expect(shown[shown.length - 1].statuses).toBe('ddda....');
    });

    it('reports on Cancel when the run had already finished, and shows its result', () => {
        const { pacer, shown } = harness();
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        expect(pacer.flush(1)).toBe(true);
        expect(shown[shown.length - 1]).toMatchObject({ type: 'finished', statuses: 'dddddddd' });
    });

    it('shows a host-side cancellation at once, after what was already queued', () => {
        const { pacer, shown } = harness();
        pacer.start(1);
        pacer.push(1, started());
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(2) });
        pacer.push(1, { type: 'cancelled', runId: 'run-1', rows: progress(2) });
        expect(shown.map((entry): string => entry.type).slice(-2)).toEqual(['rows', 'cancelled']);
        expect(shown[shown.length - 2].statuses).toBe('dda.....');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops the queue and its timer on Re-run, and paces the new run from its own start', () => {
        const { pacer, shown } = harness();
        pacer.start(1);
        for (const update of instantRun('run-1')) pacer.push(1, update);
        vi.advanceTimersByTime(650);
        const before = shown.length;
        pacer.start(2);
        expect(vi.getTimerCount()).toBe(0);
        // A late update from the replaced run, by sequence or by run ID, is never shown.
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(8) });
        const startAt = performance.now();
        pacer.push(2, started('run-2'));
        pacer.push(2, { type: 'rows', runId: 'run-1', rows: progress(8) });
        pacer.push(2, { type: 'rows', runId: 'run-2', rows: progress(1) });
        vi.runAllTimers();
        expect(shown.slice(before).map((entry): string => entry.statuses)).toEqual([
            '........',
            'd.......',
            'da......',
        ]);
        expect(settleTimes(shown.slice(before), startAt)).toEqual([300]);
    });

    it('ignores a second started update and updates before started', () => {
        const { pacer, shown } = harness({ stepMs: 0, jitterMs: 0 });
        pacer.start(1);
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(1) });
        expect(shown).toHaveLength(0);
        pacer.push(1, started());
        pacer.push(1, started('run-other'));
        expect(shown).toHaveLength(1);
    });

    it('clear stops pending work without showing it', () => {
        const { pacer, shown } = harness();
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        const before = shown.length;
        pacer.clear();
        vi.runAllTimers();
        expect(shown).toHaveLength(before);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('usePacedRunEvents', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('drops queued updates and their timers on unmount, and calls the latest show callback', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const captured: { pacer?: RunEventPacer } = {};
        const Probe = ({ show }: { readonly show: (update: RunUpdate) => void }): JSX.Element => {
            const pacer = usePacedRunEvents(show, { pacing: fixed });
            useEffect(() => {
                captured.pacer = pacer;
            }, [pacer]);
            return <></>;
        };
        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => root.render(<Probe show={first} />));
        const mounted = captured.pacer;
        await act(async () => root.render(<Probe show={second} />));
        expect(captured.pacer).toBe(mounted);
        const pacer = captured.pacer;
        if (!pacer) throw new Error('No pacer');
        pacer.start(1);
        for (const update of instantRun()) pacer.push(1, update);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(2);
        await act(async () => root.unmount());
        expect(vi.getTimerCount()).toBe(0);
        vi.runAllTimers();
        expect(second).toHaveBeenCalledTimes(2);
    });

    it('uses the default pacing when none is configured', async () => {
        const captured: { pacer?: RunEventPacer } = {};
        const show = vi.fn();
        const Probe = (): JSX.Element => {
            const pacer = usePacedRunEvents(show, { random: (): number => 0.5 });
            useEffect(() => {
                captured.pacer = pacer;
            }, [pacer]);
            return <></>;
        };
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(<Probe />));
        const pacer = captured.pacer;
        if (!pacer) throw new Error('No pacer');
        pacer.start(1);
        pacer.push(1, started());
        pacer.push(1, { type: 'rows', runId: 'run-1', rows: progress(1) });
        vi.advanceTimersByTime(399);
        expect(show).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(show).toHaveBeenCalledTimes(3);
        await act(async () => root.unmount());
    });
});
