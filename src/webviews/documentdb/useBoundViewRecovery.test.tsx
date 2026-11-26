/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, useEffect, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
    isConnectionUnavailableMessage,
    type ConnectionRecoveryRequest,
    type ConnectionRecoveryResponse,
    type ConnectionUnavailableDetails,
    type ConnectionUnavailableResponse,
} from '../_integration/connectionUnavailable';
import { useBoundViewRecovery } from './useBoundViewRecovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RecoveryResponse = ConnectionUnavailableResponse | ConnectionRecoveryResponse;

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

interface TestOptions {
    resetRecoveringOnUnavailable?: boolean;
    advanceRevisionAfterRecovery?: boolean;
}

const recoverUnavailable = vi.fn<(input: ConnectionRecoveryRequest) => Promise<RecoveryResponse>>();
const explainOperationFailure = vi.fn<(input: { message: string }) => Promise<string | null>>();
const displayErrorMessage = vi.fn<(input: { message: string; modal: false; cause: string }) => Promise<unknown>>();
const onShowUnavailable = vi.fn<() => void>();
const unavailable: ConnectionUnavailableDetails = {
    reason: 'userDisconnected',
    title: 'Disconnected',
    detail: 'Connect from the connection tree, then click Retry.',
    action: 'retry',
};
const newerUnavailable: ConnectionUnavailableDetails = {
    reason: 'connectionRemoved',
    title: 'Connection removed',
    detail: 'Reopen it from the tree.',
    action: 'close',
};
const recovered: ConnectionRecoveryResponse = { recovered: { text: 'Connection recovered.' } };

let state: ReturnType<typeof useBoundViewRecovery>;
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;

function TestView(options: TestOptions): JSX.Element | null {
    state = useBoundViewRecovery({
        recovery: { mutate: recoverUnavailable },
        common: {
            explainOperationFailure: { query: explainOperationFailure },
            displayErrorMessage: { mutate: displayErrorMessage },
        },
        onShowUnavailable,
        ...options,
    });
    const { showUnavailable, disposedRef } = state;
    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>): void => {
            if (isConnectionUnavailableMessage(event.data)) {
                showUnavailable(event.data.unavailable);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            disposedRef.current = true;
        };
    }, [showUnavailable]);
    return null;
}

async function render(options: TestOptions = {}): Promise<void> {
    await act(async () => root.render(<TestView {...options} />));
}

async function show(failure: ConnectionUnavailableDetails = unavailable): Promise<void> {
    await act(async () =>
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'documentView.connectionUnavailable', unavailable: failure },
            }),
        ),
    );
}

beforeEach((): void => {
    vi.resetAllMocks();
    explainOperationFailure.mockResolvedValue(null);
    displayErrorMessage.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mounted = true;
});

afterEach(async (): Promise<void> => {
    if (mounted) {
        await act(async () => root.unmount());
    }
    host.remove();
});

