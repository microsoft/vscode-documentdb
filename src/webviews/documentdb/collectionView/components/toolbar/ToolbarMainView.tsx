/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Overflow,
    OverflowItem,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    ToolbarToggleButton,
    Tooltip,
    useIsOverflowGroupVisible,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    ArrowExportRegular,
    ArrowImportRegular,
    ClipboardPasteRegular,
    CopyRegular,
    KeyboardRegular,
    MoreHorizontalRegular,
    PlayRegular,
    SparkleFilled,
    SparkleRegular,
    WindowConsoleRegular,
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
    return (
        <>
            <ToolbarQueryOperations />
            <ToolbarSecondaryActions />
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

/**
 * Secondary toolbar actions (Import, Export | Copy, Paste, Playground, Shell)
 * wrapped in an Overflow container with two groups separated by a divider.
 * Items collapse into a "..." overflow menu when the toolbar is too narrow.
 */
const ToolbarSecondaryActions = (): JSX.Element => {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const { trpcClient } = useTrpcClient();

    // ─── Handlers ───────────────────────────────────────────────────────────────

    const getLastExecutedQuery = (): {
        filter: string;
        project: string;
        sort: string;
        skip: number;
        limit: number;
    } => ({
        filter: currentContext.activeQuery.filter,
        project: currentContext.activeQuery.project,
        sort: currentContext.activeQuery.sort,
        skip: currentContext.activeQuery.skip,
        limit: currentContext.activeQuery.limit,
    });

    const handleImportFromJson = (): void => {
        void trpcClient.mongoClusters.collectionView.importDocuments.query();
    };

    const handleExportEntireCollection = (): void => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({
            filter: '{}',
            project: undefined,
            sort: undefined,
            skip: undefined,
            limit: undefined,
        });
    };

    const handleExportQueryResults = (): void => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({
            filter: currentContext.activeQuery.filter,
            project: currentContext.activeQuery.project,
            sort: currentContext.activeQuery.sort,
            skip: currentContext.activeQuery.skip,
            limit: currentContext.activeQuery.limit,
        });
    };

    const handleCopyQuery = (): void => {
        const query = getLastExecutedQuery();
        void trpcClient.mongoClusters.collectionView.copyQueryToClipboard.mutate({
            filter: query.filter,
            project: query.project,
            sort: query.sort,
            skip: query.skip,
            limit: query.limit,
        });
    };

    const handlePasteQuery = (): void => {
        void trpcClient.mongoClusters.collectionView.pasteQueryFromClipboard.mutate().then((result) => {
            if (result.success) {
                setCurrentContext((prev) => ({
                    ...prev,
                    pendingPaste: {
                        filter: result.filter,
                        project: result.project,
                        sort: result.sort,
                        skip: result.skip,
                        limit: result.limit,
                    },
                }));
            }
        });
    };

    const handleOpenInPlayground = (): void => {
        const query = getLastExecutedQuery();
        void trpcClient.mongoClusters.collectionView.openInPlayground.mutate({
            filter: query.filter,
            project: query.project,
            sort: query.sort,
            skip: query.skip,
            limit: query.limit,
        });
    };

    const handleOpenInShell = (): void => {
        const query = getLastExecutedQuery();
        void trpcClient.mongoClusters.collectionView.openInShell.mutate({
            filter: query.filter,
            project: query.project,
            sort: query.sort,
            skip: query.skip,
            limit: query.limit,
        });
    };

    return (
        <Overflow padding={40}>
            <Toolbar size="small">
                {/* Group "data": Import / Export */}
                <OverflowItem id="import" groupId="data" priority={6}>
                    <span className="overflowItemMenuWrapper">
                        <Menu>
                            <MenuTrigger>
                                <Tooltip content={l10n.t('Import documents')} relationship="description" withArrow>
                                    <ToolbarButton icon={<ArrowImportRegular />}>{l10n.t('Import')}</ToolbarButton>
                                </Tooltip>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem onClick={handleImportFromJson}>{l10n.t('Import From JSON…')}</MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </span>
                </OverflowItem>
                <OverflowItem id="export" groupId="data" priority={5}>
                    <span className="overflowItemMenuWrapper">
                        <Menu>
                            <MenuTrigger>
                                <Tooltip content={l10n.t('Export documents')} relationship="description" withArrow>
                                    <ToolbarButton icon={<ArrowExportRegular />}>{l10n.t('Export')}</ToolbarButton>
                                </Tooltip>
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
                    </span>
                </OverflowItem>

                {/* Divider between data and query groups — hides when data group overflows */}
                <OverflowGroupDivider groupId="data" />

                {/* Group "query": Copy / Paste / Playground / Shell */}
                <OverflowItem id="copy" groupId="query" priority={4}>
                    <Tooltip content={l10n.t('Copy current query to clipboard')} relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={l10n.t('Copy Query')}
                            icon={<CopyRegular />}
                            onClick={handleCopyQuery}
                        />
                    </Tooltip>
                </OverflowItem>
                <OverflowItem id="paste" groupId="query" priority={3}>
                    <Tooltip
                        content={l10n.t('Paste a find query from clipboard into the editors')}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            aria-label={l10n.t('Paste Query')}
                            icon={<ClipboardPasteRegular />}
                            onClick={handlePasteQuery}
                        />
                    </Tooltip>
                </OverflowItem>
                <OverflowItem id="playground" groupId="query" priority={2}>
                    <Tooltip
                        content={l10n.t('Open current query in a Query Playground')}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton icon={<KeyboardRegular />} onClick={handleOpenInPlayground}>
                            {l10n.t('Playground')}
                        </ToolbarButton>
                    </Tooltip>
                </OverflowItem>
                <OverflowItem id="shell" groupId="query" priority={1}>
                    <Tooltip
                        content={l10n.t('Open current query in an Interactive Shell')}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton icon={<WindowConsoleRegular />} onClick={handleOpenInShell}>
                            {l10n.t('Shell')}
                        </ToolbarButton>
                    </Tooltip>
                </OverflowItem>

                {/* Overflow menu — appears as "..." when items are hidden */}
                <OverflowMenuButton
                    handleImportFromJson={handleImportFromJson}
                    handleExportEntireCollection={handleExportEntireCollection}
                    handleExportQueryResults={handleExportQueryResults}
                    handleCopyQuery={handleCopyQuery}
                    handlePasteQuery={handlePasteQuery}
                    handleOpenInPlayground={handleOpenInPlayground}
                    handleOpenInShell={handleOpenInShell}
                />
            </Toolbar>
        </Overflow>
    );
};

