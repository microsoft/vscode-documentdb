/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Toolbar,
    ToolbarButton,
    ToolbarToggleButton,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    ArrowExportRegular,
    ArrowImportRegular,
    PlayRegular,
    SparkleFilled,
    SparkleRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useContext, type JSX } from 'react';
import { useConfiguration } from '../../../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { type CollectionViewWebviewConfigurationType } from '../../collectionViewController';
import { useHideScrollbarsDuringResize } from '../../hooks/useHideScrollbarsDuringResize';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

export const ToolbarMainView = (): JSX.Element => {
    // const { trpcClient } = useTrpcClient();

    return (
        <>
            <ToolbarQueryOperations />
            <ToolbarDataOperations />
            {/* <ToolbarDivider /> */}
            {/* <Menu>
                <MenuTrigger>
                    <Tooltip content={l10n.t('Provide Feedback')} relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={l10n.t('Provide Feedback')}
                            icon={<EmojiSmileSlightRegular />}
                        ></ToolbarButton>
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={<CommentCheckmarkRegular />}
                            onClick={() => {
                                trpcClient.common.surveyOpen
                                    .mutate({
                                        triggerAction: 'documentDB.collectionView.provideFeedback',
                                    })
                                    .catch(() => {});
                            }}
                        >
                            {l10n.t('Provide Feedback')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu> */}
        </>
    );
};

const ToolbarQueryOperations = (): JSX.Element => {
    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const { trpcClient } = useTrpcClient();
    const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();

    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const hideScrollbarsTemporarily = useHideScrollbarsDuringResize();

    const handleExecuteQuery = () => {
        // return to the root level
        setCurrentContext((prev) => ({
            ...prev,
            currentViewState: {
                ...prev.currentViewState,
                currentPath: [],
            },
        }));

        // execute the query - get all values from the query editor at once
        const query = currentContext.queryEditor?.getCurrentQuery() ?? {
            filter: '{  }',
            project: '{  }',
            sort: '{  }',
            skip: 0,
            limit: 0,
        };

        setCurrentContext((prev) => ({
            ...prev,
            activeQuery: {
                ...prev.activeQuery,
                queryText: query.filter, // deprecated: kept in sync with filter for backward compatibility
                filter: query.filter,
                project: query.project,
                sort: query.sort,
                skip: query.skip,
                limit: query.limit,
                pageNumber: 1,
                executionIntent: 'initial',
            },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'executeQuery',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    queryLength: query.filter.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    };

    const handleRefreshResults = () => {
        // basically, do not modify the query at all, do not use the input from the editor
        setCurrentContext((prev) => ({
            ...prev,
            activeQuery: {
                ...prev.activeQuery,
                executionIntent: 'refresh',
            },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'refreshResults',
                properties: {
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: currentContext.activeQuery.pageNumber,
                    pageSize: currentContext.activeQuery.pageSize,
                    queryLength: currentContext.activeQuery.queryText.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    };

    const checkedValues = {
        aiToggle: currentContext.isAiRowVisible ? ['copilot'] : [],
    };

    const handleCheckedValueChange: React.ComponentProps<typeof Toolbar>['onCheckedValueChange'] = (
        _e,
        { name, checkedItems },
    ) => {
        if (name === 'aiToggle') {
            setCurrentContext((prev) => ({
                ...prev,
                isAiRowVisible: checkedItems.includes('copilot'),
            }));

            // Temporarily hide scrollbars during the transition to improve UX responsiveness
            hideScrollbarsTemporarily();
        }
    };

    return (
        <Toolbar size="small" checkedValues={checkedValues} onCheckedValueChange={handleCheckedValueChange}>
            <ToolbarButton
                aria-label={l10n.t('Execute the find query')}
                disabled={currentContext.isLoading}
                icon={<PlayRegular />}
                onClick={handleExecuteQuery}
                appearance="primary"
            >
                {l10n.t('Find Query')}
            </ToolbarButton>

            <ToolbarDividerTransparent />

            {configuration.enableAIQueryGeneration && (
                <>
                    <ToolbarToggleButton
                        appearance="subtle"
                        aria-label={l10n.t('Generate query with AI')}
                        icon={currentContext.isAiRowVisible ? <SparkleFilled /> : <SparkleRegular />}
                        name="aiToggle"
                        value="copilot"
                    >
                        {l10n.t('Generate')}
                    </ToolbarToggleButton>
                    <ToolbarDividerTransparent />
                </>
            )}

            <ToolbarButton
                aria-label={l10n.t('Refresh current view')}
                onClick={handleRefreshResults}
                icon={<ArrowClockwiseRegular />}
            >
                {l10n.t('Refresh')}
            </ToolbarButton>
        </Toolbar>
    );
};

const ToolbarDataOperations = (): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    const { trpcClient } = useTrpcClient();

    const handleImportFromJson = () => {
        void trpcClient.mongoClusters.collectionView.importDocuments.query();
    };

    const handleExportEntireCollection = () => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({
            filter: '{}',
            project: undefined,
            sort: undefined,
            skip: undefined,
            limit: undefined,
        });
    };

    const handleExportQueryResults = () => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({
            filter: currentContext.activeQuery.filter,
            project: currentContext.activeQuery.project,
            sort: currentContext.activeQuery.sort,
            skip: currentContext.activeQuery.skip,
            limit: currentContext.activeQuery.limit,
        });
    };

    return (
        <Toolbar size="small">
            <Menu>
                <MenuTrigger>
                    <ToolbarButton icon={<ArrowImportRegular />}>{l10n.t('Import')}</ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={handleImportFromJson}>{l10n.t('Import From JSON…')}</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
            <Menu>
                <MenuTrigger>
                    <ToolbarButton icon={<ArrowExportRegular />}>{l10n.t('Export')}</ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={handleExportEntireCollection}>
                            {l10n.t('Export Entire Collection…')}
                        </MenuItem>
                        <MenuItem onClick={handleExportQueryResults}>
                            {l10n.t('Export Current Query Results…')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </Toolbar>
    );
};
