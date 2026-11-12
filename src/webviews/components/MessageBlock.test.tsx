/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { ErrorCircleFilled, InfoRegular, WarningRegular } from '@fluentui/react-icons';
import { afterEach, describe, expect, it } from 'vitest';

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
/** The path data of every glyph in the host, which identifies an icon without its class names. */
const glyphs = (host: HTMLElement): string[] =>
    Array.from(host.querySelectorAll('svg path')).map((path) => path.getAttribute('d') ?? '');

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

    it("uses the house glyphs for errors and warnings, and Fluent's for other intents", async () => {
        const errorGlyph = glyphs(await render(<ErrorCircleFilled />));
        const warningGlyph = glyphs(await render(<WarningRegular />));

        expect(glyphs(await render(<MessageBlock intent="error">Failed.</MessageBlock>))).toEqual(errorGlyph);
        expect(glyphs(await render(<MessageBlock intent="warning">Careful.</MessageBlock>))).toEqual(warningGlyph);

        const success = glyphs(await render(<MessageBlock intent="success">Done.</MessageBlock>));
        expect(success).toHaveLength(1);
        expect(success).not.toEqual(errorGlyph);
        expect(success).not.toEqual(warningGlyph);
    });

    it('lets an explicit icon replace the house glyph', async () => {
        const infoGlyph = glyphs(await render(<InfoRegular />));
        const host = await render(
            <MessageBlock intent="error" icon={<InfoRegular />}>
                Failed.
            </MessageBlock>,
        );
        expect(glyphs(host)).toEqual(infoGlyph);
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