/**
 * Divider between the data and query groups in the toolbar.
 * Hidden when either group is fully overflowed — a divider only makes sense
 * when there are visible items on both sides.
 */
const OverflowGroupDivider = (_props: { groupId: string }): JSX.Element | null => {
    const dataGroupVisible = useIsOverflowGroupVisible('data');
    const queryGroupVisible = useIsOverflowGroupVisible('query');
    if (dataGroupVisible === 'hidden' || queryGroupVisible === 'hidden') {
        return null;
    }
    return <ToolbarDivider />;
};

/**
 * A menu item that only renders when its overflow item is hidden from the toolbar.
 * Must be a separate component because `useIsOverflowItemVisible` is a React hook.
 */
const OverflowMenuItem = ({ id, children }: { id: string; children: JSX.Element | null }): JSX.Element | null => {
    const isVisible = useIsOverflowItemVisible(id);
    return isVisible ? null : children;
};

/**
 * The "..." overflow menu button. Only renders when items have overflowed.
 * Contains all overflowed items in toolbar order, each conditionally shown
 * based on whether the corresponding toolbar item is still visible.
 */
const OverflowMenuButton = ({
    handleImportFromJson,
    handleExportEntireCollection,
    handleExportQueryResults,
    handleCopyQuery,
    handlePasteQuery,
    handleOpenInPlayground,
    handleOpenInShell,
}: {
    handleImportFromJson: () => void;
    handleExportEntireCollection: () => void;
    handleExportQueryResults: () => void;
    handleCopyQuery: () => void;
    handlePasteQuery: () => void;
    handleOpenInPlayground: () => void;
    handleOpenInShell: () => void;
}): JSX.Element | null => {
    const { ref, overflowCount, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
    const dataGroupVisible = useIsOverflowGroupVisible('data');

    if (!isOverflowing) {
        return null;
    }

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Tooltip content={l10n.t('{0} more actions', overflowCount)} relationship="label" withArrow>
                    <ToolbarButton
                        ref={ref}
                        icon={<MoreHorizontalRegular />}
                        aria-label={l10n.t('{0} more actions', overflowCount)}
                    >
                        +{overflowCount}
                    </ToolbarButton>
                </Tooltip>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {/* Items in toolbar order — Shell at bottom */}
                    <OverflowMenuItem id="import">
                        <MenuItem icon={<ArrowImportRegular />} onClick={handleImportFromJson}>
                            {l10n.t('Import From JSON…')}
                        </MenuItem>
                    </OverflowMenuItem>
                    <OverflowMenuItem id="export">
                        <>
                            <MenuItem icon={<ArrowExportRegular />} onClick={handleExportEntireCollection}>
                                {l10n.t('Export Entire Collection…')}
                            </MenuItem>
                            <MenuItem icon={<ArrowExportRegular />} onClick={handleExportQueryResults}>
                                {l10n.t('Export Current Query Results…')}
                            </MenuItem>
                        </>
                    </OverflowMenuItem>

                    {/* Divider between data and query groups — only when data group has overflowed items */}
                    {dataGroupVisible !== 'visible' && <MenuDivider />}

                    <OverflowMenuItem id="copy">
                        <MenuItem icon={<CopyRegular />} onClick={handleCopyQuery}>
                            {l10n.t('Copy Query')}
                        </MenuItem>
                    </OverflowMenuItem>
                    <OverflowMenuItem id="paste">
                        <MenuItem icon={<ClipboardPasteRegular />} onClick={handlePasteQuery}>
                            {l10n.t('Paste Query')}
                        </MenuItem>
                    </OverflowMenuItem>
                    <OverflowMenuItem id="playground">
                        <MenuItem icon={<KeyboardRegular />} onClick={handleOpenInPlayground}>
                            {l10n.t('Open in Playground')}
                        </MenuItem>
                    </OverflowMenuItem>
                    <OverflowMenuItem id="shell">
                        <MenuItem icon={<WindowConsoleRegular />} onClick={handleOpenInShell}>
                            {l10n.t('Open in Shell')}
                        </MenuItem>
                    </OverflowMenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
