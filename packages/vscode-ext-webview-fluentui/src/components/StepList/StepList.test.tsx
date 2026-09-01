/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { act, type ReactElement } from 'react';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import { StepList, StepListItem } from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

const steps = (selected: string, onSelect: (value: string) => void): ReactElement => (
    <StepList selectedValue={selected} onStepSelect={(_event, data) => onSelect(data.value)} ariaLabel="Setup steps">
        <StepListItem value="introduction" completed navigable>
            Introduction
        </StepListItem>
        <StepListItem value="configure" completed>
            Configure
        </StepListItem>
        <StepListItem value="setup">Set up</StepListItem>
    </StepList>
);

describe('StepList', () => {
    test('marks the selected step as the current one', async () => {
        const { root } = await renderSurface(steps('configure', () => undefined));

        const current = root.querySelectorAll('[aria-current="step"]');
        expect(current).toHaveLength(1);
        expect(current[0]?.textContent).toContain('Configure');
    });

    test('a navigable step reports its value; a non-navigable one is focusable but inert', async () => {
        const onSelect = jest.fn<(value: string) => void>();
        const { root } = await renderSurface(steps('configure', onSelect));

        const buttons = Array.from(root.querySelectorAll('button'));
        const introduction = buttons.find((button) => button.textContent?.includes('Introduction'));
        const setup = buttons.find((button) => button.textContent?.includes('Set up'));

        await act(async () => {
            introduction?.click();
        });
        expect(onSelect).toHaveBeenCalledWith('introduction');

        // `disabledFocusable`: still reachable by keyboard so it can be read, but it does nothing.
        expect(setup?.getAttribute('aria-disabled')).toBe('true');
        await act(async () => {
            setup?.click();
        });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    test('ignores children that are not StepListItem', async () => {
        const { root } = await renderSurface(
            <StepList selectedValue="a" onStepSelect={() => undefined} ariaLabel="Setup steps">
                <StepListItem value="a">A</StepListItem>
                <div>not a step</div>
                {false}
                {null}
            </StepList>,
        );

        expect(root.textContent).not.toContain('not a step');
        expect(root.querySelectorAll('button')).toHaveLength(1);
    });

    test('names the navigation landmark', async () => {
        const { root } = await renderSurface(steps('setup', () => undefined));

        const landmark = root.matches('[aria-label="Setup steps"]')
            ? root
            : root.querySelector('[aria-label="Setup steps"]');
        expect(landmark).not.toBeNull();
    });
});
