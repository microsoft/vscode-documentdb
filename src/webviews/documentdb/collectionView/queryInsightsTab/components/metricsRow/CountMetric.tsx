/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetricCard } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { formatCount } from './formatUtils';
import { composeMetricAriaLabel, type MetricProps } from './metricProps';

/**
 * Specialized metric component for displaying count/integer values.
 *
 * Features:
 * - Automatic digit grouping (thousands separator, locale-aware): 10000 → "10,000"
 * - Optional compact mode: 1500000 → "1.5M"
 * - Configurable threshold for compact notation
 *
 * Value handling:
 * - undefined: Shows loading skeleton (data is being fetched)
 * - null: Shows N/A or custom nullValuePlaceholder (data unavailable/error)
 * - number: Formats and displays the count
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
 *
 * @example
 * // Show N/A when data is unavailable (e.g., error state)
 * <CountMetric
 *     label={l10n.t('Documents Returned')}
 *     value={null}
 *     nullValuePlaceholder={l10n.t('Not available')}
 * />
 */
export interface CountMetricProps extends MetricProps {
    /** The count value
     * - undefined: Data is loading
     * - null: Data is unavailable
     * - number: Count value to format and display
     */
    value: number | null | undefined;

    /** Enable thousand separators (default: true) */
    useGrouping?: boolean;

    /** Use compact notation for large numbers (1.5M instead of 1,500,000) */
    compact?: boolean;

    /** Threshold for switching to compact notation (default: 1,000,000) */
    compactThreshold?: number;
}

export const CountMetric = ({
    label,
    value,
    useGrouping = true,
    compact = false,
    compactThreshold = 1000000,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = l10n.t('N/A'),
    tooltipExplanation,
}: CountMetricProps): JSX.Element => {
    // null and undefined have to survive formatting: they select the card's two placeholder states.
    const formatted =
        value === null
            ? null
            : value === undefined
              ? undefined
              : formatCount(value, { useGrouping, compact, threshold: compactThreshold });

    return (
        <MetricCard
            label={label}
            value={formatted}
            description={tooltipExplanation}
            loadingPlaceholder={loadingPlaceholder}
            nullValuePlaceholder={nullValuePlaceholder}
            tooltipRepeatsValue
            ariaLabel={composeMetricAriaLabel(label, formatted, tooltipExplanation)}
        />
    );
};
