/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from '@fluentui/react-components';
import { MetricCard } from '@microsoft/vscode-ext-webview-fluentui/components';
import { type JSX } from 'react';
import { formatRatio } from './formatUtils';
import { composeMetricAriaLabel, type MetricProps } from './metricProps';

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
export interface RatioMetricProps extends MetricProps {
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

export const RatioMetric = ({
    label,
    ratio,
    format = 'percent',
    decimals = 2,
    showBar = true,
    barColor = tokens.colorBrandBackground,
    loadingPlaceholder = 'skeleton',
    tooltipExplanation,
}: RatioMetricProps): JSX.Element => {
    if (ratio === null || ratio === undefined) {
        // Unlike the other metrics, an unavailable ratio shows the loading placeholder rather than
        // the unavailable one. Preserved as it was found; changing it is a product decision.
        return (
            <MetricCard
                label={label}
                value={undefined}
                description={tooltipExplanation}
                loadingPlaceholder={loadingPlaceholder}
                tooltipRepeatsValue
                ariaLabel={composeMetricAriaLabel(label, undefined, tooltipExplanation)}
            />
        );
    }

    const formattedValue = formatRatio(ratio, format, decimals);

    // A bar under the number is what the card's `value` node is for.
    const value = showBar ? (
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
                        width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
                        height: '100%',
                        backgroundColor: barColor,
                        transition: 'width 0.3s ease',
                    }}
                />
            </div>
        </div>
    ) : (
        formattedValue
    );

    return (
        <MetricCard
            label={label}
            value={value}
            description={tooltipExplanation}
            loadingPlaceholder={loadingPlaceholder}
            tooltipRepeatsValue
            // The node form has no text for the name, which is what the un-migrated card did too.
            ariaLabel={composeMetricAriaLabel(label, showBar ? undefined : formattedValue, tooltipExplanation)}
        />
    );
};
