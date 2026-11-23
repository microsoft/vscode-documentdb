/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { expect, it, vi } from 'vitest';
import { type ConnectionUnavailableDetails } from '../_integration/connectionUnavailable';
import { DisconnectedBanner } from './DisconnectedBanner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('offers one explicit recovery action and cannot resubmit while recovery is running', async (): Promise<void> => {
    const unavailable: ConnectionUnavailableDetails = {
        reason: 'signInRequired',
        text: 'Your Microsoft session is unavailable.',
        action: 'signInAgain',
    };
    const onAction = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<DisconnectedBanner unavailable={unavailable} onAction={onAction} />));
        expect(host.textContent).toContain(unavailable.text);
        expect(host.querySelectorAll('button')).toHaveLength(1);
        expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
        expect(host.querySelector('button')?.textContent).toBe('Retry sign-in');
        await act(async () => host.querySelector('button')?.click());
        expect(onAction).toHaveBeenCalledExactlyOnceWith('signInAgain');

        await act(async () =>
            root.render(<DisconnectedBanner unavailable={unavailable} onAction={onAction} recovering />),
        );
        expect(host.querySelector('button')?.disabled).toBe(true);
        await act(async () => host.querySelector('button')?.click());
        expect(onAction).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
