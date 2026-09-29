import { SSRProvider } from '@fluentui/react-components';
import { act } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

import { NamespaceTable, type NamespaceRow } from './NamespaceTable';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));
jest.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => ({ clusterId: 'cluster-id' }),
}));
jest.mock('../../collectionView/queryInsightsTab/components/metricsRow', () => ({
    formatCount: (value: number): string => String(value),
}));

const row: NamespaceRow = {
    name: 'catalog',
    sizeBytes: 1,
    dataSizeBytes: 1,
    indexSizeBytes: 0,
    childCount: 1,
    documents: 1,
    isView: false,
};

describe('NamespaceTable row activation', () => {
    it.each(['databases', 'collections'] as const)('activates %s on row and action-button clicks', async (level) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onActivate = jest.fn();

        try {
            await act(async () => {
                root.render(
                    <SSRProvider>
                        <NamespaceTable
                            level={level}
                            rows={[row]}
                            sort={{ column: 'name', direction: 'ascending' }}
                            onSortToggle={jest.fn()}
                            onActivate={onActivate}
                            databaseName={level === 'collections' ? 'test' : undefined}
                        />
                    </SSRProvider>,
                );
            });

            await act(async () => {
                host.querySelector('tbody tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            expect(onActivate).toHaveBeenCalledWith(row, 'rowClick');

            await act(async () => {
                host
                    .querySelector<HTMLButtonElement>('button[aria-label="Open collection"], button[aria-label="Show collections"]')
                    ?.click();
            });
            expect(onActivate).toHaveBeenCalledTimes(2);
            expect(onActivate).toHaveBeenLastCalledWith(row, 'rowActionButton');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});