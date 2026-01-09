/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Text, Tooltip } from '@fluentui/react-components';
import { WarningRegular } from '@fluentui/react-icons';
import React, { useState } from 'react';
import './StageDetailCard.scss';

export type StageType = 'IXSCAN' | 'FETCH' | 'PROJECTION' | 'SORT' | 'COLLSCAN';

export interface StageMetric {
    label: string;
    value: string | number;
}

export interface StageDetailCardProps {
    /**
     * The type of stage (shown as badge)
     */
    stageType: StageType;

    /**
     * Description text shown next to the badge (e.g., "Index Name: user_id_1", "In-memory sort")
     */
    description?: string;

    /**
     * Number of documents returned
     */
    returned?: number;

    /**
     * Execution time in milliseconds
     */
    executionTimeMs?: number;

    /**
     * Additional key-value pairs for stage-specific metrics
     */
    metrics?: StageMetric[];

    /**
     * Whether this stage has failed
     */
    hasFailed?: boolean;

    /**
     * Optional className for styling
     */
    className?: string;

    /**
     * Ref to forward to the card element
     */
    ref?: React.Ref<HTMLDivElement>;
}

/**
 * Stage detail card component for displaying query execution plan stage information.
 * Uses bordered grid cells for primary metrics (Returned + Execution Time).
 * Supports ref forwarding for use with animation libraries.
 * Badges with tooltips are keyboard accessible.
 */
export function StageDetailCard({
    stageType,
    description,
    returned,
    executionTimeMs,
    metrics,
    hasFailed,
    className,
    ref,
}: StageDetailCardProps) {
    // Use danger color for failed stages, otherwise use brand color
    const badgeColor = hasFailed ? 'danger' : 'brand';

    // Track tooltip visibility for each badge with truncated content
    const [openTooltips, setOpenTooltips] = useState<Record<number, boolean>>({});

    return (
        <Card ref={ref} appearance="outline" className={`stage-detail-card${className ? ` ${className}` : ''}`}>
            {/* Header: Badge + Description */}
            <div className="stage-detail-card-header">
                <Badge
                    appearance="tint"
                    shape="rounded"
                    size="small"
                    color={badgeColor}
                    icon={hasFailed ? <WarningRegular /> : undefined}
                >
                    {stageType}
                </Badge>
                {description && (
                    <Text size={200} className="stage-detail-card-description">
                        {description}
                    </Text>
                )}
            </div>

            {/* Primary metrics: Bordered grid cells */}
            {(returned !== undefined || executionTimeMs !== undefined) && (
                <div className="primary-metrics-bordered-grid">
                    {returned !== undefined && (
                        <div className="primary-metric-grid-cell">
                            <div className="cellLabel">Returned</div>
                            <Text className="cellValue">{returned.toLocaleString()}</Text>
                        </div>
                    )}
                    {executionTimeMs !== undefined && (
                        <div className="primary-metric-grid-cell">
                            <div className="cellLabel">Execution Time</div>
                            <Text className="cellValue">{executionTimeMs.toFixed(2)}ms</Text>
                        </div>
                    )}
                </div>
            )}

            {/* Optional metrics: Gray badges */}
            {metrics && metrics.length > 0 && (
                <div className="metrics-inline-badges">
                    {metrics.map((metric, index) => {
                        const valueStr =
                            typeof metric.value === 'number' ? metric.value.toLocaleString() : String(metric.value);

                        // Truncate long values (over 50 characters)
                        const maxLength = 50;
                        const isTruncated = valueStr.length > maxLength;
                        const displayValue = isTruncated ? valueStr.substring(0, maxLength) + '...' : valueStr;

                        const badgeContent = (
                            <Badge
                                key={index}
                                appearance="outline"
                                size="small"
                                shape="rounded"
                                color="informative"
                                tabIndex={isTruncated ? 0 : undefined}
                                className={isTruncated ? 'focusableBadge' : undefined}
                                role={isTruncated ? 'button' : undefined}
                                aria-label={
                                    isTruncated
                                        ? `${metric.label}: ${displayValue}. Press Enter or Space for full value.`
                                        : undefined
                                }
                                onKeyDown={
                                    isTruncated
                                        ? (e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                  e.preventDefault();
                                                  setOpenTooltips((prev) => ({ ...prev, [index]: !prev[index] }));
                                              }
                                          }
                                        : undefined
                                }
                            >
                                <span className="badge-label">{metric.label}:&nbsp;</span>
                                <span className="badge-value">{displayValue}</span>
                            </Badge>
                        );

                        // Wrap in tooltip if truncated
                        return isTruncated ? (
                            <Tooltip
                                key={index}
                                content={valueStr}
                                relationship="label"
                                visible={openTooltips[index] ?? false}
                                onVisibleChange={(_e, data) => {
                                    setOpenTooltips((prev) => ({ ...prev, [index]: data.visible }));
                                }}
                            >
                                {badgeContent}
                            </Tooltip>
                        ) : (
                            badgeContent
                        );
                    })}
                </div>
            )}
        </Card>
    );
}
