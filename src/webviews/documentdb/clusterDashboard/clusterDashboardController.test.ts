/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CurrentOpEntry } from '../../../documentdb/utils/getClusterHealth';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

jest.mock('vscode', () => ({
    ViewColumn: { One: 1 },
}));

jest.mock('../../_integration/openAppWebview', () => ({
    openAppWebview: jest.fn(() => createFakeController()),
}));

import { openClusterDashboardWebview } from './clusterDashboardController';
import { getObservedOperations, recordObservedOperations } from './operationHistory';

/**
 * Minimal stand-in for the parts of `AppWebviewController` this factory touches:
 * `isDisposed` (panel reuse) and `onDisposed` (cleanup wiring).
 */
type FakeController = {
    isDisposed: boolean;
    onDisposed: (handler: () => void) => void;
    dispose: () => void;
};

function createFakeController(): FakeController {
    const handlers: Array<() => void> = [];

    return {
        isDisposed: false,
        onDisposed(handler: () => void): void {
            handlers.push(handler);
        },
        dispose(): void {
            this.isDisposed = true;
            handlers.forEach((handler) => handler());
        },
    };
}

const CLUSTER = 'cluster-under-test';
const OTHER_CLUSTER = 'another-cluster';

function operation(overrides: Partial<CurrentOpEntry> = {}): CurrentOpEntry {
    return {
        opid: 'op-1',
        opidIsNumeric: false,
        type: 'query',
        namespace: 'sales.orders',
        secsRunning: 1,
        active: true,
        clientDescription: '127.0.0.1:1234',
        commandPreview: '{"find":"orders"}',
        ...overrides,
    };
}

function open(clusterId: string): FakeController {
    return openClusterDashboardWebview({
        clusterId,
        clusterDisplayName: clusterId,
        viewId: 'connectionsView',
        refreshIntervalMs: 5_000,
    }) as unknown as FakeController;
}

describe('openClusterDashboardWebview panel lifecycle', () => {
    it('reveals the existing panel instead of opening a duplicate', () => {
        const first = open(CLUSTER);
        const second = open(CLUSTER);

        // A duplicate panel would double the polling load against the same cluster.
        expect(second).toBe(first);

        first.dispose();
    });

    it('opens a fresh panel once the previous one was disposed', () => {
        const first = open(CLUSTER);
        first.dispose();

        const second = open(CLUSTER);

        expect(second).not.toBe(first);

        second.dispose();
    });
});

describe('openClusterDashboardWebview history cleanup', () => {
    it('clears the observed-operation history when the panel is disposed', () => {
        const controller = open(CLUSTER);
        recordObservedOperations(CLUSTER, [operation()], 1_000);
        expect(getObservedOperations(CLUSTER)).toHaveLength(1);

        controller.dispose();

        // The history is presented as "what has run since I opened this dashboard", so it must
        // not outlive the panel that scopes it, and must not be retained for the lifetime of
        // the extension host.
        expect(getObservedOperations(CLUSTER)).toHaveLength(0);
    });

    it('does not leak the previous session history into a reopened panel', () => {
        const first = open(CLUSTER);
        recordObservedOperations(CLUSTER, [operation({ opid: 'stale-op' })], 1_000);
        first.dispose();

        const second = open(CLUSTER);

        expect(getObservedOperations(CLUSTER)).toHaveLength(0);

        second.dispose();
    });

    it('leaves other clusters untouched', () => {
        const controller = open(CLUSTER);
        const otherController = open(OTHER_CLUSTER);
        recordObservedOperations(CLUSTER, [operation()], 1_000);
        recordObservedOperations(OTHER_CLUSTER, [operation()], 1_000);

        controller.dispose();

        expect(getObservedOperations(CLUSTER)).toHaveLength(0);
        expect(getObservedOperations(OTHER_CLUSTER)).toHaveLength(1);

        otherController.dispose();
    });

    it('a superseded controller cannot clear the live panel history', () => {
        const first = open(CLUSTER);
        first.dispose();

        const second = open(CLUSTER);
        recordObservedOperations(CLUSTER, [operation()], 2_000);

        // Re-firing the stale handler must be inert: the identity guard sees that the map now
        // holds a different controller, so a late dispose event cannot wipe the live session.
        first.dispose();

        expect(getObservedOperations(CLUSTER)).toHaveLength(1);

        second.dispose();
    });
});
