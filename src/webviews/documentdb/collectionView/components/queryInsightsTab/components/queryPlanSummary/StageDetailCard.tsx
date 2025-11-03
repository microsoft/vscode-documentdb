/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Text } from '@fluentui/react-components';
import { forwardRef } from 'react';
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
     * Optional className for styling
     */
    className?: string;
}

const stageColorMap: Record<
    StageType,
    'brand' | 'danger' | 'important' | 'informative' | 'severe' | 'subtle' | 'success' | 'warning'
> = {
    IXSCAN: 'brand',
    FETCH: 'brand',
    PROJECTION: 'brand',
    SORT: 'brand',
    COLLSCAN: 'brand',
};

/**
 * Stage detail card component for displaying query execution plan stage information.
 * Uses bordered grid cells for primary metrics (Returned + Execution Time).
 * Supports ref forwarding for use with animation libraries.
 */
export const StageDetailCard = forwardRef<HTMLDivElement, StageDetailCardProps>(
    ({ stageType, description, returned, executionTimeMs, metrics, className }, ref) => {
        return (
            <Card ref={ref} appearance="outline" className={`stage-detail-card${className ? ` ${className}` : ''}`}>
                {/* Header: Badge + Description */}
                <div className="stage-detail-card-header">
                    <Badge appearance="tint" shape="rounded" size="small" color={stageColorMap[stageType]}>
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
                        {metrics.map((metric, index) => (
                            <Badge key={index} appearance="outline" size="small" shape="rounded" color="informative">
                                <span className="badge-label">{metric.label}:&nbsp;</span>
                                <span className="badge-value">
                                    {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
                                </span>
                            </Badge>
                        ))}
                    </div>
                )}
            </Card>
        );
    },
);

StageDetailCard.displayName = 'StageDetailCard';
