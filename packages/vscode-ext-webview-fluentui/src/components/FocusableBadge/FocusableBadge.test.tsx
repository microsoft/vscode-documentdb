/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tooltip } from '@fluentui/react-components';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import { FocusableBadge } from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

describe('FocusableBadge accessibility contract', () => {
    test('is a named tab stop by default without hiding its visible content', async () => {
        const { root } = await renderSurface(<FocusableBadge>Collection scan detected</FocusableBadge>);
        const content = root.firstElementChild as HTMLElement;

        expect(root.getAttribute('tabindex')).toBe('0');
        expect(root.getAttribute('aria-labelledby')).toBe(content.id);
        expect(content.textContent).toBe('Collection scan detected');
        expect(content.getAttribute('aria-hidden')).toBeNull();
        expect(root.getAttribute('aria-label')).toBeNull();
    });

    test('focusable=false keeps a plain mixed-list badge out of the tab order', async () => {
        const { root } = await renderSurface(<FocusableBadge focusable={false}>Unique</FocusableBadge>);

        expect(root.getAttribute('tabindex')).toBeNull();
        expect(root.getAttribute('aria-labelledby')).toBeNull();
        expect(root.textContent).toBe('Unique');
    });

    test('preserves Tooltip trigger integration through the component boundary', async () => {
        const { root } = await renderSurface(
            <Tooltip content="The full value" relationship="description">
                <FocusableBadge>Truncated value...</FocusableBadge>
            </Tooltip>,
        );

        expect(root.getAttribute('aria-describedby')).not.toBeNull();
        expect(root.getAttribute('aria-labelledby')).toBe(root.firstElementChild?.id);
    });
});

describe('FocusableBadge pass-through', () => {
    test('merges className and passes DOM events and attributes to Badge', async () => {
        const onClick = jest.fn();
        const { root } = await renderSurface(
            <FocusableBadge className="consumerBadge" data-consumer="diagnostic" onClick={onClick}>
                Index used
            </FocusableBadge>,
        );

        root.click();
        expect(root.classList).toContain('consumerBadge');
        expect(root.getAttribute('data-consumer')).toBe('diagnostic');
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    test('passes appearance, color, shape and size to Badge', async () => {
        const { root: baseline } = await renderSurface(<FocusableBadge>Default</FocusableBadge>);
        const baselineClassName = baseline.className;
        const variants = [
            <FocusableBadge key="appearance" appearance="outline">
                Outline
            </FocusableBadge>,
            <FocusableBadge key="color" color="success">
                Success
            </FocusableBadge>,
            <FocusableBadge key="shape" shape="rounded">
                Rounded
            </FocusableBadge>,
            <FocusableBadge key="size" size="small">
                Small
            </FocusableBadge>,
        ];

        for (const variant of variants) {
            const { root } = await renderSurface(variant);
            expect(root.className).not.toBe(baselineClassName);
        }
    });
});