it('dismisses only the render state and keeps the listener and operation block across renders', async (): Promise<void> => {
    await render();
    const showUnavailable = state.showUnavailable;
    await show();
    const revision = state.revisionRef.current;
    await act(async () => state.setUnavailable(undefined));
    await render();

    expect(state.unavailable).toBeUndefined();
    expect(state.unavailableRef.current).toBe(unavailable);
    expect(state.isOperationCurrent(revision)).toBe(false);
    expect(state.showUnavailable).toBe(showUnavailable);
    expect(state.disposedRef.current).toBe(false);

    await act(async () => state.setUnavailable(state.unavailableRef.current));
    expect(state.unavailable).toBe(unavailable);
    await show(newerUnavailable);
    expect(state.unavailable).toBe(newerUnavailable);
    expect(onShowUnavailable).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
    'ignores stale retry success after another unavailable message (dashboard policy: %s)',
    async (resetRecoveringOnUnavailable): Promise<void> => {
        const retry = deferred<RecoveryResponse>();
        recoverUnavailable.mockReturnValueOnce(retry.promise);
        await render({ resetRecoveringOnUnavailable });
        await show();
        await act(async () => state.handleUnavailableAction('retry'));
        expect(state.recovering).toBe(true);

        await show(newerUnavailable);
        expect(state.recovering).toBe(!resetRecoveringOnUnavailable);
        await act(async () => retry.resolve(recovered));

        expect(state.unavailable).toBe(newerUnavailable);
        expect(state.unavailableRef.current).toBe(newerUnavailable);
        expect(state.recoveryAnnouncement).toBeUndefined();
        expect(state.recovering).toBe(false);
        expect(explainOperationFailure).not.toHaveBeenCalled();
    },
);

it.each([false, true])(
    'clears and announces an accepted retry without replay (extra collection revision: %s)',
    async (advanceRevisionAfterRecovery): Promise<void> => {
        recoverUnavailable.mockResolvedValueOnce(recovered);
        await render({ advanceRevisionAfterRecovery });
        await show();
        const revision = state.revisionRef.current;
        await act(async () => state.handleUnavailableAction('retry'));

        expect(recoverUnavailable).toHaveBeenCalledExactlyOnceWith({ action: 'retry' });
        expect(state.unavailable).toBeUndefined();
        expect(state.unavailableRef.current).toBeUndefined();
        expect(state.recoveryAnnouncement).toBe(recovered.recovered.text);
        expect(state.recovering).toBe(false);
        expect(state.revisionRef.current).toBe(revision + 1 + Number(advanceRevisionAfterRecovery));
        expect(state.isOperationCurrent(revision)).toBe(false);
        expect(state.isOperationCurrent(state.revisionRef.current)).toBe(true);
        expect(onShowUnavailable).toHaveBeenCalledOnce();

        await show();
        expect(state.recoveryAnnouncement).toBeUndefined();
    },
);

it('keeps the updated unavailability from a failed retry without rerunning the host reset', async (): Promise<void> => {
    recoverUnavailable.mockResolvedValueOnce({ unavailable: newerUnavailable });
    await render();
    await show();
    await act(async () => state.handleUnavailableAction('retry'));

    expect(state.unavailable).toBe(newerUnavailable);
    expect(state.unavailableRef.current).toBe(newerUnavailable);
    expect(state.recoveryAnnouncement).toBeUndefined();
    expect(state.recovering).toBe(false);
    expect(onShowUnavailable).toHaveBeenCalledOnce();
});

it('does not clear or announce a close reply', async (): Promise<void> => {
    recoverUnavailable.mockResolvedValueOnce(recovered);
    await render();
    await show();
    await act(async () => state.handleUnavailableAction('close'));

    expect(recoverUnavailable).toHaveBeenCalledExactlyOnceWith({ action: 'close' });
    expect(state.unavailableRef.current).toBe(unavailable);
    expect(state.unavailable).toBe(unavailable);
    expect(state.recoveryAnnouncement).toBeUndefined();
    expect(state.recovering).toBe(false);
});

it('ignores retry settlement after host disposal', async (): Promise<void> => {
    const retry = deferred<RecoveryResponse>();
    recoverUnavailable.mockReturnValueOnce(retry.promise);
    await render();
    await show();
    await act(async () => state.handleUnavailableAction('retry'));
    const unavailableRef = state.unavailableRef;
    const disposedRef = state.disposedRef;
    await act(async () => root.unmount());
    mounted = false;
    await act(async () => retry.resolve(recovered));

    expect(disposedRef.current).toBe(true);
    expect(unavailableRef.current).toBe(unavailable);
    expect(explainOperationFailure).not.toHaveBeenCalled();
    expect(displayErrorMessage).not.toHaveBeenCalled();
});

it('does not let an older dashboard retry finally clear a newer retry', async (): Promise<void> => {
    const firstRetry = deferred<RecoveryResponse>();
    const secondRetry = deferred<RecoveryResponse>();
    recoverUnavailable.mockReturnValueOnce(firstRetry.promise).mockReturnValueOnce(secondRetry.promise);
    await render({ resetRecoveringOnUnavailable: true });
    await show();
    await act(async () => state.handleUnavailableAction('retry'));
    await show();
    await act(async () => state.handleUnavailableAction('retry'));
    await act(async () => firstRetry.resolve(recovered));

    expect(state.recovering).toBe(true);
    expect(state.unavailable).toBe(unavailable);
    expect(state.recoveryAnnouncement).toBeUndefined();
    await act(async () => secondRetry.resolve(recovered));
    expect(state.recovering).toBe(false);
    expect(state.recoveryAnnouncement).toBe(recovered.recovered.text);
});

it.each([null, 'Explained failure'])(
    'preserves retry failure notification and cause (explanation: %s)',
    async (explanation): Promise<void> => {
        recoverUnavailable.mockRejectedValueOnce(new Error('driver failure'));
        explainOperationFailure.mockResolvedValueOnce(explanation);
        await render();
        await show();
        await act(async () => state.handleUnavailableAction('retry'));

        expect(explainOperationFailure).toHaveBeenCalledExactlyOnceWith({ message: 'driver failure' });
        expect(displayErrorMessage).toHaveBeenCalledExactlyOnceWith({
            message: explanation ?? 'Unable to recover the connection',
            modal: false,
            cause: 'driver failure',
        });
        expect(state.unavailableRef.current).toBe(unavailable);
        expect(state.recovering).toBe(false);
    },
);

it('drops a retry failure invalidated while its explanation is in flight', async (): Promise<void> => {
    const explanation = deferred<string | null>();
    recoverUnavailable.mockRejectedValueOnce(new Error('driver failure'));
    explainOperationFailure.mockReturnValueOnce(explanation.promise);
    await render();
    await show();
    await act(async () => state.handleUnavailableAction('retry'));
    await show(newerUnavailable);
    await act(async () => explanation.resolve('Explained failure'));

    expect(displayErrorMessage).not.toHaveBeenCalled();
    expect(state.unavailable).toBe(newerUnavailable);
    expect(state.recoveryAnnouncement).toBeUndefined();
    expect(state.recovering).toBe(false);
});

it('keeps same-render retry submissions state-gated rather than ref-locked', async (): Promise<void> => {
    const firstRetry = deferred<RecoveryResponse>();
    const secondRetry = deferred<RecoveryResponse>();
    recoverUnavailable.mockReturnValueOnce(firstRetry.promise).mockReturnValueOnce(secondRetry.promise);
    await render();
    await show();
    await act(async () => {
        state.handleUnavailableAction('retry');
        state.handleUnavailableAction('retry');
    });

    expect(recoverUnavailable).toHaveBeenCalledTimes(2);
    await act(async () => firstRetry.resolve(recovered));
    expect(state.unavailable).toBe(unavailable);
    expect(state.recoveryAnnouncement).toBeUndefined();
    await act(async () => secondRetry.resolve(recovered));
    expect(state.unavailable).toBeUndefined();
    expect(state.recoveryAnnouncement).toBe(recovered.recovered.text);
});
