/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SkeletonItem, Tooltip } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import type * as React from 'react';
import './SummaryCard.scss';

/**
 * Base cell component that provides the layout and placeholder logic.
 * This component is NOT exported - use specialized cell components instead.
 *
 * All cell components extend this to inherit:
 * - Consistent layout
 * - Placeholder handling (loading skeleton vs null value placeholder)
 * - Label/value layout
 * - Column spanning support
 *
 * Placeholder behavior:
 * - When value is undefined: Shows loading skeleton (configurable via loadingPlaceholder)
 * - When value is null: Shows null value placeholder (configurable via nullValuePlaceholder, default: 'N/A')
 */
export interface CellBaseProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The formatted value or custom React node to display
     * - undefined: Data is loading (shows skeleton)
     * - null: Data is unavailable/not applicable (shows nullValuePlaceholder)
     * - string/number/ReactNode: Display the value
     */
    value?: string | number | React.ReactNode;

    /** What to display while data is loading (when value is undefined) */
    loadingPlaceholder?: 'skeleton' | 'empty';

    /** What to display when value is explicitly null (data unavailable) */
    nullValuePlaceholder?: string;

    /** Column spanning: 'single' (1 column) or 'full' (2 columns) */
    span?: 'single' | 'full';

    /** Optional tooltip explanation shown when hovering the label */
    tooltipExplanation?: string;
}

/**
 * Internal base component for summary cells.
 * DO NOT use directly - use GenericCell or create a custom cell component.
 */
export const CellBase: React.FC<CellBaseProps> = ({
    label,
    value,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = 'N/A',
    span = 'single',
    tooltipExplanation,
}) => {
    const renderValue = () => {
        // Explicit null means data is unavailable (e.g., error state, not supported)
        if (value === null) {
            return <span className="nullValue">{nullValuePlaceholder}</span>;
        }

        // Undefined means data is still loading
        if (value === undefined) {
            if (loadingPlaceholder === 'skeleton') {
                return <SkeletonItem size={16} />;
            }
            return null; // empty
        }

        return value;
    };

    const cellClassName = span === 'full' ? 'summaryCell cellSpanFull' : 'summaryCell';

    if (tooltipExplanation) {
        return (
            <Tooltip
                content={{
                    children: (
                        <div style={{ padding: '8px' }}>
                            <div style={{ fontWeight: 600, marginBottom: '12px', fontSize: '16px' }}>{label}</div>
                            <div style={{ whiteSpace: 'pre-line' }}>{tooltipExplanation}</div>
                        </div>
                    ),
                }}
                positioning="above-start"
                relationship="description"
            >
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                <div className={`${cellClassName} cellWithTooltip`} tabIndex={0}>
                    <div className="cellLabel cellLabelWithTooltip">
                        {label}
                        <InfoRegular style={{ fontSize: '12px', opacity: 0.6, marginLeft: '4px' }} />
                    </div>
                    {renderValue()}
                </div>
            </Tooltip>
        );
    }

    return (
        <div className={cellClassName}>
            <div className="cellLabel">{label}</div>
            {renderValue()}
        </div>
    );
};
