/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { openAppWebview } from '../../_integration/openAppWebview';
import { openLocalQuickStartWebview } from './localQuickStartController';

// Local Quick Start drives a SINGLETON host service, so the webview is a create-or-reveal singleton:
// a second launch must reuse the existing panel/controller (issue #738 tab-reuse), and the handle
// must be released when the panel closes so a later launch re-creates it. These tests lock that
// contract by faking openAppWebview (no real panel/tRPC harness exists).
jest.mock('../../_integration/openAppWebview', () => ({
    openAppWebview: jest.fn(),
}));

type FakeController = {
    isDisposed: boolean;
    onDisposed: jest.Mock;
    panel: { dispose: jest.Mock };
    fireDisposed: () => void;
};

function makeFakeController(): FakeController {
    const disposeCallbacks: Array<() => void> = [];
    const fake: FakeController = {
        isDisposed: false,
        onDisposed: jest.fn((cb: () => void) => disposeCallbacks.push(cb)),
        panel: { dispose: jest.fn() },
        fireDisposed: () => {
            fake.isDisposed = true;
            disposeCallbacks.forEach((cb) => cb());
        },
    };
    return fake;
}

describe('openLocalQuickStartWebview — create-or-reveal singleton (issue #738)', () => {
    const openAppWebviewMock = openAppWebview as unknown as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        ext.context = { extensionUri: vscode.Uri.file('/ext') } as unknown as vscode.ExtensionContext;
    });

    // Reset the module-level singleton between tests by disposing whatever panel is still "open".
    afterEach(() => {
        const results = openAppWebviewMock.mock.results;
        const last = results.length ? (results[results.length - 1].value as FakeController | undefined) : undefined;
        if (last && !last.isDisposed) {
            last.fireDisposed();
        }
    });

    it('reuses the existing controller on a second launch (no duplicate panel)', () => {
        const fake = makeFakeController();
        openAppWebviewMock.mockReturnValue(fake);

        const first = openLocalQuickStartWebview({ id: 'localQuickStart' });
        const second = openLocalQuickStartWebview({ id: 'localQuickStart' });

        expect(second).toBe(first);
        expect(openAppWebviewMock).toHaveBeenCalledTimes(1);
    });

    it('creates a fresh controller after the previous panel is disposed', () => {
        const fake1 = makeFakeController();
        const fake2 = makeFakeController();
        openAppWebviewMock.mockReturnValueOnce(fake1).mockReturnValueOnce(fake2);

        const first = openLocalQuickStartWebview({ id: 'localQuickStart' });
        fake1.fireDisposed(); // user closes the tab / success auto-close
        const second = openLocalQuickStartWebview({ id: 'localQuickStart' });

        expect(second).toBe(fake2);
        expect(second).not.toBe(first);
        expect(openAppWebviewMock).toHaveBeenCalledTimes(2);
    });

    it('does not evict the live singleton when a superseded controller is disposed', () => {
        const fake1 = makeFakeController();
        const fake2 = makeFakeController();
        openAppWebviewMock.mockReturnValueOnce(fake1).mockReturnValueOnce(fake2);

        openLocalQuickStartWebview({ id: 'localQuickStart' }); // → fake1 is current
        fake1.fireDisposed(); // fake1 disposed ⇒ singleton cleared
        const second = openLocalQuickStartWebview({ id: 'localQuickStart' }); // → fake2 is current
        fake1.fireDisposed(); // a late/duplicate disposal of the OLD controller must be a no-op

        const third = openLocalQuickStartWebview({ id: 'localQuickStart' });
        expect(third).toBe(second); // fake2 is still the live singleton, not evicted by fake1
    });
});
