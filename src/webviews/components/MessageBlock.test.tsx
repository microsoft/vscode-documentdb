/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { MessageBlock } from './MessageBlock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { host: HTMLElement; root: Root }[] = [];

const render = async (node: ReactNode): Promise<HTMLElement> => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
        root.render(node);
    });
    return host;
};

afterEach(async () => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async () => {
            root.unmount();
        });
        host.remove();
    }
});

/**
 * Found by content rather than by a `fui-*` class name: Fluent's class names are implementation
 * details, and the package's stylesheet is the only place in this repository allowed to key off
 * them.
 */
const bodyOf = (host: HTMLElement, text: string): Element | undefined => {
    const bar = host.querySelector('[role="group"]');
    return Array.from(bar?.children ?? []).find((child) => child.textContent?.includes(text));
};

describe('MessageBlock', () => {
    it('gives the title its own line above the message', async () => {
        const host = await render(
            <MessageBlock intent="error" title="Setup did not finish">
                Docker stopped responding.
            </MessageBlock>,
        );

        const body = bodyOf(host, 'Docker stopped responding.');
        // One element child, the title; the message itself is a text node beside it.
        expect(body?.children).toHaveLength(1);
        expect(body?.firstElementChild?.textContent).toBe('Setup did not finish');
        expect(body?.textContent).toBe('Setup did not finishDocker stopped responding.');
    });

    it('renders without a title, stacking whatever it is given', async () => {
        const host = await render(
            <MessageBlock>
                <div>First line</div>
                <div>Second line</div>
            </MessageBlock>,
        );

        const body = bodyOf(host, 'First line');
        expect(body?.children).toHaveLength(2);
    });

    it('renders actions only when it is given some', async () => {
        const withActions = await render(
            <MessageBlock actions={<button type="button">Retry</button>}>Something went wrong.</MessageBlock>,
        );
        expect(withActions.querySelector('button')?.textContent).toBe('Retry');

        const withoutActions = await render(<MessageBlock>Something went wrong.</MessageBlock>);
        expect(withoutActions.querySelector('button')).toBeNull();
    });
});
