/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SearchBox, Toolbar, ToolbarToggleButton } from '@fluentui/react-components';
import { AppsListRegular, TableRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexViewMode } from '../types';

export interface IndexToolbarProps {
    /** Current view mode; drives the toggle's checked state. */
    viewMode: IndexViewMode;
    onViewModeChange: (mode: IndexViewMode) => void;
    /** Filter text (not wired to filtering yet — prototype). */
    filterText: string;
    onFilterTextChange: (value: string) => void;
}

/** Toggle name shared between the two view-mode toggle buttons. */
const VIEW_TOGGLE_NAME = 'indexViewMode';

/**
 * Toolbar shown between the metrics row and the index content. Hosts a filter
 * box (for collections with many indexes) and a Cards/Table view toggle.
 *
 * The two toggle buttons behave like a radio group: exactly one is always
 * selected. We drive that manually through the Toolbar's `checkedValues` so
 * clicking the already-selected option is a no-op instead of clearing it.
 */
export const IndexToolbar = ({
    viewMode,
    onViewModeChange,
    filterText,
    onFilterTextChange,
}: IndexToolbarProps): JSX.Element => {
    return (
        <Toolbar
            size="small"
            className="indexToolbar"
            aria-label={l10n.t('Index view options')}
            checkedValues={{ [VIEW_TOGGLE_NAME]: [viewMode] }}
            onCheckedValueChange={(_event, { name, checkedItems }) => {
                if (name !== VIEW_TOGGLE_NAME) {
                    return;
                }
                // Radio behaviour: adopt the value the user just turned on and
                // ignore an attempt to turn the current one off.
                const next = checkedItems.find((value) => value !== viewMode);
                if (next === 'cards' || next === 'table') {
                    onViewModeChange(next);
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

            <div className="indexToolbarSpacer" />

            <ToolbarToggleButton name={VIEW_TOGGLE_NAME} value="cards" appearance="subtle" icon={<AppsListRegular />}>
                {l10n.t('Cards')}
            </ToolbarToggleButton>
            <ToolbarToggleButton name={VIEW_TOGGLE_NAME} value="table" appearance="subtle" icon={<TableRegular />}>
                {l10n.t('Table')}
            </ToolbarToggleButton>
        </Toolbar>
    );
};
