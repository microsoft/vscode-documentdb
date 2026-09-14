/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable } from 'vscode';
import { ext } from '../../../extensionVariables';
import { QuickStartService, type QuickStartOperation } from '../../../services/localQuickStart/QuickStartService';
import { createQuickStartProgressBridge } from './quickStartProgressBridge';
import { buildQuickStartInstanceTreeId } from './quickStartTreeIdentity';

jest.mock('../../../extensionVariables', () => ({
    ext: {
        state: {
            // The real implementation holds the indicator until the wrapped work settles.
            runWithTemporaryDescription: jest.fn((_id: string, _description: string, callback: () => Promise<void>) =>
                callback(),
            ),
        },
    },
}));

const runWithTemporaryDescription = ext.state.runWithTemporaryDescription as jest.MockedFunction<
    typeof ext.state.runWithTemporaryDescription
>;

/** Lets the bridge's deferred `sync` run. */
const flush = (): Promise<void> => Promise.resolve();

function pendingOperation(kind: QuickStartOperation['kind']): QuickStartOperation {
    return { kind, promise: new Promise<void>(() => undefined) };
}

/**
 * Quick Start work is service-owned (it can start from the webview, a command, or a background
 * probe), so the row cannot own its own spinner. The bridge is what turns that work into the
 * framework's node-progress state.
 */
describe('quickStartProgressBridge', () => {
    let notify: () => void;
    let subscription: Disposable;

    beforeEach(() => {
        runWithTemporaryDescription.mockClear();
        jest.spyOn(QuickStartService, 'onDidChangeOperation').mockImplementation(((listener: () => void) => {
            notify = listener;
            return { dispose: () => undefined };
        }) as typeof QuickStartService.onDidChangeOperation);
        subscription = createQuickStartProgressBridge();
    });

    afterEach(() => {
        subscription.dispose();
        jest.restoreAllMocks();
    });

    it('applies node progress to the instance row for the whole operation', async () => {
        const operation = pendingOperation('starting');
        jest.spyOn(QuickStartService, 'getInFlightOperation').mockReturnValue(operation);

        notify();
        await flush();

        expect(runWithTemporaryDescription).toHaveBeenCalledTimes(1);
        const [id, description, callback] = runWithTemporaryDescription.mock.calls[0];
        expect(id).toBe(buildQuickStartInstanceTreeId());
        expect(description).toBe('Starting…');
        // The framework holds the spinner until the service's own work settles.
        expect(callback()).toBe(operation.promise);
    });

    it('does not stack indicators while the same operation is still running', async () => {
        jest.spyOn(QuickStartService, 'getInFlightOperation').mockReturnValue(pendingOperation('deleting'));

        notify();
        await flush();
        notify();
        await flush();

        expect(runWithTemporaryDescription).toHaveBeenCalledTimes(1);
        expect(runWithTemporaryDescription.mock.calls[0][1]).toBe('Deleting…');
    });

    it('picks up the next operation once the previous one has settled', async () => {
        const inFlight = jest.spyOn(QuickStartService, 'getInFlightOperation');

        inFlight.mockReturnValue(pendingOperation('stopping'));
        notify();
        await flush();

        inFlight.mockReturnValue(undefined);
        notify();
        await flush();

        inFlight.mockReturnValue(pendingOperation('refreshing'));
        notify();
        await flush();

        expect(runWithTemporaryDescription).toHaveBeenCalledTimes(2);
        expect(runWithTemporaryDescription.mock.calls[1][1]).toBe('Refreshing…');
    });

    it('stays quiet when nothing is running', async () => {
        jest.spyOn(QuickStartService, 'getInFlightOperation').mockReturnValue(undefined);

        notify();
        await flush();

        expect(runWithTemporaryDescription).not.toHaveBeenCalled();
    });
});
