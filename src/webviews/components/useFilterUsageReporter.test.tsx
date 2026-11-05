/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { FILTER_SETTLE_MS, useFilterUsageReporter } from './useFilterUsageReporter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ProbeProps {
    filterText: string;
    scope?: string;
    total?: number;
    report: (properties: Record<string, string>, measurements: Record<string, number>) => void;
}

const Probe = ({ filterText, scope = 'databases', total = 10, report }: ProbeProps): JSX.Element | null => {
    useFilterUsageReporter(
        {
            active: filterText.length > 0,
            scope,
            properties: { level: scope },
            measurements: { totalRows: total, filterLength: filterText.length },
        },
        report,
    );
    return null;
};

describe('useFilterUsageReporter', () => {
    let host: HTMLElement;
    let root: Root;
    const report = vi.fn();

    const render = (props: Omit<ProbeProps, 'report'>): void => {
        act(() => root.render(<Probe {...props} report={report} />));
    };

    beforeEach(() => {
        vi.useFakeTimers();
        report.mockReset();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.useRealTimers();
    });

    it('reports nothing while the filter is empty', () => {
        render({ filterText: '' });
        act(() => {
            vi.advanceTimersByTime(FILTER_SETTLE_MS * 2);
        });
        expect(report).not.toHaveBeenCalled();
    });

    it('reports one use once typing settles, with the settled state and never the text', () => {
        render({ filterText: 'o' });
        render({ filterText: 'or' });
        render({ filterText: 'ord' });
        expect(report).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(FILTER_SETTLE_MS);
        });

        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith({ level: 'databases' }, { totalRows: 10, filterLength: 3 });
        expect(JSON.stringify(report.mock.calls)).not.toContain('ord');
    });

    it('does not report refinements of a settled filter as new uses', () => {
        render({ filterText: 'ord' });
        act(() => {
            vi.advanceTimersByTime(FILTER_SETTLE_MS);
        });
        render({ filterText: 'orders' });
        act(() => {
            vi.advanceTimersByTime(FILTER_SETTLE_MS);
        });

        expect(report).toHaveBeenCalledTimes(1);
    });

    it('reports a new use after the filter is cleared and used again', () => {
        render({ filterText: 'a' });
        act(() => {
            vi.advanceTimersByTime(FILTER_SETTLE_MS);
        });
        render({ filterText: '' });
        render({ filterText: 'b' });
        act(() => {
            vi.advanceTimersByTime(FILTER_SETTLE_MS);
        });

        expect(report).toHaveBeenCalledTimes(2);
    });

    it('reports a use that ends before it settles, when it ends', () => {
        render({ filterText: 'ord' });
        render({ filterText: '', scope: 'collections' });

        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith({ level: 'databases' }, { totalRows: 10, filterLength: 3 });
    });

    it('reports a pending use when the list goes away', () => {
        render({ filterText: 'ord' });
        act(() => root.unmount());
        root = createRoot(host);

        expect(report).toHaveBeenCalledTimes(1);
    });
});
