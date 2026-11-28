/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { Button, FluentProvider, webLightTheme } from '@fluentui/react-components';
import { createKeyborg, disposeKeyborg } from 'keyborg';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusWithVisibleIndicator } from './focusWithVisibleIndicator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('focusWithVisibleIndicator', (): void => {
    let host: HTMLElement;
    let root: Root;

    beforeEach((): void => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach((): void => {
        act(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });

    it('skips unavailable candidates and returns the focused eligible element', async (): Promise<void> => {
        await act(async () => {
            root.render(
                <FluentProvider theme={webLightTheme}>
                    <Button disabled>Disabled</Button>
                    <Button aria-disabled="true">Aria disabled</Button>
                    <Button>Eligible</Button>
                </FluentProvider>,
            );
        });
        const buttons = host.querySelectorAll('button');
        const disconnected = document.createElement('button');

        const focused = focusWithVisibleIndicator([null, disconnected, buttons[0], buttons[1], buttons[2]]);

        expect(focused).toBe(buttons[2]);
        expect(document.activeElement).toBe(buttons[2]);
        expect(buttons[2]?.hasAttribute('data-fui-focus-visible')).toBe(true);
    });

    it('keeps the shared keyborg keyboard state and subscription alive', async (): Promise<void> => {
        await act(async () => {
            root.render(
                <FluentProvider theme={webLightTheme}>
                    <Button>Eligible</Button>
                </FluentProvider>,
            );
        });
        const persistent = createKeyborg(window);
        const onChange = vi.fn();
        persistent.subscribe(onChange);
        const button = host.querySelector('button');

        try {
            focusWithVisibleIndicator([button]);

            expect(persistent.isNavigatingWithKeyboard()).toBe(true);
            expect(onChange).toHaveBeenCalledWith(true);
            expect(button?.hasAttribute('data-fui-focus-visible')).toBe(true);
        } finally {
            persistent.unsubscribe(onChange);
            disposeKeyborg(persistent);
        }
    });

    it('returns undefined when no candidate can receive focus', (): void => {
        const disconnected = document.createElement('button');
        disconnected.setAttribute('aria-disabled', 'true');

        expect(focusWithVisibleIndicator([null, disconnected])).toBeUndefined();
    });
});
