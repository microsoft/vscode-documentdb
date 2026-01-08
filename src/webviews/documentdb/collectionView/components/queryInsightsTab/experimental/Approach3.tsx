/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Approach 3: Hybrid - Tab Stops + Keyboard Shortcut (Ctrl+I)
 * 
 * This approach makes cards/badges focusable with Tab. When focused on an element,
 * users can press Ctrl+I (or ?) to toggle tooltip visibility. Tooltip also shows on Enter/Space.
 * 
 * PROS:
 * 1. Discoverable via ARIA - Screen readers announce "Press Ctrl+I for details"
 * 2. Minimal UI Changes - No additional visual elements
 * 3. Consistent Tab Order - Elements appear in natural tab order
 * 
 * CONS:
 * 1. Hidden Affordance - Keyboard shortcut not visible to sighted users
 * 2. Keyboard Shortcut Conflict - Ctrl+I might conflict with VS Code shortcuts
 * 3. Discoverability Challenge - Non-screen-reader users may not discover feature
 */

import { Badge, Card, Text, Tooltip } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { GenericCell, SummaryCard } from '../components/summaryCard';
import { mockEfficiencyData, mockMetrics, mockPerformanceRating, type MockMetricData } from './mockData';
import './Approach3.scss';

/**
 * Metric card with keyboard shortcut support for Approach 3
 */
interface MetricCardApproach3Props {
    metric: MockMetricData;
    isFocused: boolean;
    onFocus: () => void;
    onBlur: () => void;
}

const MetricCardApproach3: React.FC<MetricCardApproach3Props> = ({ metric, onFocus, onBlur }) => {
    return (
        <Card
            className="metricCard approach3-metricCard"
            appearance="filled"
            tabIndex={0}
            role="button"
            aria-label={`${metric.label}: ${metric.value}. Press Ctrl+I or Enter for more information.`}
            aria-describedby={`tooltip-${metric.label}`}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <div className="dataHeader">{metric.label}</div>
            <div className="dataValue">{metric.value}</div>
        </Card>
    );
};

/**
 * Metrics Row with keyboard shortcut support
 */
const MetricsRowApproach3: React.FC<{
    focusedMetric: string | null;
    tooltipVisible: boolean;
    onMetricFocus: (label: string) => void;
    onMetricBlur: () => void;
}> = ({ focusedMetric, tooltipVisible, onMetricFocus, onMetricBlur }) => {
    return (
        <div className="approach3-section">
            <Text size={400} weight="semibold" className="approach3-sectionTitle">
                {l10n.t('Query Performance Metrics')}
            </Text>
            <div className="approach3-metricsRow">
                {mockMetrics.map((metric) => (
                    <div key={metric.label} className="approach3-metricWrapper">
                        <Tooltip
                            content={{
                                children: (
                                    <div className="approach3-metricTooltip">
                                        <div className="approach3-tooltipHeader">{metric.label}</div>
                                        <div className="approach3-tooltipContent">{metric.tooltipExplanation}</div>
                                    </div>
                                ),
                            }}
                            positioning="below"
                            relationship="description"
                            visible={tooltipVisible && focusedMetric === metric.label}
                        >
                            <MetricCardApproach3
                                metric={metric}
                                isFocused={focusedMetric === metric.label}
                                onFocus={() => onMetricFocus(metric.label)}
                                onBlur={onMetricBlur}
                            />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * Performance Rating with keyboard shortcut support for badges
 */
const PerformanceRatingApproach3: React.FC<{
    focusedBadge: number | null;
    tooltipVisible: boolean;
    onBadgeFocus: (index: number) => void;
    onBadgeBlur: () => void;
}> = ({ focusedBadge, tooltipVisible, onBadgeFocus, onBadgeBlur }) => {
    const { score, diagnostics } = mockPerformanceRating;

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
        <div className="approach3-performanceRating">
            <div className="cellLabel">{l10n.t('Performance Rating')}</div>
            <div className="approach3-efficiencyIndicator">
                <div className="approach3-ratingDot" style={{ backgroundColor: getRatingColor(score) }} />
                <Text weight="semibold">{getRatingText(score)}</Text>
            </div>

            {diagnostics && diagnostics.length > 0 && (
                <div className="approach3-diagnosticBadges">
                    {diagnostics.map((diagnostic, index) => (
                        <Tooltip
                            key={index}
                            content={{
                                children: (
                                    <div className="approach3-badgeTooltip">
                                        <div className="approach3-tooltipHeader">{diagnostic.message}</div>
                                        <div className="approach3-tooltipContent">{diagnostic.details}</div>
                                    </div>
                                ),
                            }}
                            positioning="above-start"
                            relationship="description"
                            visible={tooltipVisible && focusedBadge === index}
                        >
                            <Badge
                                appearance="tint"
                                color={diagnostic.type === 'positive' ? 'success' : 'informative'}
                                size="small"
                                shape="rounded"
                                icon={<InfoRegular />}
                                tabIndex={0}
                                role="button"
                                className="approach3-badge"
                                aria-label={`${diagnostic.message}. Press Ctrl+I or Enter for details.`}
                                onFocus={() => onBadgeFocus(index)}
                                onBlur={onBadgeBlur}
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
 * Main experimental tab for Approach 3
 */
export const QueryInsightsApproach3: React.FC = () => {
    const [focusedMetric, setFocusedMetric] = useState<string | null>(null);
    const [focusedBadge, setFocusedBadge] = useState<number | null>(null);
    const [tooltipVisible, setTooltipVisible] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Toggle tooltip with Ctrl+I or Enter when focused on element
            if ((e.ctrlKey && e.key === 'i') || (e.key === 'Enter' && !e.shiftKey)) {
                if (focusedMetric || focusedBadge !== null) {
                    e.preventDefault();
                    setTooltipVisible(!tooltipVisible);
                }
            }
            // Hide tooltip on Escape
            else if (e.key === 'Escape' && tooltipVisible) {
                setTooltipVisible(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedMetric, focusedBadge, tooltipVisible]);

    // Reset tooltip visibility when focus changes
    useEffect(() => {
        setTooltipVisible(false);
    }, [focusedMetric, focusedBadge]);

    return (
        <div className="approach3-container">
            <div className="approach3-header">
                <Text size={500} weight="semibold">
                    {l10n.t('Approach 3: Hybrid - Tab Stops + Keyboard Shortcut')}
                </Text>
                <Text size={300} className="approach3-description">
                    {l10n.t(
                        'Tab to focus an element, then press Ctrl+I or Enter to toggle tooltip. Press Escape to close. Screen readers announce instructions.',
                    )}
                </Text>
            </div>

            <div className="approach3-content">
                {/* Metrics Row */}
                <MetricsRowApproach3
                    focusedMetric={focusedMetric}
                    tooltipVisible={tooltipVisible}
                    onMetricFocus={setFocusedMetric}
                    onMetricBlur={() => setFocusedMetric(null)}
                />

                {/* Query Efficiency Analysis */}
                <div className="approach3-section">
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
                        <PerformanceRatingApproach3
                            focusedBadge={focusedBadge}
                            tooltipVisible={tooltipVisible}
                            onBadgeFocus={setFocusedBadge}
                            onBadgeBlur={() => setFocusedBadge(null)}
                        />
                    </SummaryCard>
                </div>

                {/* Keyboard shortcuts hint */}
                <div className="approach3-hint">
                    <Text size={300}>
                        {l10n.t('💡 Tip: Use Ctrl+I or Enter to show/hide tooltips when focused on a metric or badge.')}
                    </Text>
                </div>
            </div>
        </div>
    );
};
