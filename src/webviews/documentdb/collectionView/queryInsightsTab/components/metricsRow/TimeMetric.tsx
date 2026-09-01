/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetricCard } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { formatTime } from './formatUtils';
import { composeMetricAriaLabel, type MetricProps } from './metricProps';

/**
 * Time metric, formatted in the Datadog / New Relic style:
 * - under 1000ms: "2.33 ms"
 * - 1s to 100s: "15.20 s"
 * - over 100s: "2m 15s"
 *
 * @example
 * <TimeMetric
 *     label={l10n.t('Execution Time')}
 *     valueMs={2.333}
 *     tooltipExplanation={l10n.t('Total query execution time')}
 * />
 */
export interface TimeMetricProps extends MetricProps {
    /** Time value in milliseconds. `undefined` is loading, `null` is unavailable. */
    valueMs: number | null | undefined;

    /** Number of decimal places for ms/s display (default: 2). */
    decimals?: number;
}

export const TimeMetric = ({
    label,
    valueMs,
    decimals = 2,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = l10n.t('N/A'),
    tooltipExplanation,
}: TimeMetricProps): JSX.Element => {
    // null and undefined have to survive formatting: they select the card's two placeholder states.
    const value = valueMs === null ? null : valueMs === undefined ? undefined : formatTime(valueMs, decimals);

    return (
        <MetricCard
            label={label}
            value={value}
            description={tooltipExplanation}
            loadingPlaceholder={loadingPlaceholder}
            nullValuePlaceholder={nullValuePlaceholder}
            tooltipRepeatsValue
            ariaLabel={composeMetricAriaLabel(label, value, tooltipExplanation)}
        />
    );
};
