/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Label, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tab, TabList, Text } from '@fluentui/react-components';
import { DismissRegular, InfoRegular, LayerRegular, MoreHorizontalRegular } from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import '../queryInsights.scss';
import './QueryPlanSummary.scss';

type Stage = 'IXSCAN' | 'FETCH' | 'PROJECTION';

interface StageDetails {
    stage: Stage;
    indexName?: string;
    keysExamined?: number;
    docsExamined?: number;
    nReturned?: number;
    indexBounds?: string;
}

interface QueryPlanSummaryProps {
    stageState: 1 | 2 | 3;
    selectedTab: Stage | null;
    setSelectedTab: (tab: Stage | null) => void;
    stageDetails: Record<Stage, StageDetails>;
}

export const QueryPlanSummary: React.FC<QueryPlanSummaryProps> = ({
    stageState,
    selectedTab,
    setSelectedTab,
    stageDetails,
}) => {
    return (
        <Card className="planSection">
            <Text size={400} weight="semibold">
                {l10n.t('Query Plan Summary')}
            </Text>

            <div className="queryPlanContent">
                <div className="queryPlanTabs">
                    <TabList
                        selectedValue={selectedTab}
                        onTabSelect={(_, data) => setSelectedTab(data.value as Stage)}
                        vertical
                    >
                        <Tab icon={<LayerRegular />} value="IXSCAN">
                            IXSCAN
                        </Tab>
                        <Tab icon={<LayerRegular />} value="FETCH">
                            FETCH
                        </Tab>
                        <Tab icon={<LayerRegular />} value="PROJECTION">
                            PROJECTION
                        </Tab>
                    </TabList>
                </div>

                <div className="queryPlanDetails">
                    {selectedTab !== null ? (
                        <>
                            <div className="stageHeader">
                                <div className="stageHeaderLeft">
                                    <Text weight="semibold" size={400}>
                                        {l10n.t('Stage Details')}
                                    </Text>
                                    <Badge appearance="tint" shape="rounded">
                                        {selectedTab}
                                    </Badge>
                                </div>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<DismissRegular />}
                                    onClick={() => setSelectedTab(null)}
                                />
                            </div>

                            <CollapseRelaxed visible={stageState >= 2}>
                                <div>
                                    {selectedTab === 'IXSCAN' && (
                                        <>
                                            <div className="detailsGrid">
                                                <div className="detailItem">
                                                    <Label size="small">{l10n.t('Index Name')}</Label>
                                                    <Text>{stageDetails.IXSCAN.indexName}</Text>
                                                </div>
                                                <div className="detailItem">
                                                    <Label size="small">{l10n.t('Keys Examined')}</Label>
                                                    <Text weight="semibold">{stageDetails.IXSCAN.keysExamined}</Text>
                                                </div>
                                                <div className="detailItem">
                                                    <Label size="small">{l10n.t('nReturned')}</Label>
                                                    <Text weight="semibold">{stageDetails.IXSCAN.nReturned}</Text>
                                                </div>
                                            </div>
                                            {stageDetails.IXSCAN.indexBounds && (
                                                <>
                                                    <Label size="small" className="indexBoundsLabel">
                                                        {l10n.t('Index Bounds')}
                                                    </Label>
                                                    <div className="codeBlock">{stageDetails.IXSCAN.indexBounds}</div>
                                                </>
                                            )}
                                        </>
                                    )}
                                    {selectedTab === 'FETCH' && (
                                        <div className="detailsGrid">
                                            <div className="detailItem">
                                                <Label size="small">{l10n.t('Docs Examined')}</Label>
                                                <Text weight="semibold">{stageDetails.FETCH.docsExamined}</Text>
                                            </div>
                                            <div className="detailItem">
                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                <Text weight="semibold">{stageDetails.FETCH.nReturned}</Text>
                                            </div>
                                        </div>
                                    )}
                                    {selectedTab === 'PROJECTION' && (
                                        <div className="detailsGrid">
                                            <div className="detailItem">
                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                <Text weight="semibold">{stageDetails.PROJECTION.nReturned}</Text>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CollapseRelaxed>

                            {stageState < 2 && (
                                <Text size={300}>{l10n.t('Run detailed analysis to see stage metrics')}</Text>
                            )}
                        </>
                    ) : (
                        <div className="queryPlanPlaceholder">
                            <InfoRegular style={{ fontSize: '48px', marginBottom: '12px' }} />
                            <Text size={400} weight="semibold" style={{ marginBottom: '4px' }}>
                                {l10n.t('No Stage Selected')}
                            </Text>
                            <Text size={300}>{l10n.t('Select a stage to view its details')}</Text>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};
