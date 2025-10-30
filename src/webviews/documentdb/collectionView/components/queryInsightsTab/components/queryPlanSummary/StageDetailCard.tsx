/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Text } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
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
     * Layout variant for testing different designs
     * - v1: Primary metrics in row, additional metrics in 2-col grid
     * - v2: All metrics in single column, inline label: value
     * - v3: All metrics in uniform 2-column grid
     * - v4: Primary metrics in row, additional in 3-col grid
     * - v5: Primary metrics with spacing, additional compact below
     * - v6: All metrics as uniform key/value table
     * - v7: Like v4, but additional metrics in uniform 2-col grid
     * - v8: Like v5, but additional metrics in uniform 2-col grid
     */
    variant?: 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8';

    /**
     * Optional className for styling
     */
    className?: string;
}

const stageColorMap: Record<
    StageType,
    'brand' | 'danger' | 'important' | 'informative' | 'severe' | 'subtle' | 'success' | 'warning'
> = {
    IXSCAN: 'informative',
    FETCH: 'important',
    PROJECTION: 'success',
    SORT: 'warning',
    COLLSCAN: 'danger',
};

/**
 * Stage detail card component for displaying query execution plan stage information.
 * Supports multiple layout variants for optimal readability and space usage.
 * Supports ref forwarding for use with animation libraries.
 */
