/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SSRProvider } from '@fluentui/react-components';
import { createElement, type Dispatch, type SetStateAction } from 'react';
// eslint-disable-next-line import/no-internal-modules -- React DOM exposes server rendering through this public subpath.
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CollectionViewContext,
    type CollectionViewContextType,
    DefaultCollectionViewContext,
} from '../../collectionViewContext';
import { CollectionQueryActionBar, type CollectionQueryActionBarProps } from './CollectionQueryActionBar';

jest.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => ({ enableAIQueryGeneration: true }),
}));

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, arg, index) => result.replace(`{${index}}`, String(arg)), message),
}));

jest.mock('../../../../_integration/useTrpcClient', () => ({
    useTrpcClient: () => ({}),
}));

function renderActionBar(variant: CollectionQueryActionBarProps['variant']): string {
    const setContext = jest.fn() as Dispatch<SetStateAction<CollectionViewContextType>>;
    return renderToStaticMarkup(
        createElement(
            SSRProvider,
            null,
            createElement(
                CollectionViewContext.Provider,
                { value: [DefaultCollectionViewContext, setContext] },
                createElement(CollectionQueryActionBar, { variant }),
            ),
        ),
    );
}

describe('CollectionQueryActionBar', () => {
    it('renders document transfer and query utility actions for Documents', () => {
        const markup = renderActionBar('documents');

        expect(markup).toContain('Find Query');
        expect(markup).toContain('Generate');
        expect(markup).toContain('Refresh: Rerun the last executed query');
        expect(markup).toContain('>Import</button>');
        expect(markup).toContain('>Export</button>');
        expect(markup).toContain('Copy Query');
        expect(markup).toContain('Paste Query');
        expect(markup).toContain('Playground');
        expect(markup).toContain('Shell');
    });

    it('omits document transfer actions from Query Insights', () => {
        const markup = renderActionBar('queryInsights');

        expect(markup).toContain('Find Query');
        expect(markup).toContain('Generate');
        expect(markup).toContain('Refresh: Refresh query and query insights');
        expect(markup).not.toContain('>Import</button>');
        expect(markup).not.toContain('>Export</button>');
        expect(markup).toContain('Copy Query');
        expect(markup).toContain('Paste Query');
        expect(markup).toContain('Playground');
        expect(markup).toContain('Shell');
    });

    it('keeps primary query actions outside Overflow', () => {
        const markup = renderActionBar('documents');
        const overflowToolbar = markup.indexOf('fui-Overflow');

        expect(overflowToolbar).toBeGreaterThan(0);
        expect(markup.indexOf('Find Query')).toBeLessThan(overflowToolbar);
        expect(markup.indexOf('Generate')).toBeLessThan(overflowToolbar);
        expect(markup.indexOf('Refresh: Rerun the last executed query')).toBeLessThan(overflowToolbar);
        expect(markup.indexOf('>Import</button>')).toBeGreaterThan(overflowToolbar);
    });
});
