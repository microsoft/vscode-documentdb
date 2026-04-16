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
    Overflow,
    OverflowItem,
    Toolbar,
    ToolbarButton,
    ToolbarToggleButton,
    Tooltip,
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
 * Secondary toolbar actions (Import, Export, Copy, Paste, Playground, Shell)
 * wrapped in an Overflow container. When the toolbar is too narrow, items
 * collapse into a "..." overflow menu from right to left by priority.
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

    // ─── Action definitions (id, label, icon, handler) ─────────────────────────
    // Priority: lower number = overflows first (least important first)

    const actions: Array<{
        id: string;
        priority: number;
        label: string;
        icon: JSX.Element;
        tooltip: string;
        onClick: () => void;
        iconOnly?: boolean;
        menuItems?: Array<{ label: string; onClick: () => void }>;
    }> = [
        {
            id: 'import',
            priority: 1,
            label: l10n.t('Import'),
            icon: <ArrowImportRegular />,
            tooltip: l10n.t('Import documents'),
            onClick: handleImportFromJson,
            menuItems: [{ label: l10n.t('Import From JSON…'), onClick: handleImportFromJson }],
        },
        {
            id: 'export',
            priority: 2,
            label: l10n.t('Export'),
            icon: <ArrowExportRegular />,
            tooltip: l10n.t('Export documents'),
            onClick: handleExportEntireCollection,
            menuItems: [
                { label: l10n.t('Export Entire Collection…'), onClick: handleExportEntireCollection },
                { label: l10n.t('Export Current Query Results…'), onClick: handleExportQueryResults },
            ],
        },
        {
            id: 'copy',
            priority: 3,
            label: l10n.t('Copy Query'),
            icon: <CopyRegular />,
            tooltip: l10n.t('Copy current query to clipboard'),
            onClick: handleCopyQuery,
            iconOnly: true,
        },
        {
            id: 'paste',
            priority: 4,
            label: l10n.t('Paste Query'),
            icon: <ClipboardPasteRegular />,
            tooltip: l10n.t('Paste a find query from clipboard into the editors'),
            onClick: handlePasteQuery,
            iconOnly: true,
        },
        {
            id: 'playground',
            priority: 5,
            label: l10n.t('Playground'),
            icon: <KeyboardRegular />,
            tooltip: l10n.t('Open current query in a Query Playground'),
            onClick: handleOpenInPlayground,
        },
        {
            id: 'shell',
            priority: 6,
            label: l10n.t('Shell'),
            icon: <WindowConsoleRegular />,
            tooltip: l10n.t('Open current query in an Interactive Shell'),
            onClick: handleOpenInShell,
        },
    ];

    return (
        <Overflow padding={40} overflowDirection="start">
            <Toolbar size="small">
                {actions.map((action) => (
                    <OverflowItem key={action.id} id={action.id} priority={action.priority}>
                        {action.menuItems ? (
                            <Menu>
                                <MenuTrigger>
                                    <Tooltip content={action.tooltip} relationship="description" withArrow>
                                        <ToolbarButton icon={action.icon}>{action.label}</ToolbarButton>
                                    </Tooltip>
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        {action.menuItems.map((item) => (
                                            <MenuItem key={item.label} onClick={item.onClick}>
                                                {item.label}
                                            </MenuItem>
                                        ))}
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        ) : (
                            <Tooltip content={action.tooltip} relationship="description" withArrow>
                                <ToolbarButton aria-label={action.label} icon={action.icon} onClick={action.onClick}>
                                    {action.iconOnly ? undefined : action.label}
                                </ToolbarButton>
                            </Tooltip>
                        )}
                    </OverflowItem>
                ))}
                <OverflowMenu actions={actions} />
            </Toolbar>
        </Overflow>
    );
};

/**
 * An overflow item that is only visible in the menu when it has overflowed.
 */
const OverflowMenuItem = ({
    id,
    label,
    icon,
    onClick,
    menuItems,
}: {
    id: string;
    label: string;
    icon: JSX.Element;
    onClick: () => void;
    menuItems?: Array<{ label: string; onClick: () => void }>;
}): JSX.Element | null => {
    const isVisible = useIsOverflowItemVisible(id);
    if (isVisible) {
        return null;
    }

    if (menuItems && menuItems.length > 1) {
        return (
            <>
                {menuItems.map((item) => (
                    <MenuItem key={item.label} icon={icon} onClick={item.onClick}>
                        {item.label}
                    </MenuItem>
                ))}
            </>
        );
    }

    return (
        <MenuItem icon={icon} onClick={onClick}>
            {label}
        </MenuItem>
    );
};

/**
 * The "..." overflow menu button. Only renders when items have overflowed.
 */
const OverflowMenu = ({
    actions,
}: {
    actions: Array<{
        id: string;
        label: string;
        icon: JSX.Element;
        onClick: () => void;
        menuItems?: Array<{ label: string; onClick: () => void }>;
    }>;
}): JSX.Element | null => {
    const { ref, overflowCount, isOverflowing } = useOverflowMenu<HTMLButtonElement>();

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
                    />
                </Tooltip>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {actions.map((action) => (
                        <OverflowMenuItem
                            key={action.id}
                            id={action.id}
                            label={action.label}
                            icon={action.icon}
                            onClick={action.onClick}
                            menuItems={action.menuItems}
                        />
                    ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
