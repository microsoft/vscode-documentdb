/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Approach 2: Section-Based Navigation with Arrow Keys
 * 
 * This approach makes entire cards/sections keyboard focusable using Tab.
 * Within a section, users can navigate between sub-elements using Arrow keys.
 * Tooltips are displayed in an ARIA live region when focus moves to an element.
 * 
 * PROS:
 * 1. Fewer Tab Stops - Only one tab stop per section (4 stops instead of 12+)
 * 2. Natural Grouping - Reflects semantic structure
 * 3. Efficient Navigation - Arrow keys provide quick access within sections
 * 
 * CONS:
 * 1. Non-Standard Pattern - Arrow key navigation in cards is uncommon
 * 2. Learning Curve - Users need to discover this pattern
 * 3. Discoverability Issues - No visual indication of arrow key support
 */

import { Badge, Card, Text } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { GenericCell, SummaryCard } from '../components/summaryCard';
import { mockEfficiencyData, mockMetrics, mockPerformanceRating, type MockMetricData } from './mockData';
import './Approach2.scss';

/**
 * Metrics Row with arrow key navigation for Approach 2
 */
const MetricsRowApproach2: React.FC = () => {
    const [activeMetricIndex, setActiveMetricIndex] = useState<number>(0);
    const [isFocused, setIsFocused] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveMetricIndex((prev) => Math.min(prev + 1, mockMetrics.length - 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveMetricIndex((prev) => Math.max(prev - 1, 0));
        }
    };

    const activeMetric = mockMetrics[activeMetricIndex];

    return (
        <div className="approach2-section">
            <Text size={400} weight="semibold" className="approach2-sectionTitle">
                {l10n.t('Query Performance Metrics')}
            </Text>
            <div
                ref={containerRef}
                className="approach2-metricsRow"
                role="group"
                aria-label={l10n.t('Query Performance Metrics. Use arrow keys to navigate between metrics.')}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
            >
                {mockMetrics.map((metric, index) => (
                    <Card
                        key={metric.label}
                        className={`metricCard approach2-metricCard ${
                            isFocused && index === activeMetricIndex ? 'approach2-active' : ''
                        }`}
                        appearance="filled"
                        aria-label={`${metric.label}: ${metric.value}`}
                        role="presentation"
                    >
                        <div className="dataHeader">{metric.label}</div>
                        <div className="dataValue">{metric.value}</div>
                    </Card>
                ))}

                {/* ARIA live region for tooltip content */}
                {isFocused && (
                    <div
                        className="approach2-liveRegion"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        <div className="approach2-tooltipContent">
                            <strong>{activeMetric.label}:</strong> {activeMetric.tooltipExplanation}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Performance Rating with arrow key navigation for badges
 */
const PerformanceRatingApproach2: React.FC = () => {
    const { score, diagnostics } = mockPerformanceRating;
    const [activeBadgeIndex, setActiveBadgeIndex] = useState<number>(0);
    const [isFocused, setIsFocused] = useState(false);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!diagnostics || diagnostics.length === 0) return;

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveBadgeIndex((prev) => Math.min(prev + 1, diagnostics.length - 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveBadgeIndex((prev) => Math.max(prev - 1, 0));
        }
    };

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

    const activeDiagnostic = diagnostics[activeBadgeIndex];

    return (
        <div className="approach2-performanceRating">
            <div className="cellLabel">{l10n.t('Performance Rating')}</div>
            <div className="approach2-efficiencyIndicator">
                <div className="approach2-ratingDot" style={{ backgroundColor: getRatingColor(score) }} />
                <Text weight="semibold">{getRatingText(score)}</Text>
            </div>

            {diagnostics && diagnostics.length > 0 && (
                <div
                    className="approach2-diagnosticBadgesContainer"
                    role="group"
                    aria-label={l10n.t('Performance diagnostics. Use arrow keys to navigate.')}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                >
                    <div className="approach2-diagnosticBadges">
                        {diagnostics.map((diagnostic, index) => (
                            <Badge
                                key={index}
                                appearance="tint"
                                color={diagnostic.type === 'positive' ? 'success' : 'informative'}
                                size="small"
                                shape="rounded"
                                icon={<InfoRegular />}
                                className={isFocused && index === activeBadgeIndex ? 'approach2-activeBadge' : ''}
                            >
                                {diagnostic.message}
                            </Badge>
                        ))}
                    </div>

                    {/* ARIA live region for active badge details */}
                    {isFocused && (
                        <div
                            className="approach2-badgeLiveRegion"
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            <div className="approach2-badgeTooltipContent">
                                <strong>{activeDiagnostic.message}:</strong> {activeDiagnostic.details}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Main experimental tab for Approach 2
 */
export const QueryInsightsApproach2: React.FC = () => {
    return (
        <div className="approach2-container">
            <div className="approach2-header">
                <Text size={500} weight="semibold">
                    {l10n.t('Approach 2: Section-Based Navigation with Arrow Keys')}
                </Text>
                <Text size={300} className="approach2-description">
                    {l10n.t(
                        'Tab to focus a section, then use Arrow keys (←/→ or ↑/↓) to navigate between items. Tooltip information is announced via screen reader.',
                    )}
                </Text>
            </div>

            <div className="approach2-content">
                {/* Metrics Row */}
                <MetricsRowApproach2 />

                {/* Query Efficiency Analysis */}
                <div className="approach2-section">
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
                        <PerformanceRatingApproach2 />
                    </SummaryCard>
                </div>
            </div>
        </div>
    );
};
