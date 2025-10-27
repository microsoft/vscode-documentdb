/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, SkeletonItem, Tooltip } from '@fluentui/react-components';
import * as React from 'react';
import '../../queryInsights.scss';
import './MetricsRow.scss';

/**
 * Base metric component that provides the card layout and placeholder logic.
 * This component is NOT exported - use specialized metric components instead.
 *
 * All metric components extend this to inherit:
 * - Consistent card styling
 * - Tooltip support
 * - Placeholder handling (skeleton/empty)
 * - Label/value layout
 */
export interface MetricBaseProps {
    /** The label displayed at the top of the metric card */
    label: string;

    /** The formatted value or custom React node to display */
    value?: string | number | React.ReactNode;

    /** How to display when value is null/undefined */
    placeholder?: 'skeleton' | 'empty';

    /** Optional tooltip text shown on hover */
    tooltip?: string;
}

/**
 * Internal base component for metrics.
 * DO NOT use directly - use TimeMetric, CountMetric, GenericMetric, or create a new specialized metric.
 */
export const MetricBase: React.FC<MetricBaseProps> = ({ label, value, placeholder = 'skeleton', tooltip }) => {
    const renderValue = () => {
        if (value === null || value === undefined) {
            if (placeholder === 'skeleton') {
                return <SkeletonItem size={28} />;
            }
            return null; // empty
        }

        return value;
    };

    const content = (
        <Card className="metricCard" appearance="filled">
            <div className="dataHeader">{label}</div>
            <div className="dataValue">{renderValue()}</div>
        </Card>
    );

    if (tooltip) {
        return (
            <Tooltip content={tooltip} relationship="label">
                {content}
            </Tooltip>
        );
    }

    return content;
};
