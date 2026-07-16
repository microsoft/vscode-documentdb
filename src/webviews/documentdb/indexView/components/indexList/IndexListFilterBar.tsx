/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SearchBox, Toolbar, ToolbarToggleButton } from '@fluentui/react-components';
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
}

/**
 * The filter row for the index list: a text filter box that grows to fill the
 * available width, with the quick Hidden / Unused toggles pinned to the right.
 * Fully controlled by {@link IndexList}.
 */
export const IndexListFilterBar = ({
    filterText,
    onFilterTextChange,
    quickFilters,
    onQuickFiltersChange,
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

            <ToolbarToggleButton name="quick" value="hidden" appearance="subtle" icon={<EyeOffRegular />}>
                {l10n.t('Hidden')}
            </ToolbarToggleButton>
            <ToolbarToggleButton name="quick" value="unused" appearance="subtle" icon={<PulseRegular />}>
                {l10n.t('Unused')}
            </ToolbarToggleButton>
        </Toolbar>
    );
};
