/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { type RunUpdate } from './connectivityTroubleshooterTypes';
import { isSettled } from './formatEvidence';
import { type PanelRow } from './panelTypes';
import { fixedRows, pendingRows } from './troubleshooterViewState';

/**
 * How long the panel shows each settled step at least, in milliseconds (decision 0043). Each step's
 * minimum is drawn uniformly from `stepMs - jitterMs` to `stepMs + jitterMs`, never below 0.
 */
export interface StepPacing {
    readonly stepMs: number;
    readonly jitterMs: number;
}

/**
 * Checks often finish within a few milliseconds, so every row would settle in the same frame. Showing
 * each step for at least 400 ms lets users follow the sequence and trust that each check ran. The
 * jitter (300 to 500 ms) keeps the sequence from looking mechanical. Only presentation is paced; the
 * report and telemetry keep the real timings. A step that took longer than its minimum gets no delay,
 * and there is no cap on the total: eight instant rows and the result card add about 3.6 s.
 */
export const defaultStepPacing: StepPacing = { stepMs: 400, jitterMs: 100 };

/** Shows every update as soon as it arrives: the view's jsdom tests and the static L2-dev fixtures. */
export const noStepPacing: StepPacing = { stepMs: 0, jitterMs: 0 };

export interface RunEventPacerOptions {
    readonly pacing: StepPacing;
    /** Returns a number in [0, 1), like `Math.random`. */
    readonly random?: () => number;
    /** A monotonic clock in milliseconds. */
    readonly now?: () => number;
}

interface Frame {
    readonly update: RunUpdate;
    /** Set on a frame that settles a row or shows the result card: the minimum since the last one. */
    readonly minimumMs?: number;
}

