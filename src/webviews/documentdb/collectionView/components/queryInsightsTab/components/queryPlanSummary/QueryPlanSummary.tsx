/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Card,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowUpFilled, EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useTrpcClient } from '../../../../../../api/webview-client/useTrpcClient';
import {
    type QueryInsightsStage1Response,
    type QueryInsightsStage2Response,
} from '../../../../../../documentdb/collectionView/types/queryInsights';
import '../../queryInsights.scss';
import './QueryPlanSummary.scss';
import { StageDetailCard, type StageType } from './StageDetailCard';

interface QueryPlanSummaryProps {
    stage1Data: QueryInsightsStage1Response | null;
    stage2Data: QueryInsightsStage2Response | null;
    stage1Loading: boolean;
    stage2Loading: boolean;
}

export const QueryPlanSummary: React.FC<QueryPlanSummaryProps> = ({
    stage1Data,
    stage2Data,
    stage1Loading,
    stage2Loading,
}) => {
    const { trpcClient } = useTrpcClient();

    const handleViewRawExplain = async () => {
        try {
            await trpcClient.mongoClusters.collectionView.viewRawExplainOutput.mutate();
        } catch (error) {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to open raw execution stats'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        }
    };

    return (
        <Card className="planSection">
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}
            >
                <Text size={400} weight="semibold">
                    {l10n.t('Query Plan Summary')}
                </Text>
                {stage2Data && (
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<EyeRegular />}
                        onClick={() => void handleViewRawExplain()}
                    >
                        {l10n.t('View Raw Execution Stats')}
                    </Button>
                )}
            </div>

            {/* Show skeleton if Stage 1 is loading or no data yet */}
            {(stage1Loading || (!stage1Data && !stage2Data)) && (
                <Skeleton>
                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                    <SkeletonItem size={16} style={{ width: '60%' }} />
                </Skeleton>
            )}

            {/* Show real data when Stage 1 is available */}
            {stage1Data && !stage1Loading && (
                <>
                    {/* Sharded query view */}
                    {stage1Data.isSharded && stage1Data.shards && stage1Data.shards.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* Lightweight merge info */}
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3, paddingLeft: '4px' }}>
                                {stage2Data && !stage2Loading
                                    ? l10n.t(
                                          'SHARD_MERGE · {0} shards · {1} docs · {2}ms',
                                          stage1Data.shards.length,
                                          stage2Data.documentsReturned,
                                          stage2Data.executionTimeMs.toFixed(0),
                                      )
                                    : l10n.t(
                                          'SHARD_MERGE · {0} shards · {1}ms',
                                          stage1Data.shards.length,
                                          stage1Data.executionTime.toFixed(0),
                                      )}
                            </Text>

                            {stage1Data.shards.map((shard) => {
                                // Find matching shard data from stage2 if available
                                const shard2Data = stage2Data?.shards?.find((s) => s.shardName === shard.shardName);

                                return (
                                    <div
                                        key={shard.shardName}
                                        style={{
                                            backgroundColor: tokens.colorNeutralBackground1,
                                            borderRadius: '6px',
                                            borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
                                            // disabled for now as we need to add more ux around performance hints
                                            // borderLeft: `3px solid ${
                                            //     shard.hasCollscan || shard.hasBlockedSort
                                            //         ? tokens.colorStatusWarningBorder1
                                            //         : tokens.colorStatusSuccessBorder1
                                            // }`,
                                        }}
                                    >
                                        {/* Shard Summary (always visible) */}
                                        <div style={{ padding: '12px' }}>
                                            <Text
                                                weight="semibold"
                                                size={300}
                                                style={{ display: 'block', marginBottom: '8px' }}
                                            >
                                                {l10n.t('Shard: {0}', shard.shardName)}
                                            </Text>
                                            {/* Stage flow with badges */}
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    marginBottom: '8px',
                                                }}
                                            >
                                                {[...shard.stages].reverse().map((stage, index) => (
                                                    <React.Fragment key={index}>
                                                        {index > 0 && <Text size={200}>→</Text>}
                                                        <Badge appearance="tint" size="small" shape="rounded">
                                                            {stage.stage}
                                                        </Badge>
                                                    </React.Fragment>
                                                ))}
                                            </div>

                                            {/* Metrics */}
                                            {stage2Loading && (
                                                <Skeleton>
                                                    <SkeletonItem size={12} style={{ width: '80%' }} />
                                                </Skeleton>
                                            )}
                                            {shard2Data && !stage2Loading && (
                                                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                    {shard2Data.nReturned || 0} returned ·{' '}
                                                    {(shard2Data.keysExamined || 0).toLocaleString()} keys ·{' '}
                                                    {(shard2Data.docsExamined || 0).toLocaleString()} docs ·{' '}
                                                    {shard2Data.executionTimeMs || 0}ms
                                                </Text>
                                            )}
                                        </div>

                                        {/* Expandable Stage Details - only show when Stage 2 data is available */}
                                        {shard2Data && !stage2Loading && (
                                            <Accordion collapsible>
                                                <AccordionItem value="1">
                                                    <AccordionHeader size="small">
                                                        {l10n.t('Show Stage Details')}
                                                    </AccordionHeader>
                                                    <AccordionPanel>
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '8px',
                                                                padding: '8px',
                                                            }}
                                                        >
                                                            {shard2Data.stages.map((stage, index) => {
                                                                const metrics: Array<{
                                                                    label: string;
                                                                    value: string | number;
                                                                }> = [];

                                                                if (stage.keysExamined !== undefined) {
                                                                    metrics.push({
                                                                        label: l10n.t('Keys Examined'),
                                                                        value: stage.keysExamined.toLocaleString(),
                                                                    });
                                                                }
                                                                if (stage.docsExamined !== undefined) {
                                                                    metrics.push({
                                                                        label: l10n.t('Docs Examined'),
                                                                        value: stage.docsExamined.toLocaleString(),
                                                                    });
                                                                }

                                                                return (
                                                                    <React.Fragment key={index}>
                                                                        {index > 0 && (
                                                                            <div className="stage-separator">
                                                                                <ArrowUpFilled fontSize={20} />
                                                                            </div>
                                                                        )}
                                                                        <StageDetailCard
                                                                            stageType={stage.stage as StageType}
                                                                            description={
                                                                                stage.indexName
                                                                                    ? `Index: ${stage.indexName}`
                                                                                    : undefined
                                                                            }
                                                                            returned={stage.nReturned}
                                                                            executionTimeMs={stage.executionTimeMs}
                                                                            metrics={
                                                                                metrics.length > 0 ? metrics : undefined
                                                                            }
                                                                        />
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                        </div>
                                                    </AccordionPanel>
                                                </AccordionItem>
                                            </Accordion>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        /* Non-sharded query view */
                        <div
                            style={{
                                backgroundColor: tokens.colorNeutralBackground1,
                                borderRadius: '6px',
                                borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
                            }}
                        >
                            {/* Summary (always visible from Stage 1) */}
                            <div style={{ padding: '12px' }}>
                                <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '8px' }}>
                                    {l10n.t('Query Execution Plan')}
                                </Text>
                                {/* Stage flow with badges */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                    {[...stage1Data.stages].reverse().map((stage, index) => (
                                        <React.Fragment key={index}>
                                            {index > 0 && <Text size={200}>→</Text>}
                                            <Badge appearance="tint" size="small" shape="rounded">
                                                {stage.stage}
                                            </Badge>
                                        </React.Fragment>
                                    ))}
                                </div>{' '}
                                {/* Metrics - Stage 2 data shows detailed counts, otherwise show skeleton or basic info */}
                                {stage2Loading && (
                                    <Skeleton>
                                        <SkeletonItem size={12} style={{ width: '80%' }} />
                                    </Skeleton>
                                )}
                                {stage2Data && !stage2Loading && (
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                        {stage2Data.documentsReturned} returned ·{' '}
                                        {stage2Data.totalKeysExamined.toLocaleString()} keys ·{' '}
                                        {stage2Data.totalDocsExamined.toLocaleString()} docs ·{' '}
                                        {stage2Data.executionTimeMs.toFixed(2)}ms
                                    </Text>
                                )}
                                {!stage2Data && !stage2Loading && (
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                        {l10n.t('Execution time: {0}ms', stage1Data.executionTime.toFixed(2))}
                                    </Text>
                                )}
                            </div>

                            {/* Expandable Stage Details - only show when Stage 2 data is available */}
                            {stage2Data && !stage2Loading && (
                                <Accordion collapsible>
                                    <AccordionItem value="1">
                                        <AccordionHeader size="small">{l10n.t('Show Stage Details')}</AccordionHeader>
                                        <AccordionPanel>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px',
                                                    padding: '8px',
                                                }}
                                            >
                                                {stage2Data.stages.map((stage, index) => {
                                                    const metrics: Array<{ label: string; value: string | number }> =
                                                        [];

                                                    if (stage.keysExamined !== undefined) {
                                                        metrics.push({
                                                            label: l10n.t('Keys Examined'),
                                                            value: stage.keysExamined.toLocaleString(),
                                                        });
                                                    }
                                                    if (stage.docsExamined !== undefined) {
                                                        metrics.push({
                                                            label: l10n.t('Docs Examined'),
                                                            value: stage.docsExamined.toLocaleString(),
                                                        });
                                                    }

                                                    return (
                                                        <React.Fragment key={index}>
                                                            {index > 0 && (
                                                                <div className="stage-separator">
                                                                    <ArrowUpFilled fontSize={20} />
                                                                </div>
                                                            )}
                                                            <StageDetailCard
                                                                stageType={stage.stage as StageType}
                                                                description={
                                                                    stage.indexName
                                                                        ? `Index: ${stage.indexName}`
                                                                        : undefined
                                                                }
                                                                returned={stage.nReturned}
                                                                executionTimeMs={stage.executionTimeMs}
                                                                metrics={metrics.length > 0 ? metrics : undefined}
                                                            />
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                        </AccordionPanel>
                                    </AccordionItem>
                                </Accordion>
                            )}
                        </div>
                    )}
                </>
            )}
        </Card>
    );
};
