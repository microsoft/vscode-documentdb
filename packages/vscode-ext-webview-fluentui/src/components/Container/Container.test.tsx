/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { act, type ReactNode } from 'react';
import { cleanupSurfaces, installTestEnvironment, renderSurface, setScrollMetrics } from '../testing/renderSurface.js';
import {
    Container,
    ContainerBody,
    ContainerFooter,
    ContainerHeader,
    ContainerMain,
    ContainerSection,
} from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

describe('Container family', () => {
    test('ContainerFooter elevates only while ContainerBody overflows', async () => {
        const { root } = await renderSurface(
            <Container>
                <ContainerBody>
                    <ContainerMain>content</ContainerMain>
                </ContainerBody>
                <ContainerFooter>footer</ContainerFooter>
            </Container>,
        );

        const scrollArea = root.firstElementChild as HTMLElement;
        const footer = root.children[1] as HTMLElement;
        const flatClassName = footer.className;

        setScrollMetrics(scrollArea, { scrollTop: 0, clientHeight: 200, scrollHeight: 900 });
        await act(async () => {
            scrollArea.dispatchEvent(new Event('scroll'));
        });
        expect(footer.className).not.toBe(flatClassName);

        // Scrolled to the bottom: nothing below the fold, so the elevation goes away again.
        setScrollMetrics(scrollArea, { scrollTop: 700, clientHeight: 200, scrollHeight: 900 });
        await act(async () => {
            scrollArea.dispatchEvent(new Event('scroll'));
        });
        expect(footer.className).toBe(flatClassName);
    });

    const surfaceWithSection = (step: string, focusOnMount: boolean): ReactNode => (
        <Container>
            <ContainerBody>
                <ContainerMain>
                    <ContainerSection key={step} title={step} focusOnMount={focusOnMount}>
                        body
                    </ContainerSection>
                </ContainerMain>
            </ContainerBody>
        </Container>
    );

    test('ContainerSection focusOnMount does not steal focus on the Container first render', async () => {
        const { root } = await renderSurface(surfaceWithSection('First step', true));

        expect(root.querySelector('h2')?.textContent).toBe('First step');
        expect(document.activeElement).toBe(document.body);
    });

    test('ContainerSection focusOnMount moves focus to the heading of a later step', async () => {
        const { root, rerender } = await renderSurface(surfaceWithSection('First step', true));
        await rerender(surfaceWithSection('Second step', true));

        const heading = root.querySelector('h2');
        expect(heading?.textContent).toBe('Second step');
        expect(document.activeElement).toBe(heading);
    });

    test('a section without focusOnMount leaves focus alone', async () => {
        const { root, rerender } = await renderSurface(surfaceWithSection('First step', false));
        await rerender(surfaceWithSection('Second step', false));

        expect(root.querySelector('h2')?.textContent).toBe('Second step');
        expect(document.activeElement).toBe(document.body);
    });

    test('ContainerSection labels itself by its heading', async () => {
        const { root } = await renderSurface(
            <Container>
                <ContainerBody>
                    <ContainerMain>
                        <ContainerSection title="Configure" subtitle="Change these only if you need to">
                            body
                        </ContainerSection>
                    </ContainerMain>
                </ContainerBody>
            </Container>,
        );

        const section = root.querySelector('section');
        const heading = root.querySelector('h2');
        expect(heading?.id).toBeTruthy();
        expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
    });

    test('ContainerHeader renders media, title and subtitle, and drops an omitted media box', async () => {
        const withMedia = await renderSurface(
            <Container>
                <ContainerBody>
                    <ContainerHeader media={<svg data-testid="brand" />} title="DocumentDB Local" subtitle="Set up" />
                </ContainerBody>
            </Container>,
        );
        expect(withMedia.root.querySelector('[data-testid="brand"]')).not.toBeNull();
        expect(withMedia.root.querySelector('h1')?.textContent).toBe('DocumentDB Local');

        const withoutMedia = await renderSurface(
            <Container>
                <ContainerBody>
                    <ContainerHeader title="DocumentDB Local" />
                </ContainerBody>
            </Container>,
        );
        const header = withoutMedia.root.querySelector('h1')?.parentElement?.parentElement;
        expect(header?.children).toHaveLength(1);
    });
});
