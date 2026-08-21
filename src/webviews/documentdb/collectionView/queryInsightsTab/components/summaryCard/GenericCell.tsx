/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetricCard } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

/**
 * A single label-and-value cell inside a {@link SummaryCard}.
 *
 * It is a `MetricCard` at the smaller of its two sizes and without a surface of its own, because
 * the summary card already provides one.
 *
 * ```tsx
 * <GenericCell label={l10n.t('Execution Strategy')} value="COLLSCAN" />
 * <GenericCell label={l10n.t('Index Used')} value={isLoading ? undefined : (data?.indexUsed ?? null)} />
 * ```
 *
 * For a cell that spans the grid and hosts a block of its own, do not reach for this: build the
 * markup where it is used, the way `custom/PerformanceRatingCell.tsx` does.
 */
export interface GenericCellProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The value to display
     * - undefined: Data is loading
     * - null: Data is unavailable
     * - string/number: Value to display
     */
    value?: string | number | null | undefined;

    /** What to display while data is loading (when value is undefined) */
    loadingPlaceholder?: 'skeleton' | 'empty';

    /** What to display when value is explicitly null (data unavailable) */
    nullValuePlaceholder?: string;

    /** Optional tooltip explanation shown when hovering the label */
    tooltipExplanation?: string;
}

export const GenericCell = ({
    label,
    value,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = l10n.t('N/A'),
    tooltipExplanation,
}: GenericCellProps): JSX.Element => (
    // No `ariaLabel`: a cell is named by its visible content, which is what it has always done.
    // The metric cards compose one instead, and increment 4 decides which of the two is right.
    <MetricCard
        label={label}
        value={value}
        description={tooltipExplanation}
        appearance="subtle"
        size="small"
        loadingPlaceholder={loadingPlaceholder}
        nullValuePlaceholder={nullValuePlaceholder}
        tooltipPositioning="above-start"
    />
);
