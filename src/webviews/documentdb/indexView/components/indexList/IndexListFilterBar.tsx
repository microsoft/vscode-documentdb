/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, SearchBox, Toolbar, ToolbarDivider, ToolbarToggleButton } from '@fluentui/react-components';
import { EyeOffRegular, PulseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

/** The state of the quick filter toggles. */
export interface QuickFilters {
    /** Show only hidden indexes. */
    hidden: boolean;
    /** Show only unused indexes (non-default, zero recorded usage). */
    unused: boolean;
}

export interface IndexListFilterBarProps {
    filterText: string;
    onFilterTextChange: (value: string) => void;
    quickFilters: QuickFilters;
    onQuickFiltersChange: (next: QuickFilters) => void;
    /** Total number of indexes (before filtering). */
    totalCount: number;
    /** Number of indexes shown after the current filters. */
    shownCount: number;
}

/**
 * The filter row for the index list: a text filter box, quick Hidden / Unused
 * toggles, and a live "showing X of Y" count. Fully controlled by {@link IndexList}.
 */
export const IndexListFilterBar = ({
    filterText,
    onFilterTextChange,
    quickFilters,
    onQuickFiltersChange,
    totalCount,
    shownCount,
}: IndexListFilterBarProps): JSX.Element => {
    const checked: string[] = [];
    if (quickFilters.hidden) checked.push('hidden');
    if (quickFilters.unused) checked.push('unused');

    return (
        <Toolbar
            size="small"
            className="indexToolbar"
            aria-label={l10n.t('Filter indexes')}
            checkedValues={{ quick: checked }}
            onCheckedValueChange={(_event, { name, checkedItems }) => {
                if (name === 'quick') {
                    onQuickFiltersChange({
                        hidden: checkedItems.includes('hidden'),
                        unused: checkedItems.includes('unused'),
                    });
                }
            }}
        >
            <SearchBox
                className="indexFilterInput"
                placeholder={l10n.t('Filter indexes…')}
                value={filterText}
                onChange={(_event, data) => onFilterTextChange(data.value)}
                aria-label={l10n.t('Filter indexes')}
            />

            <ToolbarDivider />

            <ToolbarToggleButton name="quick" value="hidden" appearance="subtle" icon={<EyeOffRegular />}>
                {l10n.t('Hidden')}
            </ToolbarToggleButton>
            <ToolbarToggleButton name="quick" value="unused" appearance="subtle" icon={<PulseRegular />}>
                {l10n.t('Unused')}
            </ToolbarToggleButton>

            <div className="indexFilterSpacer" />

            <Caption1 className="indexFilterCount" aria-live="polite">
                {l10n.t('Showing {0} of {1}', shownCount, totalCount)}
            </Caption1>
        </Toolbar>
    );
};
