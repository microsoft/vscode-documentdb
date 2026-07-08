/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuButton,
    MenuItemCheckbox,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SearchBox,
    Toolbar,
    ToolbarDivider,
    ToolbarToggleButton,
} from '@fluentui/react-components';
import { EyeOffRegular, FilterRegular, PulseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useState, type JSX } from 'react';

export interface IndexToolbarProps {
    /** Filter text (not wired to filtering yet). */
    filterText: string;
    onFilterTextChange: (value: string) => void;
}

/**
 * Suggested index-type filter options. Presentational only for now — these
 * mirror the type badges shown in the table's Type column.
 */
const INDEX_TYPE_FILTERS: ReadonlyArray<string> = [
    'Single Field',
    'Compound',
    'Multikey',
    'Text',
    'Wildcard',
    'Geospatial',
    'Hashed',
];

/**
 * Filter row shown between the metrics row and the index table. Hosts the
 * filter box plus a set of suggested filter controls.
 *
 * NOTE: the filter box and the toggles below are intentionally NOT wired to the
 * table yet — they are UI proposals so we can settle on which filters are worth
 * building (filter by index type, and quick "Hidden" / "Unused" toggles).
 */
export const IndexToolbar = ({ filterText, onFilterTextChange }: IndexToolbarProps): JSX.Element => {
    // Presentational-only selection state (does not affect the table yet).
    const [checkedTypes, setCheckedTypes] = useState<Record<string, string[]>>({ type: [] });
    const [quickFilters, setQuickFilters] = useState<Record<string, string[]>>({ quick: [] });

    return (
        <Toolbar
            size="small"
            className="indexToolbar"
            aria-label={l10n.t('Filter indexes')}
            checkedValues={quickFilters}
            onCheckedValueChange={(_event, { name, checkedItems }) =>
                setQuickFilters((prev) => ({ ...prev, [name]: checkedItems }))
            }
        >
            <SearchBox
                className="indexFilterInput"
                placeholder={l10n.t('Filter indexes…')}
                value={filterText}
                onChange={(_event, data) => onFilterTextChange(data.value)}
                aria-label={l10n.t('Filter indexes')}
            />

            <ToolbarDivider />

            {/* Filter by index type (multi-select). Presentational for now. */}
            <Menu
                checkedValues={checkedTypes}
                onCheckedValueChange={(_event, { name, checkedItems }) =>
                    setCheckedTypes((prev) => ({ ...prev, [name]: checkedItems }))
                }
            >
                <MenuTrigger disableButtonEnhancement>
                    <MenuButton size="small" appearance="subtle" icon={<FilterRegular />}>
                        {l10n.t('Type')}
                    </MenuButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        {INDEX_TYPE_FILTERS.map((type) => (
                            <MenuItemCheckbox key={type} name="type" value={type}>
                                {type}
                            </MenuItemCheckbox>
                        ))}
                    </MenuList>
                </MenuPopover>
            </Menu>

            {/* Quick filter toggles. Presentational for now. */}
            <ToolbarToggleButton name="quick" value="hidden" appearance="subtle" icon={<EyeOffRegular />}>
                {l10n.t('Hidden')}
            </ToolbarToggleButton>
            <ToolbarToggleButton name="quick" value="unused" appearance="subtle" icon={<PulseRegular />}>
                {l10n.t('Unused')}
            </ToolbarToggleButton>
        </Toolbar>
    );
};
