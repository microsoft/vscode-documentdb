/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text } from '@fluentui/react-components';
import * as React from 'react';
import { CellBase } from './CellBase';

/**
 * Generic cell for simple string/number values in a SummaryCard.
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
 *   value={stageState >= 2 ? 'user_id_1' : undefined}
 *   placeholder="skeleton"
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

    /** The value to display (will be converted to string) */
    value?: string | number | null | undefined;

    /** How to display when value is null/undefined */
    placeholder?: 'skeleton' | 'empty';
}

export const GenericCell: React.FC<GenericCellProps> = ({ label, value, placeholder = 'skeleton' }) => {
    // Convert value to React node if it exists
    const displayValue = value !== null && value !== undefined ? <Text>{String(value)}</Text> : undefined;

    return <CellBase label={label} value={displayValue} placeholder={placeholder} span="single" />;
};
