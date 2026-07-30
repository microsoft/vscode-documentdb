/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SSRProvider } from '@fluentui/react-components';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
// eslint-disable-next-line import/no-internal-modules -- React DOM exposes server rendering through this public subpath.
import { renderToStaticMarkup } from 'react-dom/server';
import { IndexManagementToolbar } from './IndexManagementToolbar';

jest.mock('@vscode/l10n', () => ({
    t: (message: string): string => message,
}));

describe('IndexManagementToolbar', () => {
    it('renders only collection-level index actions', () => {
        const markup = renderToStaticMarkup(
            createElement(
                SSRProvider,
                null,
                createElement(IndexManagementToolbar, {
                    onCreateIndex: jest.fn(),
                    onRefreshIndexes: jest.fn(),
                }),
            ),
        );

        expect(markup).toContain('aria-label="Index actions"');
        expect(markup).toContain('Create Index');
        expect(markup).toContain('aria-label="Refresh indexes"');
        expect(markup).not.toContain('Import');
        expect(markup).not.toContain('Export');
        expect(markup).not.toContain('Copy Query');
        expect(markup).not.toContain('Paste Query');
        expect(markup).not.toContain('Playground');
        expect(markup).not.toContain('Shell');
    });

    it('wires Create Index and Refresh directly to the supplied handlers', () => {
        const onCreateIndex = jest.fn();
        const onRefreshIndexes = jest.fn();
        const toolbar = IndexManagementToolbar({ onCreateIndex, onRefreshIndexes });
        const children = Children.toArray((toolbar.props as { children: ReactNode }).children);
        const createButton = children[0];
        const refreshTooltip = children[1];

        expect(isValidElement(createButton)).toBe(true);
        expect((createButton as ReactElement<{ onClick: () => void }>).props.onClick).toBe(onCreateIndex);
        expect(isValidElement(refreshTooltip)).toBe(true);
        expect(
            (refreshTooltip as ReactElement<{ children: ReactElement<{ onClick: () => void }> }>).props.children.props
                .onClick,
        ).toBe(onRefreshIndexes);
    });
});
