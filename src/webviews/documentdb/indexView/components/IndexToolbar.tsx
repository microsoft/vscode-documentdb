/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option, SearchBox, Toolbar } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexViewMode } from '../types';

export interface IndexToolbarProps {
    /** Current view mode; drives the dropdown's selected option. */
    viewMode: IndexViewMode;
    onViewModeChange: (mode: IndexViewMode) => void;
    /** Filter text (not wired to filtering yet — prototype). */
    filterText: string;
    onFilterTextChange: (value: string) => void;
}

/** Human-readable labels for each view mode (also the dropdown display text). */
const VIEW_MODE_LABELS: Record<IndexViewMode, string> = {
    cards: l10n.t('Cards View'),
    table: l10n.t('Table View'),
};

/**
 * Toolbar shown between the metrics row and the index content. Hosts a filter
 * box (for collections with many indexes) and a Cards/Table view dropdown —
 * mirroring the Results tab's Table/Tree/JSON `ViewSwitcher`.
 */
export const IndexToolbar = ({
    viewMode,
    onViewModeChange,
    filterText,
    onFilterTextChange,
}: IndexToolbarProps): JSX.Element => {
    return (
        <Toolbar size="small" className="indexToolbar" aria-label={l10n.t('Index view options')}>
            <SearchBox
                className="indexFilterInput"
                placeholder={l10n.t('Filter indexes…')}
                value={filterText}
                onChange={(_event, data) => onFilterTextChange(data.value)}
                aria-label={l10n.t('Filter indexes')}
            />

            <div className="indexToolbarSpacer" />

            <Dropdown
                className="indexViewDropdown"
                aria-label={l10n.t('Select index view')}
                value={VIEW_MODE_LABELS[viewMode]}
                selectedOptions={[viewMode]}
                onOptionSelect={(_event, data) => {
                    if (data.optionValue === 'cards' || data.optionValue === 'table') {
                        onViewModeChange(data.optionValue);
                    }
                }}
            >
                <Option value="cards">{VIEW_MODE_LABELS.cards}</Option>
                <Option value="table">{VIEW_MODE_LABELS.table}</Option>
            </Dropdown>
        </Toolbar>
    );
};
