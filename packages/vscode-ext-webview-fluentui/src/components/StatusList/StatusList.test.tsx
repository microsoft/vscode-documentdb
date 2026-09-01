/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { type ReactElement } from 'react';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import { StatusList, StatusListItem } from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

describe('StatusList', () => {
    test('voices the status as a word after the label, and gives the row no aria-label', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Setup progress">
                <StatusListItem label="Checking Docker" status="done" />
                <StatusListItem label="Pulling official image" status="active" />
                <StatusListItem label="Creating container" status="pending" />
            </StatusList>,
        );

        const rows = root.querySelectorAll('[role="listitem"]');
        expect(rows).toHaveLength(3);
        expect(rows[0]?.textContent).toBe('Checking Docker, done');
        expect(rows[1]?.textContent).toBe('Pulling official image, in progress');
        expect(rows[0]?.getAttribute('aria-label')).toBeNull();
    });

    test('takes localized status words', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Fortschritt" statusLabels={{ error: 'fehlgeschlagen' }}>
                <StatusListItem label="Docker" status="error" />
                <StatusListItem label="Abbild" status="pending" />
            </StatusList>,
        );

        const rows = root.querySelectorAll('[role="listitem"]');
        expect(rows[0]?.textContent).toBe('Docker, fehlgeschlagen');
        // Unlisted statuses keep the English default rather than disappearing.
        expect(rows[1]?.textContent).toBe('Abbild, pending');
    });

    test('detail renders arbitrary content, and interactive content inside it stays reachable', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Setup progress">
                <StatusListItem
                    label="Checking Docker"
                    status="error"
                    detail={
                        <>
                            {'no Docker CLI found · '}
                            <button type="button">Check Docker again</button>
                        </>
                    }
                />
            </StatusList>,
        );

        expect(root.querySelector('button')?.textContent).toBe('Check Docker again');
    });

    test('reserveDetailSpace holds the line before the detail arrives, and yields to it after', async () => {
        const row = (detail?: string): ReactElement => (
            <StatusList ariaLabel="Setup progress">
                <StatusListItem label="Checking Docker" status="active" detail={detail} reserveDetailSpace />
            </StatusList>
        );

        const { root, rerender } = await renderSurface(row(undefined));
        const detailLine = (): Element | null | undefined =>
            root.querySelector('[role="listitem"]')?.lastElementChild?.lastElementChild;
        expect(detailLine()?.textContent).toBe('\u00a0');

        await rerender(row('Docker Engine 27.3'));
        expect(detailLine()?.textContent).toBe('Docker Engine 27.3');
    });

    test('a row without a detail and without reserved space renders no detail line', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Setup progress">
                <StatusListItem label="Creating container" status="pending" />
            </StatusList>,
        );

        const copy = root.querySelector('[role="listitem"]')?.lastElementChild;
        expect(copy?.children).toHaveLength(1);
    });
});
