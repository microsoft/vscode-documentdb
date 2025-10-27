/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SkeletonItem } from '@fluentui/react-components';
import * as React from 'react';
import './SummaryCard.scss';

/**
 * Base cell component that provides the layout and placeholder logic.
 * This component is NOT exported - use specialized cell components instead.
 *
 * All cell components extend this to inherit:
 * - Consistent layout
 * - Placeholder handling (skeleton/empty)
 * - Label/value layout
 * - Column spanning support
 */
export interface CellBaseProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The formatted value or custom React node to display */
    value?: string | number | React.ReactNode;

    /** How to display when value is null/undefined */
    placeholder?: 'skeleton' | 'empty';

    /** Column spanning: 'single' (1 column) or 'full' (2 columns) */
    span?: 'single' | 'full';
}

/**
 * Internal base component for summary cells.
 * DO NOT use directly - use GenericCell or create a custom cell component.
 */
export const CellBase: React.FC<CellBaseProps> = ({ label, value, placeholder = 'skeleton', span = 'single' }) => {
    const renderValue = () => {
        if (value === null || value === undefined) {
            if (placeholder === 'skeleton') {
                return <SkeletonItem size={16} />;
            }
            return null; // empty
        }

        return value;
    };

    const cellClassName = span === 'full' ? 'summaryCell cellSpanFull' : 'summaryCell';

    return (
        <div className={cellClassName}>
            <div className="cellLabel">{label}</div>
            {renderValue()}
        </div>
    );
};
