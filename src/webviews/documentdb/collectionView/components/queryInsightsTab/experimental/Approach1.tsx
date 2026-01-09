/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Approach 1: Info Buttons with Individual Tab Stops
 * 
 * This approach adds visible info buttons (ⓘ) next to each element that has a tooltip.
 * Each button is keyboard focusable and activates the tooltip on click or keyboard interaction.
 * 
 * PROS:
 * 1. Clear Visual Affordance - Info buttons are universally recognized
 * 2. Explicit Tab Order - Each tooltip has a clear tab stop
 * 3. Standard Pattern - Follows common UI patterns
 * 
 * CONS:
 * 1. Visual Clutter - Adds extra UI elements
 * 2. Tab Order Length - Increases number of tab stops (8+ additional stops)
 * 3. Redundant for Mouse Users - Hover still works
 */

import { Badge, Button, Card, Text, Tooltip } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useState } from 'react';
import { GenericCell, SummaryCard } from '../components/summaryCard';
import { mockEfficiencyData, mockMetrics, mockPerformanceRating, type MockMetricData } from './mockData';
import './Approach1.scss';

/**
 * Metric card with info button for Approach 1
 * Tooltip wraps the entire card (like MetricBase.tsx) for consistent behavior
 */
interface MetricCardApproach1Props {
    metric: MockMetricData;
}

const MetricCardApproach1: React.FC<MetricCardApproach1Props> = ({ metric }) => {
    const [tooltipOpen, setTooltipOpen] = useState(false);

    const cardContent = (
        <Card className="metricCard approach1-metricCard" appearance="filled">
            <div className="approach1-metricHeader">
                <div className="dataHeader">{metric.label}</div>
                {metric.tooltipExplanation && (
                    <Button
                        appearance="transparent"
                        icon={<InfoRegular />}
                        size="small"
                        aria-label={`More information about ${metric.label}`}
                        className="approach1-infoButton"
                        onClick={() => setTooltipOpen(!tooltipOpen)}
                    />
                )}
            </div>
            <div className="dataValue">{metric.value}</div>
        </Card>
    );

    // If tooltip exists, wrap the card with Tooltip (like MetricBase.tsx)
    if (metric.tooltipExplanation) {
        return (
            <Tooltip
                content={{
                    children: (
                        <div className="approach1-metricTooltip">
                            <div className="approach1-tooltipHeader">{metric.label}</div>
                            <div className="approach1-tooltipContent">{metric.tooltipExplanation}</div>
                        </div>
                    ),
                }}
                positioning="below"
                relationship="description"
                visible={tooltipOpen}
                onVisibleChange={(_e, data) => setTooltipOpen(data.visible)}
            >
                {cardContent}
            </Tooltip>
        );
    }

    return cardContent;
};

/**
 * Performance rating with focusable badges for Approach 1
 * Updated to make badges themselves focusable instead of separate info buttons
 */
const PerformanceRatingApproach1: React.FC = () => {
    const { score, diagnostics } = mockPerformanceRating;
    const [openTooltips, setOpenTooltips] = useState<Record<number, boolean>>({});

    const getRatingColor = (rating: typeof score): string => {
        const colors = {
            poor: 'var(--colorPaletteRedBackground3)',
            fair: 'var(--colorPaletteYellowBackground3)',
            good: 'var(--colorPaletteGreenBackground3)',
            excellent: 'var(--colorPaletteLightGreenBackground3)',
        };
        return colors[rating];
    };

    const getRatingText = (rating: typeof score): string => {
        const texts = {
            poor: l10n.t('Poor'),
            fair: l10n.t('Fair'),
            good: l10n.t('Good'),
            excellent: l10n.t('Excellent'),
        };
        return texts[rating];
    };

    return (
        <div className="approach1-performanceRating">
            <div className="cellLabel">{l10n.t('Performance Rating')}</div>
            <div className="approach1-efficiencyIndicator">
                <div className="approach1-ratingDot" style={{ backgroundColor: getRatingColor(score) }} />
                <Text weight="semibold">{getRatingText(score)}</Text>
            </div>

            {diagnostics && diagnostics.length > 0 && (
                <div className="approach1-diagnosticBadges">
                    {diagnostics.map((diagnostic, index) => (
                        <Tooltip
                            key={index}
                            content={{
                                children: (
                                    <div className="approach1-badgeTooltip">
                                        <div className="approach1-tooltipHeader">{diagnostic.message}</div>
                                        <div className="approach1-tooltipContent">{diagnostic.details}</div>
                                    </div>
                                ),
                            }}
                            positioning="above-start"
                            relationship="description"
                            visible={openTooltips[index] ?? false}
                            onVisibleChange={(_e, data) => {
                                setOpenTooltips((prev) => ({ ...prev, [index]: data.visible }));
                            }}
                        >
                            <Badge
                                appearance="tint"
                                color={diagnostic.type === 'positive' ? 'success' : 'informative'}
                                size="small"
                                shape="rounded"
                                icon={<InfoRegular />}
                                tabIndex={0}
                                aria-label={`${diagnostic.message}. Press Enter or Space for details.`}
                                className="approach1-focusableBadge"
                                role="button"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setOpenTooltips((prev) => ({ ...prev, [index]: !prev[index] }));
                                    }
                                }}
                            >
                                {diagnostic.message}
                            </Badge>
                        </Tooltip>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Main experimental tab for Approach 1
 */
export const QueryInsightsApproach1: React.FC = () => {
    return (
        <div className="approach1-container">
            <div className="approach1-header">
                <Text size={500} weight="semibold">
                    {l10n.t('Approach 1: Info Buttons with Individual Tab Stops')}
                </Text>
                <Text size={300} className="approach1-description">
                    {l10n.t(
                        'Metrics have info buttons (ⓘ) that can be focused with Tab. Performance badges are directly focusable - press Enter or Space to show tooltips.',
                    )}
                </Text>
            </div>

            <div className="approach1-content">
                {/* Metrics Row */}
                <div className="approach1-section">
                    <Text size={400} weight="semibold" className="approach1-sectionTitle">
                        {l10n.t('Query Performance Metrics')}
                    </Text>
                    <div className="approach1-metricsRow">
                        {mockMetrics.map((metric) => (
                            <MetricCardApproach1 key={metric.label} metric={metric} />
                        ))}
                    </div>
                </div>

                {/* Query Efficiency Analysis */}
                <div className="approach1-section">
                    <SummaryCard title={l10n.t('Query Efficiency Analysis')}>
                        <GenericCell label={l10n.t('Execution Strategy')} value={mockEfficiencyData.executionStrategy} />
                        <GenericCell label={l10n.t('Index Used')} value={mockEfficiencyData.indexUsed} />
                        <GenericCell
                            label={l10n.t('Examined-to-Returned Ratio')}
                            value={mockEfficiencyData.examinedReturnedRatio}
                        />
                        <GenericCell
                            label={l10n.t('In-Memory Sort')}
                            value={mockEfficiencyData.hasInMemorySort ? l10n.t('Yes') : l10n.t('No')}
                        />
                        <PerformanceRatingApproach1 />
                    </SummaryCard>
                </div>
            </div>
        </div>
    );
};
