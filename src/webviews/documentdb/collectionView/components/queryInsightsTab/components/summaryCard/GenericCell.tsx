/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { CellBase } from './CellBase';
import './GenericCell.scss';

/**
 * Generic cell for simple string/number values in a SummaryCard.
 *
 * Value handling:
 * - undefined: Shows loading skeleton (data is being fetched)
 * - null: Shows N/A or custom nullValuePlaceholder (data unavailable/error)
 * - string/number: Displays the formatted value
 *
 * Example usage:
 * ```tsx
 * <GenericCell
 *   label={l10n.t('Execution Strategy')}
 *   value="COLLSCAN"
 * />
 *
 * <GenericCell
 *   label={l10n.t('Index Used')}
 *   value={isLoading ? undefined : data?.indexUsed ?? null}
 * />
 *
 * // Custom null placeholder for error states
 * <GenericCell
 *   label={l10n.t('Execution Strategy')}
 *   value={hasError ? null : data?.strategy}
 *   nullValuePlaceholder={l10n.t('Not available')}
 * />
 * ```
 *
 * To create custom cells with special formatting or components:
 * 1. Import CellBase from './CellBase'
 * 2. Format your value or create a custom React node
 * 3. Pass it to CellBase as the value prop
 * 4. Set span='full' if you want the cell to span 2 columns
 *
 * Example of a custom cell:
 * ```tsx
 * export const MyCustomCell: React.FC<Props> = ({ label, data }) => {
 *   const customContent = (
 *     <div style={{ display: 'flex', gap: '8px' }}>
 *       <Icon />
 *       <Text>{formatData(data)}</Text>
 *     </div>
 *   );
 *
 *   return (
 *     <CellBase
 *       label={label}
 *       value={customContent}
 *       span="full"  // Span 2 columns
 *     />
 *   );
 * };
 * ```
 *
 * See custom/PerformanceRatingCell.tsx for a complete example.
 */

export interface GenericCellProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The value to display (will be converted to string)
     * - undefined: Data is loading
     * - null: Data is unavailable
     * - string/number: Value to display
     */
    value?: string | number | null | undefined;

    /** What to display while data is loading (when value is undefined) */
    loadingPlaceholder?: 'skeleton' | 'empty';

    /** What to display when value is explicitly null (data unavailable) */
    nullValuePlaceholder?: string;
}

export const GenericCell: React.FC<GenericCellProps> = ({
    label,
    value,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = 'N/A',
}) => {
    // Preserve null vs undefined distinction
    // - null → passes null to CellBase (shows nullValuePlaceholder)
    // - undefined → passes undefined to CellBase (shows skeleton)
    // - string/number → wraps in span and passes to CellBase
    const displayValue =
        value === null ? null : value !== undefined ? <span className="cellValue">{String(value)}</span> : undefined;

    return (
        <CellBase
            label={label}
            value={displayValue}
            loadingPlaceholder={loadingPlaceholder}
            nullValuePlaceholder={nullValuePlaceholder}
            span="single"
        />
    );
};
