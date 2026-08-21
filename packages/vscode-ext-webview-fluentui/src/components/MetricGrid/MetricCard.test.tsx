/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import { MetricCard, MetricGrid } from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

/** The label is the first child, the value slot the second, for every appearance and size. */
const slots = (root: HTMLElement): { label: Element; value: Element } => ({
    label: root.children[0] as Element,
    value: root.children[1] as Element,
});

describe('MetricCard value states', () => {
    test('undefined renders a skeleton, null renders the placeholder', async () => {
        const { root, rerender } = await renderSurface(<MetricCard label="Documents returned" />);
        expect(slots(root).value.querySelector('[class*="Skeleton"], svg, div')).not.toBeNull();
        expect(slots(root).value.textContent).toBe('');

        await rerender(<MetricCard label="Documents returned" value={null} />);
        expect(slots(root).value.textContent).toBe('N/A');
    });

    test('nullValuePlaceholder overrides the English default', async () => {
        const { root } = await renderSurface(
            <MetricCard label="Documents returned" value={null} nullValuePlaceholder="Nicht verfügbar" />,
        );
        expect(slots(root).value.textContent).toBe('Nicht verfügbar');
    });

    test('0 and the empty string are values, not absences', async () => {
        const { root, rerender } = await renderSurface(<MetricCard label="Unused indexes" value={0} />);
        expect(slots(root).value.textContent).toBe('0');

        await rerender(<MetricCard label="Unused indexes" value={''} />);
        expect(slots(root).value.textContent).toBe('');
        // An empty string is still a resolved value, so nothing stands in for it.
        expect(slots(root).value.children).toHaveLength(0);
    });

    test('loadingPlaceholder="empty" reserves the slot without drawing in it', async () => {
        const { root } = await renderSurface(<MetricCard label="Documents returned" loadingPlaceholder="empty" />);
        expect(slots(root).value.children).toHaveLength(0);
        expect(slots(root).value.textContent).toBe('');
    });

    test('the value slot keeps one class, and therefore one reserved height, across the swap', async () => {
        const { root, rerender } = await renderSurface(<MetricCard label="Execution time" />);
        const loading = slots(root).value.className;

        await rerender(<MetricCard label="Execution time" value="2.33 ms" />);
        expect(slots(root).value.className).toBe(loading);

        await rerender(<MetricCard label="Execution time" value={null} />);
        expect(slots(root).value.className).toBe(loading);
    });

    test('large and small reserve different heights', async () => {
        const { root: large } = await renderSurface(<MetricCard label="Execution time" value="2.33 ms" />);
        const { root: small } = await renderSurface(
            <MetricCard label="Execution time" value="2.33 ms" size="small" />,
        );
        expect(slots(large).value.className).not.toBe(slots(small).value.className);
    });
});

describe('MetricCard accessibility contract', () => {
    test('children are hidden from assistive technology only when ariaLabel is supplied', async () => {
        const { root, rerender } = await renderSurface(
            <MetricCard label="Execution time" value="2.33 ms" ariaLabel="Execution time: 2.33 ms" />,
        );
        expect(root.getAttribute('aria-label')).toBe('Execution time: 2.33 ms');
        expect(slots(root).label.getAttribute('aria-hidden')).toBe('true');
        expect(slots(root).value.getAttribute('aria-hidden')).toBe('true');

        await rerender(<MetricCard label="Execution time" value="2.33 ms" />);
        expect(root.getAttribute('aria-label')).toBeNull();
        expect(slots(root).label.getAttribute('aria-hidden')).toBeNull();
        expect(slots(root).value.getAttribute('aria-hidden')).toBeNull();
    });

    test('is a tab stop in every configuration', async () => {
        const configurations = [
            <MetricCard key="a" label="A" value="1" />,
            <MetricCard key="b" label="B" value="1" description="why" />,
            <MetricCard key="c" label="C" value="1" appearance="subtle" />,
            <MetricCard key="d" label="D" appearance="subtle" size="small" />,
            <MetricCard key="e" label="E" value={null} size="small" />,
        ];

        for (const configuration of configurations) {
            const { root } = await renderSurface(configuration);
            expect(root.getAttribute('tabindex')).toBe('0');
        }
    });
});

describe('MetricCard description', () => {
    test('a description adds the glyph beside the label, and its absence removes it', async () => {
        // Two surfaces rather than a rerender: adding a description wraps the card in a `Tooltip`,
        // which remounts it, so a root captured before the change is detached after it.
        const { root: described } = await renderSurface(
            <MetricCard label="Keys examined" value="12" description="Index keys scanned." />,
        );
        expect(slots(described).label.querySelector('svg')).not.toBeNull();

        const { root: plain } = await renderSurface(<MetricCard label="Keys examined" value="12" />);
        expect(slots(plain).label.querySelector('svg')).toBeNull();
    });

    test('an empty description is treated as no description', async () => {
        const { root } = await renderSurface(<MetricCard label="Keys examined" value="12" description="" />);
        expect(slots(root).label.querySelector('svg')).toBeNull();
    });
});

describe('MetricGrid', () => {
    test('carries one column, and two and four behind media queries', async () => {
        const { root } = await renderSurface(
            <MetricGrid>
                <MetricCard label="A" value="1" />
            </MetricGrid>,
        );

        // Griffel inserts through the CSSOM in production and as text nodes otherwise, and it
        // splits each declaration into its own atomic class, so every class has to be looked up.
        const stylesheets = [...document.querySelectorAll('style')]
            .map((style) =>
                style.textContent !== null && style.textContent !== ''
                    ? style.textContent
                    : [...(style.sheet?.cssRules ?? [])].map((rule) => rule.cssText).join('\n'),
            )
            .join('\n');

        const own = stylesheets
            .split('}')
            .filter((block) => [...root.classList].some((name) => block.includes(`.${name}`)))
            .join('}');

        expect(own).toContain('grid-template-columns: 1fr');
        expect(own).toContain('min-width: 400px');
        expect(own).toContain('repeat(2, 1fr)');
        expect(own).toContain('min-width: 800px');
        expect(own).toContain('repeat(4, 1fr)');
    });
});
