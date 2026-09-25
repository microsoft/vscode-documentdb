/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { AddRegular, ArrowClockwiseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

export interface IndexManagementToolbarProps {
    onCreateIndex: () => void;
    onRefreshIndexes: () => void;
}

export const IndexManagementToolbar = ({
    onCreateIndex,
    onRefreshIndexes,
}: IndexManagementToolbarProps): JSX.Element => (
    <Toolbar
        className="primaryActionBar actionBarToolbar indexManagementToolbar"
        aria-label={l10n.t('Index actions')}
        size="small"
    >
        <ToolbarButton icon={<AddRegular />} appearance="primary" onClick={onCreateIndex}>
            {l10n.t('Create Index')}
        </ToolbarButton>
        <Tooltip content={l10n.t('Refresh indexes')} relationship="description" withArrow>
            <ToolbarButton
                aria-label={l10n.t('Refresh indexes')}
                icon={<ArrowClockwiseRegular />}
                onClick={onRefreshIndexes}
            >
                {l10n.t('Refresh')}
            </ToolbarButton>
        </Tooltip>
    </Toolbar>
);
