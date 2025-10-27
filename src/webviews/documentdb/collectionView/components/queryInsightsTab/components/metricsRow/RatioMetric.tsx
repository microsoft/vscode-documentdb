/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from '@fluentui/react-components';
import * as React from 'react';
import { formatRatio } from './formatUtils';
import { MetricBase, type MetricBaseProps } from './MetricBase';

/**
 * Specialized metric component for displaying ratio/percentage values.
 *
 * Features:
 * - Multiple display formats: percent, decimal, ratio
 * - Optional visual bar chart
 * - Configurable decimal places
 *
 * This component demonstrates how to override the value area with custom React nodes.
 *
 * @example
 * // Simple percentage
 * <RatioMetric
 *     label={l10n.t('Selectivity')}
 *     ratio={0.0002}
 *     format="percent"
 * />
 *
 * @example
 * // With visual bar chart
 * <RatioMetric
 *     label={l10n.t('Cache Hit Rate')}
 *     ratio={0.85}
 *     format="percent"
 *     showBar={true}
 * />
 */
export interface RatioMetricProps extends Omit<MetricBaseProps, 'value'> {
    /** The ratio value (0-1 for percentages) */
    ratio: number | null | undefined;

    /** Display format (default: 'percent') */
    format?: 'percent' | 'decimal' | 'ratio';

    /** Number of decimal places (default: 2) */
    decimals?: number;

    /** Show visual bar chart (default: false) */
    showBar?: boolean;

    /** Bar color (default: brand color) */
    barColor?: string;
}

export const RatioMetric: React.FC<RatioMetricProps> = ({
    label,
    ratio,
    format = 'percent',
    decimals = 2,
    showBar = true,
    barColor = tokens.colorBrandBackground,
    placeholder = 'skeleton',
    tooltip,
}) => {
    if (ratio === null || ratio === undefined) {
        return <MetricBase label={label} value={undefined} placeholder={placeholder} tooltip={tooltip} />;
    }

    const formattedValue = formatRatio(ratio, format, decimals);

    // If showBar is enabled, create custom value area with bar chart
    if (showBar) {
        const percentage = Math.min(100, Math.max(0, ratio * 100));

        const customValueArea = (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '20px', fontWeight: 600 }}>{formattedValue}</div>
                <div
                    style={{
                        width: '100%',
                        height: '4px',
                        backgroundColor: tokens.colorNeutralBackground3,
                        borderRadius: '2px',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            width: `${percentage}%`,
                            height: '100%',
                            backgroundColor: barColor,
                            transition: 'width 0.3s ease',
                        }}
                    />
                </div>
            </div>
        );

        return <MetricBase label={label} value={customValueArea} placeholder={placeholder} tooltip={tooltip} />;
    }

    // Simple text display without bar
    return <MetricBase label={label} value={formattedValue} placeholder={placeholder} tooltip={tooltip} />;
};
