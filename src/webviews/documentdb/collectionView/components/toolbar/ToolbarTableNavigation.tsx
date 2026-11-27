/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    InfoLabel,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
} from '@fluentui/react-components';
import { ArrowUp16Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, useContext } from 'react';
import { useTrpcClient } from '../../../../_integration/useTrpcClient';
import { CollectionViewContext, Views } from '../../collectionViewContext';

export const ToolbarTableNavigation = (): React.JSX.Element => {
    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const trpcClient = useTrpcClient();

    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);

    function levelUp() {
        const newPath = currentContext.currentViewState?.currentPath.slice(0, -1) ?? [];

        setCurrentContext({
            ...currentContext,
            currentViewState: {
                ...currentContext.currentViewState,
                currentPath: newPath,
            },
        });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'stepIn',
                properties: {
                    source: 'step-out-button',
                },
                measurements: {
                    depth: newPath.length ?? 0,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    function jumpToLevel(level: number) {
        const newPath = currentContext.currentViewState?.currentPath.slice(0, level) ?? [];

        setCurrentContext({
            ...currentContext,
            currentViewState: {
                ...currentContext.currentViewState,
                currentPath: newPath,
            },
        });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'stepIn',
                properties: {
                    source: 'breadcrumb',
                },
                measurements: {
                    depth: newPath.length ?? 0,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    type Item = {
        key: number;
        item: string;
    };

    const items: Item[] = [
        { key: -1, item: l10n.t('Root Level') },
        ...(currentContext.currentViewState?.currentPath.map(
            (label, index): Item => ({
                key: index,
                item: label,
            }),
        ) || []),
    ];

    return (
        <Toolbar aria-label={l10n.t('Table navigation')} size="small">
            <Tooltip content={l10n.t('Level up')} relationship="description" withArrow>
                <ToolbarButton
                    onClick={levelUp}
                    aria-label={l10n.t('Up')}
                    icon={<ArrowUp16Filled />}
                    disabled={
                        currentContext.currentView !== Views.TABLE ||
                        currentContext.currentViewState?.currentPath === undefined ||
                        currentContext.currentViewState?.currentPath.length === 0
                    }
                />
            </Tooltip>

            <ToolbarDivider />

            <Breadcrumb aria-label={l10n.t('Document field path')} size="small">
                {items?.map((item, index) => (
                    <Fragment key={item.key}>
                        <BreadcrumbItem>
                            <BreadcrumbButton onClick={() => jumpToLevel(index)}>{item.item}</BreadcrumbButton>
                        </BreadcrumbItem>
                        {index < items.length - 1 && <BreadcrumbDivider />}
                    </Fragment>
                ))}
            </Breadcrumb>
            <InfoLabel
                info={
                    <>
                        {l10n.t('To step into an object field, focus its cell and press Enter, or double-click the cell.')}
                        <br />
                        {l10n.t(
                            'Use Level Up to return one level, or activate an ancestor breadcrumb to jump to it.',
                        )}
                        <br />
                        {l10n.t('Activate Root Level to return to the document root.')}
                    </>
                }
            />
        </Toolbar>
    );
};
