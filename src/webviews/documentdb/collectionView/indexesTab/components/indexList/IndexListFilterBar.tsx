/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, SearchBox, Toolbar, ToolbarToggleButton, Tooltip } from '@fluentui/react-components';
import { ArrowResetRegular, EyeOffRegular, PulseRegular } from '@fluentui/react-icons';
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
    /** Resets the filter text and quick-filter toggles. */
    onClearFilters: () => void;
}

/**
 * The filter row for the index list: a text filter box that grows to fill the
 * available width, the quick Hidden / Unused toggles, and a Clear button pinned
 * to the far right. Fully controlled by {@link IndexList}.
 */
export const IndexListFilterBar = ({
    filterText,
    onFilterTextChange,
    quickFilters,
    onQuickFiltersChange,
    onClearFilters,
}: IndexListFilterBarProps): JSX.Element => {
    const checked: string[] = [];
    if (quickFilters.hidden) checked.push('hidden');
    if (quickFilters.unused) checked.push('unused');

    const hasActiveFilters = filterText.length > 0 || quickFilters.hidden || quickFilters.unused;

    return (
        <Toolbar
            size="medium"
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

            <Tooltip content={l10n.t('Show only hidden indexes')} relationship="description" withArrow>
                <ToolbarToggleButton name="quick" value="hidden" appearance="subtle" icon={<EyeOffRegular />}>
                    {l10n.t('Hidden')}
                </ToolbarToggleButton>
            </Tooltip>
            <Tooltip content={l10n.t('Show only unused indexes')} relationship="description" withArrow>
                <ToolbarToggleButton name="quick" value="unused" appearance="subtle" icon={<PulseRegular />}>
                    {l10n.t('Unused')}
                </ToolbarToggleButton>
            </Tooltip>

            <Tooltip content={l10n.t('Clear all filters')} relationship="description" withArrow>
                <Button
                    className="indexFilterClear"
                    appearance="subtle"
                    icon={<ArrowResetRegular />}
                    disabled={!hasActiveFilters}
                    onClick={onClearFilters}
                >
                    {l10n.t('Clear filters')}
                </Button>
            </Tooltip>
        </Toolbar>
    );
};
