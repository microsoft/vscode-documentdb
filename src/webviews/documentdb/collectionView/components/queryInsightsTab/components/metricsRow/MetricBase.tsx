/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, SkeletonItem, Tooltip } from '@fluentui/react-components';
import { DataUsageRegular, InfoRegular } from '@fluentui/react-icons';
import * as React from 'react';
import { useRef } from 'react';
import './MetricsRow.scss';

/**
 * Base metric component that provides the card layout and placeholder logic.
 * This component is NOT exported - use specialized metric components instead.
 *
 * All metric components extend this to inherit:
 * - Consistent card styling
 * - Tooltip support with info button for keyboard accessibility
 * - Placeholder handling (loading skeleton vs null value placeholder)
 * - Label/value layout
 *
 * Placeholder behavior:
 * - When value is undefined: Shows loading skeleton (configurable via loadingPlaceholder)
 * - When value is null: Shows null value placeholder (configurable via nullValuePlaceholder, default: 'N/A')
 */
export interface MetricBaseProps {
    /** The label displayed at the top of the metric card */
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

    /** Optional tooltip explanation shown on hover and via info button */
    tooltipExplanation?: string;
}

/**
 * Internal base component for metrics.
 * DO NOT use directly - use TimeMetric, CountMetric, GenericMetric, or create a new specialized metric.
 */
export const MetricBase: React.FC<MetricBaseProps> = ({
    label,
    value,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = 'N/A',
    tooltipExplanation,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);

    const renderValue = () => {
        // Explicit null means data is unavailable (e.g., error state, not supported)
        if (value === null) {
            return <span className="nullValue">{nullValuePlaceholder}</span>;
        }

        // Undefined means data is still loading
        if (value === undefined) {
            if (loadingPlaceholder === 'skeleton') {
                return <SkeletonItem size={28} />;
            }
            return null; // empty
        }

        return value;
    };

    // Format tooltip content if tooltip explanation is provided
    const valueText =
        value !== null && value !== undefined && (typeof value === 'string' || typeof value === 'number')
            ? String(value)
            : '';

    return (
        <Card className="metricCard" appearance="filled" ref={cardRef}>
            <div className="metricCardHeader">
                <div className="dataHeader">{label}</div>
                {tooltipExplanation && (
                    <Tooltip
                        content={{
                            children: (
                                <div className="metricTooltip">
                                    <div className="tooltipHeader">{label}</div>
                                    <div className="tooltipContent">{tooltipExplanation}</div>
                                    {valueText && (
                                        <div className="tooltipValue">
                                            <DataUsageRegular fontSize={24} /> {valueText}
                                        </div>
                                    )}
                                </div>
                            ),
                        }}
                        positioning={{ target: cardRef.current, position: 'below' }}
                        relationship="description"
                    >
                        <Button
                            appearance="transparent"
                            icon={<InfoRegular />}
                            size="small"
                            aria-label={`More information about ${label}`}
                            className="metricInfoButton"
                        />
                    </Tooltip>
                )}
            </div>
            <div className="dataValue">{renderValue()}</div>
        </Card>
    );
};
