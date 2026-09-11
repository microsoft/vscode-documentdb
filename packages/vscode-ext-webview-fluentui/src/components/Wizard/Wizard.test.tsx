/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { act, type ReactElement } from 'react';
import { ContainerFooter, ContainerHeader } from '../Container/index.js';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import { Wizard, WizardStep, type WizardHeaderBehavior } from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

const stylesFor = (element: Element): string =>
    [...document.querySelectorAll('style')]
        .map((style) =>
            style.textContent !== null && style.textContent !== ''
                ? style.textContent
                : [...(style.sheet?.cssRules ?? [])].map((rule) => rule.cssText).join('\n'),
        )
        .join('\n')
        .split('}')
        .filter((block) => [...element.classList].some((name) => block.includes(`.${name}`)))
        .join('}');

const wizard = (activeStep: string, onStepChange: (value: string) => void = () => undefined): ReactElement => (
    <Wizard
        activeStep={activeStep}
        onStepChange={onStepChange}
        stepsAriaLabel="Setup steps"
        header={<ContainerHeader title="DocumentDB Local" subtitle="Local development setup" />}
        footer={<ContainerFooter>footer actions</ContainerFooter>}
    >
        <WizardStep value="introduction" label="Introduction">
            <p>introduction body</p>
        </WizardStep>
        <WizardStep value="configure" label="Configure" subtitle="Change these only if you need to">
            <p>configure body</p>
        </WizardStep>
        <WizardStep value="setup" label="Set up">
            <p>setup body</p>
        </WizardStep>
    </Wizard>
);

