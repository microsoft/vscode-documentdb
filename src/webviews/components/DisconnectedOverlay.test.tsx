/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { beforeEach, expect, it, vi } from 'vitest';
import { type ConnectionUnavailableDetails } from '../_integration/connectionUnavailable';
import { DisconnectedOverlay } from './DisconnectedOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirm = vi.hoisted(() => vi.fn());
vi.mock('../_integration/useTrpcClient', () => ({
    useTrpcClient: () => ({ common: { confirm: { mutate: confirm } } }),
}));

beforeEach((): void => {
    confirm.mockReset();
});

it('dismisses without closing, and only closes a dirty view after confirmation', async (): Promise<void> => {
    const unavailable: ConnectionUnavailableDetails = {
        reason: 'signInRequired',
        title: 'Sign-in required',
        detail: 'Sign in from the connection tree, then click Retry.',
        action: 'retry',
    };
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    confirm.mockResolvedValueOnce({ confirmed: false }).mockResolvedValueOnce({ confirmed: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        const render = async (failure?: ConnectionUnavailableDetails, recovering?: boolean): Promise<void> => {
            await act(async () =>
                root.render(
                    <DisconnectedOverlay
                        unavailable={failure}
                        onAction={onAction}
                        onDismiss={onDismiss}
                        recovering={recovering}
                        warnOnClose
                    >
                        <textarea aria-label="Document" defaultValue="unsaved edit" />
                    </DisconnectedOverlay>,
                ),
            );
        };
        await render();
        const draft = host.querySelector('textarea');
        await render({
            reason: 'identityChanged',
            title: 'Connection changed',
            detail: 'Reopen it from the tree.',
            action: 'close',
        });
        const dialog = (): HTMLElement | null => document.querySelector('.disconnectedOverlay[aria-modal="true"]');
        const buttons = (): HTMLButtonElement[] => [
            ...(dialog()?.querySelectorAll<HTMLButtonElement>('.fui-DialogActions button') ?? []),
        ];
        expect(host.querySelector('[inert] textarea')).toBe(draft);
        expect(draft?.value).toBe('unsaved edit');
        expect(dialog()?.getAttribute('role')).toBe('dialog');
        expect(buttons().map((button) => button.textContent)).toEqual(['Close view']);
        await act(async () =>
            buttons()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
        expect(onAction).not.toHaveBeenCalled();
        expect(dialog()).not.toBeNull();
        await act(async () =>
            dialog()
                ?.querySelector<HTMLButtonElement>(
                    'button[aria-label="Dismiss dialog to access view contents"]',
                )
                ?.click(),
        );
        expect(onDismiss).toHaveBeenCalledOnce();
        expect(confirm).not.toHaveBeenCalled();
        expect(onAction).not.toHaveBeenCalled();
        await render();
        expect(host.querySelector('[inert]')).toBeNull();
        expect(host.querySelector('textarea')).toBe(draft);

        await render({ ...unavailable, action: 'close' });
        await act(async () => buttons()[0]?.click());
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                detail: 'Closing this view discards unsaved changes.',
                confirmLabel: 'Close view',
            }),
        );
        expect(onAction).not.toHaveBeenCalled();
        expect(dialog()).not.toBeNull();
        await act(async () => buttons()[0]?.click());
        expect(onAction).toHaveBeenCalledExactlyOnceWith('close');

        await render(unavailable, true);
        expect(document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
            unavailable.title,
        );
        const description = document.getElementById(dialog()?.getAttribute('aria-describedby') ?? '');
        expect(description?.textContent).toContain(unavailable.detail);
        expect(description?.textContent).toContain('Closing this view discards unsaved changes.');
        expect(buttons().map((button) => button.textContent)).toEqual(['Retry', 'Close view']);
        expect(buttons()[0]?.getAttribute('aria-disabled')).toBe('true');
        await act(async () => buttons()[0]?.click());
        expect(onAction).toHaveBeenCalledTimes(1);
        await render(unavailable);
        await act(async () => buttons()[0]?.click());
        expect(onAction).toHaveBeenLastCalledWith('retry');

        await render();
        expect(dialog()).toBeNull();
        expect(host.querySelector('[inert]')).toBeNull();
        expect(host.querySelector('textarea')).toBe(draft);
        expect(draft?.value).toBe('unsaved edit');
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it('announces retry failure and restores dialog controls', async (): Promise<void> => {
    const unavailable: ConnectionUnavailableDetails = {
        reason: 'userDisconnected',
        title: 'Disconnected',
        detail: 'Connect from the connection tree, then click Retry.',
        action: 'retry',
    };
    const retryFailure = 'Unable to recover the connection. Try Retry again, or close this view.';
    const onAction = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = async (recovering: boolean, failure?: string): Promise<void> => {
        await act(async () =>
            root.render(
                <DisconnectedOverlay
                    unavailable={unavailable}
                    onAction={onAction}
                    onDismiss={() => undefined}
                    recovering={recovering}
                    retryFailure={failure}
                >
                    <textarea aria-label="Document" defaultValue="retained edit" />
                </DisconnectedOverlay>,
            ),
        );
    };
    try {
        await render(true);
        const dialog = (): HTMLElement | null => document.querySelector('.disconnectedOverlay[aria-modal="true"]');
        expect(dialog()?.querySelector('[role="alert"]')).toBeNull();

        await render(false, retryFailure);
        const alert = dialog()?.querySelector('[role="alert"]');
        expect(alert?.textContent).toBe(retryFailure);
        const buttons = [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        expect(
            dialog()
                ?.querySelector('button[aria-label="Dismiss dialog to access view contents"]')
                ?.getAttribute('aria-disabled'),
        ).not.toBe('true');
        expect(buttons.filter((button) => button.textContent).map((button) => button.textContent)).toEqual([
            'Retry',
            'Close view',
        ]);
        expect(buttons.every((button) => button.getAttribute('aria-disabled') !== 'true')).toBe(true);

        await render(true);
        expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
        await render(false, retryFailure);
        expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(retryFailure);
        expect((host.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('retained edit');
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it('retains Retry for a close-only reason and sends an explicit retry action', async (): Promise<void> => {
    const unavailable: ConnectionUnavailableDetails = {
        reason: 'identityChanged',
        title: 'Connection changed',
        detail: 'The saved connection has changed.',
        action: 'close',
    };
    const onAction = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <DisconnectedOverlay
                    unavailable={unavailable}
                    onAction={onAction}
                    onDismiss={() => undefined}
                    retryOffered
                >
                    <div>Retained content</div>
                </DisconnectedOverlay>,
            ),
        );
        const buttons = (): HTMLButtonElement[] => [
            ...(document
                .querySelector('.disconnectedOverlay[aria-modal="true"]')
                ?.querySelectorAll<HTMLButtonElement>('.fui-DialogActions button') ?? []),
        ];
        expect(buttons().map((button) => button.textContent)).toEqual(['Retry', 'Close view']);

        await act(async () => buttons()[0]?.click());

        expect(onAction).toHaveBeenCalledExactlyOnceWith('retry');
        expect(confirm).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
