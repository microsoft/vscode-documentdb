/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { AddFilled, DeleteRegular, EditRegular, EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useContext, type JSX } from 'react';
import { CollectionViewContext } from '../../collectionViewContext';

interface ToolbarDocumentsProps {
    onDeleteClick: () => void;
    onEditClick: () => void;
    onViewClick: () => void;
    onAddClick: () => void;
}

export const ToolbarDocumentManipulation = ({
    onDeleteClick,
    onEditClick,
    onViewClick,
    onAddClick,
}: ToolbarDocumentsProps): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Toolbar aria-label={l10n.t('with Popover')} size="small">
            <Tooltip content={l10n.t('Add new document')} relationship="description" withArrow>
                <ToolbarButton
                    aria-label={l10n.t('Add new document')}
                    icon={<AddFilled />}
                    disabled={currentContext.commands.disableAddDocument}
                    onClick={onAddClick}
                />
            </Tooltip>

            <Tooltip content={l10n.t('View selected document')} relationship="description" withArrow>
                <ToolbarButton
                    aria-label={l10n.t('View selected document')}
                    icon={<EyeRegular />}
                    disabled={currentContext.commands.disableViewDocument}
                    onClick={onViewClick}
                />
            </Tooltip>

            <Tooltip content={l10n.t('Edit selected document')} relationship="description" withArrow>
                <ToolbarButton
                    aria-label={l10n.t('Edit selected document')}
                    icon={<EditRegular />}
                    disabled={currentContext.commands.disableEditDocument}
                    onClick={onEditClick}
                />
            </Tooltip>

            <Tooltip content={l10n.t('Delete selected document(s)')} relationship="description" withArrow>
                <ToolbarButton
                    aria-label={l10n.t('Delete selected document(s)')}
                    icon={<DeleteRegular />}
                    disabled={currentContext.commands.disableDeleteDocument}
                    onClick={onDeleteClick}
                />
            </Tooltip>
        </Toolbar>
    );
};