export const StageDetailCard = forwardRef<HTMLDivElement, StageDetailCardProps>(
    ({ stageType, description, returned, executionTimeMs, metrics, variant = 'v1', className }, ref) => {
        const variantClass = variant !== 'v1' ? ` variant-${variant}` : '';

        // v2 and v5: Single column with inline label: value
        const renderInlineMetric = (label: string, value: string | number) => (
            <div className="stage-detail-card-inline-metric">
                <span className="cellLabel">{label}:</span>
                <Text> {typeof value === 'number' ? value.toLocaleString() : value}</Text>
            </div>
        );

        // v6: Uniform table-like layout
        const renderTableRow = (label: string, value: string | number) => (
            <div className="stage-detail-card-table-row">
                <div className="cellLabel">{label}</div>
                <Text>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
            </div>
        );

        return (
            <Card
                ref={ref}
                appearance="outline"
                className={`stage-detail-card${variantClass}${className ? ` ${className}` : ''}`}
            >
                {/* Header: Badge + Description (all variants) */}
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

                {/* v1: Primary metrics in row, additional in 2-col grid */}
                {variant === 'v1' && (
                    <>
                        {/* Primary metrics row */}
                        {(returned !== undefined || executionTimeMs !== undefined) && (
                            <div className="stage-detail-card-primary-row">
                                {returned !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Returned')}:</span>
                                        <Text> {returned.toLocaleString()}</Text>
                                    </div>
                                )}
                                {executionTimeMs !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Execution Time')}:</span>
                                        <Text> {executionTimeMs.toFixed(2)}ms</Text>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* Additional metrics in 2-col grid */}
                        {metrics && metrics.length > 0 && (
                            <div className="stage-detail-card-grid-2col">
                                {metrics.map((metric, index) => (
                                    <div key={index} className="stage-detail-card-grid-row">
                                        <div className="cellLabel">{metric.label}</div>
                                        <Text>
                                            {typeof metric.value === 'number'
                                                ? metric.value.toLocaleString()
                                                : metric.value}
                                        </Text>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* v2: All metrics in single column, inline label: value */}
                {variant === 'v2' && (
                    <div className="stage-detail-card-single-col">
                        {returned !== undefined && renderInlineMetric(l10n.t('Returned'), returned)}
                        {executionTimeMs !== undefined &&
                            renderInlineMetric(l10n.t('Execution Time'), `${executionTimeMs.toFixed(2)}ms`)}
                        {metrics?.map((metric, index) => (
                            <div key={index}>{renderInlineMetric(metric.label, metric.value)}</div>
                        ))}
                    </div>
                )}

                {/* v3: All metrics in uniform 2-column grid */}
                {variant === 'v3' && (
                    <div className="stage-detail-card-grid-2col">
                        {returned !== undefined && (
                            <div className="stage-detail-card-grid-row">
                                <div className="cellLabel">{l10n.t('Returned')}</div>
                                <Text>{returned.toLocaleString()}</Text>
                            </div>
                        )}
                        {executionTimeMs !== undefined && (
                            <div className="stage-detail-card-grid-row">
                                <div className="cellLabel">{l10n.t('Execution Time')}</div>
                                <Text>{executionTimeMs.toFixed(2)}ms</Text>
                            </div>
                        )}
                        {metrics?.map((metric, index) => (
                            <div key={index} className="stage-detail-card-grid-row">
                                <div className="cellLabel">{metric.label}</div>
                                <Text>
                                    {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
                                </Text>
                            </div>
                        ))}
                    </div>
                )}

                {/* v4: Primary row, additional in 3-col grid */}
                {variant === 'v4' && (
                    <>
                        {(returned !== undefined || executionTimeMs !== undefined) && (
                            <div className="stage-detail-card-primary-row">
                                {returned !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Returned')}:</span>
                                        <Text> {returned.toLocaleString()}</Text>
                                    </div>
                                )}
                                {executionTimeMs !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Execution Time')}:</span>
                                        <Text> {executionTimeMs.toFixed(2)}ms</Text>
                                    </div>
                                )}
                            </div>
                        )}
                        {metrics && metrics.length > 0 && (
                            <div className="stage-detail-card-grid-3col">
                                {metrics.map((metric, index) => (
                                    <div key={index} className="stage-detail-card-grid-item">
                                        <div className="cellLabel">{metric.label}</div>
                                        <Text>
                                            {typeof metric.value === 'number'
                                                ? metric.value.toLocaleString()
                                                : metric.value}
                                        </Text>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* v5: Primary with spacing, additional compact */}
                {variant === 'v5' && (
                    <>
                        {(returned !== undefined || executionTimeMs !== undefined) && (
                            <div className="stage-detail-card-primary-spaced">
                                {returned !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Returned')}:</span>
                                        <Text> {returned.toLocaleString()}</Text>
                                    </div>
                                )}
                                {executionTimeMs !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Execution Time')}:</span>
                                        <Text> {executionTimeMs.toFixed(2)}ms</Text>
                                    </div>
                                )}
                            </div>
                        )}
                        {metrics && metrics.length > 0 && (
                            <div className="stage-detail-card-compact-list">
                                {metrics.map((metric, index) => (
                                    <div key={index}>{renderInlineMetric(metric.label, metric.value)}</div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* v6: All metrics as uniform table */}
                {variant === 'v6' && (
                    <div className="stage-detail-card-table">
                        {returned !== undefined && renderTableRow(l10n.t('Returned'), returned)}
                        {executionTimeMs !== undefined &&
                            renderTableRow(l10n.t('Execution Time'), `${executionTimeMs.toFixed(2)}ms`)}
                        {metrics?.map((metric, index) => (
                            <div key={index}>{renderTableRow(metric.label, metric.value)}</div>
                        ))}
                    </div>
                )}

                {/* v7: Like v4, but additional metrics in uniform 2-col grid */}
                {variant === 'v7' && (
                    <>
                        {(returned !== undefined || executionTimeMs !== undefined) && (
                            <div className="stage-detail-card-primary-row">
                                {returned !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Returned')}:</span>
                                        <Text> {returned.toLocaleString()}</Text>
                                    </div>
                                )}
                                {executionTimeMs !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Execution Time')}:</span>
                                        <Text> {executionTimeMs.toFixed(2)}ms</Text>
                                    </div>
                                )}
                            </div>
                        )}
                        {metrics && metrics.length > 0 && (
                            <div className="stage-detail-card-grid-2col">
                                {metrics.map((metric, index) => (
                                    <div key={index} className="stage-detail-card-grid-row">
                                        <div className="cellLabel">{metric.label}</div>
                                        <Text>
                                            {typeof metric.value === 'number'
                                                ? metric.value.toLocaleString()
                                                : metric.value}
                                        </Text>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* v8: Like v5, but additional metrics in uniform 2-col grid */}
                {variant === 'v8' && (
                    <>
                        {(returned !== undefined || executionTimeMs !== undefined) && (
                            <div className="stage-detail-card-primary-spaced">
                                {returned !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Returned')}:</span>
                                        <Text> {returned.toLocaleString()}</Text>
                                    </div>
                                )}
                                {executionTimeMs !== undefined && (
                                    <div className="stage-detail-card-primary-metric">
                                        <span className="cellLabel">{l10n.t('Execution Time')}:</span>
                                        <Text> {executionTimeMs.toFixed(2)}ms</Text>
                                    </div>
                                )}
                            </div>
                        )}
                        {metrics && metrics.length > 0 && (
                            <div className="stage-detail-card-grid-2col">
                                {metrics.map((metric, index) => (
                                    <div key={index} className="stage-detail-card-grid-row">
                                        <div className="cellLabel">{metric.label}</div>
                                        <Text>
                                            {typeof metric.value === 'number'
                                                ? metric.value.toLocaleString()
                                                : metric.value}
                                        </Text>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </Card>
        );
    },
);

StageDetailCard.displayName = 'StageDetailCard';
