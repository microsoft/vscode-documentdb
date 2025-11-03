/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { formatCount } from './formatUtils';
import { MetricBase, type MetricBaseProps } from './MetricBase';

/**
 * Specialized metric component for displaying count/integer values.
 *
 * Features:
 * - Automatic thousand grouping: 10000 → "10,000"
 * - Optional compact mode: 1500000 → "1.5M"
 * - Configurable threshold for compact notation
 *
 * @example
 * <CountMetric
 *     label={l10n.t('Documents Returned')}
 *     value={10000}
 *     useGrouping={true}
 * />
 *
 * @example
 * <CountMetric
 *     label={l10n.t('Total Records')}
 *     value={1500000}
 *     compact={true}
 *     compactThreshold={1000000}
 * />
 */
export interface CountMetricProps extends Omit<MetricBaseProps, 'value'> {
    /** The count value */
    value: number | null | undefined;

    /** Enable thousand separators (default: true) */
    useGrouping?: boolean;

    /** Use compact notation for large numbers (1.5M instead of 1,500,000) */
    compact?: boolean;

    /** Threshold for switching to compact notation (default: 1,000,000) */
    compactThreshold?: number;
}

export const CountMetric: React.FC<CountMetricProps> = ({
    label,
    value,
    useGrouping = true,
    compact = false,
    compactThreshold = 1000000,
    placeholder = 'skeleton',
    tooltip,
}) => {
    const formattedValue =
        value !== null && value !== undefined
            ? formatCount(value, { useGrouping, compact, threshold: compactThreshold })
            : undefined;

    return <MetricBase label={label} value={formattedValue} placeholder={placeholder} tooltip={tooltip} />;
};
