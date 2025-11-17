/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { formatTime } from './formatUtils';
import { MetricBase, type MetricBaseProps } from './MetricBase';

/**
 * Specialized metric component for displaying time values.
 *
 * Automatically formats time with Datadog/New Relic style:
 * - < 1000ms: "2.33 ms"
 * - 1s - 100s: "15.20 s"
 * - > 100s: "2m 15s"
 *
 * Value handling:
 * - undefined: Shows loading skeleton (data is being fetched)
 * - null: Shows N/A or custom nullValuePlaceholder (data unavailable/error)
 * - number: Formats and displays the time
 *
 * @example
 * <TimeMetric
 *     label={l10n.t('Execution Time')}
 *     valueMs={2.333}
 *     tooltipExplanation={l10n.t('Total query execution time')}
 * />
 *
 * @example
 * // Show N/A when data is unavailable (e.g., error state)
 * <TimeMetric
 *     label={l10n.t('Execution Time')}
 *     valueMs={null}
 *     nullValuePlaceholder={l10n.t('Not available')}
 * />
 */
export interface TimeMetricProps extends Omit<MetricBaseProps, 'value'> {
    /** Time value in milliseconds
     * - undefined: Data is loading
     * - null: Data is unavailable
     * - number: Time value to format and display
     */
    valueMs: number | null | undefined;

    /** Number of decimal places for ms/s display (default: 2) */
    decimals?: number;
}

export const TimeMetric: React.FC<TimeMetricProps> = ({
    label,
    valueMs,
    decimals = 2,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = 'N/A',
    tooltipExplanation,
}) => {
    // Preserve null vs undefined distinction
    // - null → passes null to MetricBase (shows nullValuePlaceholder)
    // - undefined → passes undefined to MetricBase (shows skeleton)
    // - number → formats and passes string to MetricBase
    const formattedValue = valueMs === null ? null : valueMs !== undefined ? formatTime(valueMs, decimals) : undefined;

    return (
        <MetricBase
            label={label}
            value={formattedValue}
            loadingPlaceholder={loadingPlaceholder}
            nullValuePlaceholder={nullValuePlaceholder}
            tooltipExplanation={tooltipExplanation}
        />
    );
};