function sameRow(a: PanelRow, b: PanelRow): boolean {
    return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Turns one run's updates into the updates the view shows, in order. A host update can settle several
 * rows at once (design 5.2); it is split so each frame settles at most one row. A frame that settles a
 * row, and the run's final frame (the result card), is shown no earlier than its sampled minimum after
 * the previous such frame was shown, or after `start` for the first one. Other changes, such as a row
 * starting to check, are shown as soon as their turn comes. A settled row never goes back to checking.
 */
export class RunEventPacer {
    private readonly random: () => number;
    private readonly now: () => number;
    private queue: Frame[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    private sequence: number | undefined;
    private runId: string | undefined;
    /** The rows as of the last queued frame; the next host update is split against them. */
    private queuedRows: readonly PanelRow[] = pendingRows();
    /** The run's terminal update has arrived, or the run was flushed; later updates are dropped. */
    private ended = false;
    private lastShownAt = 0;

    public constructor(
        private readonly show: (update: RunUpdate) => void,
        private readonly options: RunEventPacerOptions,
    ) {
        this.random = options.random ?? Math.random;
        this.now = options.now ?? ((): number => performance.now());
    }

    /** Starts pacing the run `sequence` from now, dropping anything still queued for an earlier one. */
    public start(sequence: number): void {
        this.clear();
        this.sequence = sequence;
        this.runId = undefined;
        this.queuedRows = pendingRows();
        this.ended = false;
        this.lastShownAt = this.now();
    }

    /** Queues an update of the run `sequence`; an update of any other run or run ID is dropped. */
    public push(sequence: number, update: RunUpdate): void {
        if (sequence !== this.sequence || this.ended) {
            return;
        }
        if (update.type === 'started') {
            if (this.runId === undefined) {
                this.runId = update.runId;
                this.queuedRows = fixedRows(update.rows);
                this.enqueue({ update });
            }
            return;
        }
        if (update.runId !== this.runId) {
            return;
        }
        switch (update.type) {
            case 'rows':
                for (const frame of this.split(update.rows)) {
                    this.enqueue(frame);
                }
                return;
            case 'finished':
                for (const frame of this.split(update.rows)) {
                    this.enqueue(frame);
                }
                this.ended = true;
                this.enqueue({ update: { ...update, rows: this.queuedRows }, minimumMs: this.sampleMinimum() });
                return;
            case 'failed':
                this.ended = true;
                this.enqueue({ update, minimumMs: this.sampleMinimum() });
                return;
            case 'cancelled':
                // The host stopped the run: what it had already reported is true, so show it now.
                this.flush(sequence);
                this.show(update);
                return;
        }
    }

    /**
     * Cancel: shows everything queued for the run `sequence` at once, so the view reaches the true
     * state immediately, then drops the run's later updates. Returns whether the run's terminal update
     * had already arrived, in which case the host has nothing left to cancel.
     */
    public flush(sequence: number): boolean {
        if (sequence !== this.sequence) {
            return false;
        }
        const terminal = this.queue.some(
            (frame): boolean => frame.update.type === 'finished' || frame.update.type === 'failed',
        );
        const frames = this.queue;
        this.clear();
        this.ended = true;
        for (const frame of frames) {
            this.show(frame.update);
        }
        return terminal;
    }

    /** Drops everything queued and stops the timer: Re-run, a new run and unmount. */
    public clear(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.queue = [];
    }

    private sampleMinimum(): number {
        const { stepMs, jitterMs } = this.options.pacing;
        return Math.max(0, Math.round(stepMs + (this.random() * 2 - 1) * jitterMs));
    }

    private split(rows: readonly PanelRow[]): Frame[] {
        const runId = this.runId ?? '';
        const next = fixedRows(rows);
        const frames: Frame[] = [];
        let working = [...this.queuedRows];
        next.forEach((row, index): void => {
            const before = working[index];
            if ((isSettled(before.status) && !isSettled(row.status)) || sameRow(before, row)) {
                return;
            }
            working = working.map((candidate, position): PanelRow => (position === index ? row : candidate));
            const update: RunUpdate = { type: 'rows', runId, rows: working };
            const last = frames[frames.length - 1];
            if (!isSettled(before.status) && isSettled(row.status)) {
                frames.push({ update, minimumMs: this.sampleMinimum() });
            } else if (last && last.minimumMs === undefined) {
                // Consecutive changes that settle nothing show together.
                frames[frames.length - 1] = { update };
            } else {
                frames.push({ update });
            }
        });
        this.queuedRows = working;
        return frames;
    }

    private enqueue(frame: Frame): void {
        this.queue.push(frame);
        this.pump();
    }

    private pump(): void {
        if (this.timer !== undefined) {
            return;
        }
        while (this.queue.length > 0) {
            const frame = this.queue[0];
            if (frame.minimumMs !== undefined) {
                const wait = this.lastShownAt + frame.minimumMs - this.now();
                if (wait > 0) {
                    this.timer = setTimeout(
                        (): void => {
                            this.timer = undefined;
                            this.pump();
                        },
                        // Never early: a fractional wait would otherwise round down and fire again.
                        Math.ceil(wait),
                    );
                    return;
                }
                this.lastShownAt = this.now();
            }
            this.queue.shift();
            this.show(frame.update);
        }
    }
}

/**
 * Paces a run's updates for the panel; see {@link RunEventPacer}. `show` receives each paced update.
 * The pacing is read once: the panel's configuration does not change while it is open. Unmounting
 * drops anything still queued.
 */
export function usePacedRunEvents(
    show: (update: RunUpdate) => void,
    options: Omit<RunEventPacerOptions, 'pacing'> & { readonly pacing?: StepPacing },
): RunEventPacer {
    const showRef = useRef(show);
    useEffect(() => {
        showRef.current = show;
    }, [show]);
    const [pacer] = useState(
        () =>
            new RunEventPacer((update): void => showRef.current(update), {
                ...options,
                pacing: options.pacing ?? defaultStepPacing,
            }),
    );
    useEffect(() => () => pacer.clear(), [pacer]);
    return pacer;
}
