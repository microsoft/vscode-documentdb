/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { expect, it, vi } from 'vitest';
import { type ConnectionUnavailableDetails } from '../_integration/connectionUnavailable';
import { DisconnectedOverlay } from './DisconnectedOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps content mounted but inert, and only closes or retries on explicit clicks', async (): Promise<void> => {
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
        const render = async (failure?: ConnectionUnavailableDetails, recovering?: boolean): Promise<void> => {
            await act(async () =>
                root.render(
                    <DisconnectedOverlay unavailable={failure} onAction={onAction} recovering={recovering}>
                        <textarea aria-label="Document" defaultValue="unsaved edit" />
                    </DisconnectedOverlay>,
                ),
            );
        };
        await render();
        const draft = host.querySelector('textarea');
        await render({ ...unavailable, reason: 'credentialsMissing', action: 'close' });
        expect(host.textContent).toContain(unavailable.text);
        expect(host.querySelector('[inert] textarea')).toBe(draft);
        expect(draft?.value).toBe('unsaved edit');
        expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
        expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Close']);
        expect(document.activeElement).toBe(host.querySelector('button'));
        expect(onAction).not.toHaveBeenCalled();
        await act(async () => host.querySelector('button')?.click());
        expect(onAction).toHaveBeenCalledExactlyOnceWith('close');

        await render(unavailable, true);
        expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
            'Retry sign-in',
            'Close',
        ]);
        expect(host.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
        await act(async () => host.querySelector('button')?.click());
        expect(onAction).toHaveBeenCalledTimes(1);
        await render(unavailable);
        await act(async () => host.querySelector('button')?.click());
        expect(onAction).toHaveBeenLastCalledWith('signInAgain');

        await render();
        expect(host.querySelector('[inert]')).toBeNull();
        expect(host.querySelector('textarea')).toBe(draft);
        expect(draft?.value).toBe('unsaved edit');
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