describe('Wizard', () => {
    test('renders only the active step', async () => {
        const { root, rerender } = await renderSurface(wizard('configure'));

        expect(root.textContent).toContain('configure body');
        expect(root.textContent).not.toContain('introduction body');
        expect(root.textContent).not.toContain('setup body');

        await rerender(wizard('setup'));
        expect(root.textContent).toContain('setup body');
        expect(root.textContent).not.toContain('configure body');
    });

    test('the section heading defaults to the step label, and every step still appears in the indicator', async () => {
        const { root } = await renderSurface(wizard('configure'));

        expect(root.querySelector('h2')?.textContent).toBe('Configure');
        const stepLabels = Array.from(root.querySelectorAll('button')).map((button) => button.textContent);
        expect(stepLabels).toEqual(['Introduction', 'Configure', 'Set up']);
    });

    test('a step change moves focus to the new step heading', async () => {
        const { root, rerender } = await renderSurface(wizard('introduction'));
        expect(document.activeElement).toBe(document.body);

        await rerender(wizard('setup'));
        const heading = root.querySelector('h2');
        expect(heading?.textContent).toBe('Set up');
        expect(document.activeElement).toBe(heading);
    });

    test('reports a step change instead of navigating itself', async () => {
        const onStepChange = jest.fn<(value: string) => void>();
        const { root } = await renderSurface(wizard('setup', onStepChange));

        const buttons = Array.from(root.querySelectorAll('button'));
        await act(async () => {
            buttons.find((button) => button.textContent === 'Configure')?.click();
        });
        expect(onStepChange).toHaveBeenCalledWith('configure');

        // Still on 'setup': navigation is the consumer's to perform.
        expect(root.textContent).toContain('setup body');
    });

    test('stepsLocked suppresses back-navigation', async () => {
        const onStepChange = jest.fn<(value: string) => void>();
        const { root } = await renderSurface(
            <Wizard activeStep="setup" onStepChange={onStepChange} stepsAriaLabel="Setup steps" stepsLocked>
                <WizardStep value="introduction" label="Introduction" />
                <WizardStep value="setup" label="Set up" />
            </Wizard>,
        );

        const introduction = Array.from(root.querySelectorAll('button')).find(
            (button) => button.textContent === 'Introduction',
        );
        await act(async () => {
            introduction?.click();
        });
        expect(onStepChange).not.toHaveBeenCalled();
    });

    test('renders the header and footer it is given', async () => {
        const { root } = await renderSurface(wizard('introduction'));

        expect(root.querySelector('h1')?.textContent).toBe('DocumentDB Local');
        expect(root.textContent).toContain('footer actions');
    });

    test.each<WizardHeaderBehavior>(['scroll', 'sticky-navigation'])(
        'applies the %s header behavior to the scroll region',
        async (headerBehavior) => {
            const { root } = await renderSurface(
                <Wizard
                    activeStep="only"
                    onStepChange={() => undefined}
                    stepsAriaLabel="Setup steps"
                    headerBehavior={headerBehavior}
                    header={<ContainerHeader title="DocumentDB Local" />}
                >
                    <WizardStep value="only" label="Only" />
                </Wizard>,
            );

            expect(root.querySelector('[data-header-behavior]')?.getAttribute('data-header-behavior')).toBe(
                headerBehavior,
            );
        },
    );

    test('sticky-navigation leaves the subtitle in place', async () => {
        const { root } = await renderSurface(
            <Wizard
                activeStep="only"
                onStepChange={() => undefined}
                stepsAriaLabel="Setup steps"
                headerBehavior="sticky-navigation"
                header={<ContainerHeader title="DocumentDB Local" subtitle="Local development setup" />}
            >
                <WizardStep value="only" label="Only" />
            </Wizard>,
        );

        const subtitleCopies = Array.from(root.querySelectorAll('span')).filter(
            (element) => element.textContent === 'Local development setup',
        );
        expect(subtitleCopies).toHaveLength(1);
        expect(subtitleCopies[0].closest('[aria-hidden="true"]')).toBeNull();
    });

    test('scrolling headers render one subtitle copy', async () => {
        const { root } = await renderSurface(wizard('introduction'));
        const subtitleCopies = Array.from(root.querySelectorAll('span')).filter(
            (element) => element.textContent === 'Local development setup',
        );

        expect(subtitleCopies).toHaveLength(1);
    });

    test('sticky-navigation leaves header presentation unchanged', async () => {
        const surface = (headerBehavior: WizardHeaderBehavior): ReactElement => (
            <Wizard
                activeStep="only"
                onStepChange={() => undefined}
                stepsAriaLabel="Setup steps"
                headerBehavior={headerBehavior}
                header={
                    <ContainerHeader
                        media={<svg data-testid="header-media" />}
                        title="DocumentDB Local"
                        subtitle="Local development setup"
                    />
                }
            >
                <WizardStep value="only" label="Only" />
            </Wizard>
        );
        const { root, rerender } = await renderSurface(surface('scroll'));
        const scrollingClasses = {
            header: root.querySelector('h1')?.parentElement?.parentElement?.className,
            media: root.querySelector('[data-testid="header-media"]')?.parentElement?.className,
            title: root.querySelector('h1')?.className,
        };

        await rerender(surface('sticky-navigation'));

        expect({
            header: root.querySelector('h1')?.parentElement?.parentElement?.className,
            media: root.querySelector('[data-testid="header-media"]')?.parentElement?.className,
            title: root.querySelector('h1')?.className,
        }).toEqual(scrollingClasses);
    });

    test('the header fades on scroll but cancels its fade for focus and reduced motion', async () => {
        const { root } = await renderSurface(
            <Wizard
                activeStep="only"
                onStepChange={() => undefined}
                stepsAriaLabel="Setup steps"
                headerBehavior="sticky-navigation"
                header={<ContainerHeader title="DocumentDB Local" action={<button>Help</button>} />}
                footer={
                    <ContainerFooter>
                        <button>Continue</button>
                    </ContainerFooter>
                }
            >
                <WizardStep value="only" label="Only" />
            </Wizard>,
        );
        const scrollRegion = root.querySelector('[data-header-behavior]')!;
        const fadingHeader = scrollRegion.firstElementChild!.firstElementChild!;
        const headerStyles = stylesFor(fadingHeader);

        expect(headerStyles).toContain('animation-timeline: --wizard-scroll');
        expect(headerStyles).toContain('animation-range: 0px 150px');
        expect(headerStyles).toMatch(/:focus-within\s*\{\s*animation-name: none/);
        expect(headerStyles).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-name: none/);

        const help = fadingHeader.querySelector('button')!;
        help.focus();
        expect(document.activeElement).toBe(help);
        const primary = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Continue')!;
        expect(scrollRegion.contains(primary)).toBe(false);
    });

    test('sidebar navigation does not stretch or paint over the main content', async () => {
        const { root } = await renderSurface(
            <Wizard
                activeStep="only"
                onStepChange={() => undefined}
                stepsAriaLabel="Setup steps"
                headerBehavior="sticky-navigation"
                navPosition="start"
            >
                <WizardStep value="only" label="Only" />
            </Wizard>,
        );
        const surface = root.querySelector('nav')!.parentElement!;
        const navigationStyles = stylesFor(surface.parentElement!);

        expect(navigationStyles).toContain('position: sticky');
        expect(navigationStyles).toContain('align-self: start');
        expect(stylesFor(surface)).toContain('width: calc(100% + 24px)');
    });

    test('ignores a child that is not a WizardStep, rather than rendering it into the step list', async () => {
        const { root } = await renderSurface(
            <Wizard activeStep="only" onStepChange={() => undefined} stepsAriaLabel="Setup steps">
                <WizardStep value="only" label="Only">
                    <p>only body</p>
                </WizardStep>
                <div>not a step</div>
                {false}
            </Wizard>,
        );

        expect(root.textContent).toContain('only body');
        expect(root.textContent).not.toContain('not a step');
        expect(root.querySelectorAll('button')).toHaveLength(1);
    });

    test('an unknown activeStep renders no step body rather than throwing', async () => {
        const { root } = await renderSurface(wizard('nonexistent'));

        expect(root.querySelector('h2')).toBeNull();
        expect(root.textContent).not.toContain('body');
    });
});
