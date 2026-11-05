/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RunUpdate } from './connectionDiagnosticsTypes';
import { isSettled } from './formatEvidence';
import { panelRowIds, type PanelRow, type PanelRowId } from './panelTypes';
import { type RunResult } from './DiagnosticsResultCard';

export interface TroubleshooterViewState {
    readonly phase: 'running' | 'finished' | 'cancelled' | 'failed';
    /** Increments with every run the view starts; keys per-run components such as announcers. */
    readonly sequence: number;
    /** Undefined until the host's `started` update names the run. */
    readonly runId: string | undefined;
    /** This computer's clock: a remote extension host's clock may differ. */
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly rows: readonly PanelRow[];
    readonly result?: RunResult;
    /** Set only by `finished`: report actions need a completed snapshot. */
    readonly completedRunId?: string;
    /** Rows that settled while the run was live, in the order they settled. */
    readonly announcedRows: readonly PanelRowId[];
}

export function pendingRows(): readonly PanelRow[] {
    return panelRowIds.map((id): PanelRow => ({ id, status: 'pending', segments: [] }));
}

export function startingState(sequence: number, startedAt: number): TroubleshooterViewState {
    return { phase: 'running', sequence, runId: undefined, startedAt, rows: pendingRows(), announcedRows: [] };
}

/** Projects whatever the host sent onto the fixed eight rows: nothing is added or removed. */
export function fixedRows(rows: readonly PanelRow[]): readonly PanelRow[] {
    return panelRowIds.map(
        (id): PanelRow => rows.find((row): boolean => row.id === id) ?? { id, status: 'pending', segments: [] },
    );
}

function withSettled(previous: readonly PanelRowId[], rows: readonly PanelRow[]): readonly PanelRowId[] {
    const added = rows
        .filter((row): boolean => isSettled(row.status) && !previous.includes(row.id))
        .map((row): PanelRowId => row.id);
    return added.length > 0 ? [...previous, ...added] : previous;
}

/** A row still checking has no result to keep once the run stops. */
function stopRows(rows: readonly PanelRow[]): readonly PanelRow[] {
    return rows.map(
        (row): PanelRow => (row.status === 'active' ? { id: row.id, status: 'pending', segments: [] } : row),
    );
}

export function applyRunUpdate(state: TroubleshooterViewState, update: RunUpdate): TroubleshooterViewState {
    // An ended run, including one the user cancelled here, takes no late updates.
    if (state.phase !== 'running') {
        return state;
    }
    if (update.type === 'started') {
        if (state.runId !== undefined) {
            return state;
        }
        return { ...state, runId: update.runId, rows: fixedRows(update.rows) };
    }
    if (state.runId === undefined || update.runId !== state.runId) {
        return state;
    }
    switch (update.type) {
        case 'rows': {
            const rows = fixedRows(update.rows);
            return { ...state, rows, announcedRows: withSettled(state.announcedRows, rows) };
        }
        case 'finished': {
            const rows = fixedRows(update.rows);
            return {
                ...state,
                phase: 'finished',
                rows,
                finishedAt: update.finishedAt,
                result: { kind: 'finished', outcome: update.outcome, card: update.result, coverage: update.coverage },
                completedRunId: update.runId,
                announcedRows: withSettled(state.announcedRows, rows),
            };
        }
        case 'cancelled':
            // Keep the rows already shown (design 3.3); nothing settles after a cancel.
            return cancelRun(state);
        case 'failed':
            return {
                ...state,
                phase: 'failed',
                rows: stopRows(state.rows),
                result: { kind: 'failed', reason: update.reason },
            };
    }
}

export function cancelRun(state: TroubleshooterViewState): TroubleshooterViewState {
    if (state.phase !== 'running') {
        return state;
    }
    return { ...state, phase: 'cancelled', rows: stopRows(state.rows), result: { kind: 'cancelled' } };
}

export function failRun(state: TroubleshooterViewState): TroubleshooterViewState {
    if (state.phase !== 'running') {
        return state;
    }
    return { ...state, phase: 'failed', rows: stopRows(state.rows), result: { kind: 'failed', reason: 'unexpected' } };
}
