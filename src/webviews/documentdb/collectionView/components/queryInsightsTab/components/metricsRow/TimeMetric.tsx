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
 * Automatically formats time with DataDog/New Relic style:
 * - < 1000ms: "2.33 ms"
 * - 1s - 100s: "15.20 s"
 * - > 100s: "2m 15s"
 *
 * @example
 * <TimeMetric
 *     label={l10n.t('Execution Time')}
 *     valueMs={2.333}
 *     tooltip={l10n.t('Total query execution time')}
 * />
 */
export interface TimeMetricProps extends Omit<MetricBaseProps, 'value'> {
    /** Time value in milliseconds */
    valueMs: number | null | undefined;

    /** Number of decimal places for ms/s display (default: 2) */
    decimals?: number;
}

export const TimeMetric: React.FC<TimeMetricProps> = ({
    label,
    valueMs,
    decimals = 2,
    placeholder = 'skeleton',
    tooltipExplanation,
}) => {
    const formattedValue = valueMs !== null && valueMs !== undefined ? formatTime(valueMs, decimals) : undefined;

    return (
        <MetricBase
            label={label}
            value={formattedValue}
            placeholder={placeholder}
            tooltipExplanation={tooltipExplanation}
        />
    );
};
