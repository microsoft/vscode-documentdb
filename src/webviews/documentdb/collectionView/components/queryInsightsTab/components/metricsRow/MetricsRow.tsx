/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import './MetricsRow.scss';

/**
 * Container component for displaying a row of metric cards.
 *
 * This is a simple wrapper that applies the grid layout.
 * Use it with specialized metric components (TimeMetric, CountMetric, etc.)
 *
 * @example
 * <MetricsRow>
 *     <TimeMetric label="Execution Time" valueMs={2.333} />
 *     <CountMetric label="Documents" value={10000} />
 *     <RatioMetric label="Hit Rate" ratio={0.85} showBar={true} />
 * </MetricsRow>
 */
export interface MetricsRowProps {
    children: React.ReactNode;
}

export const MetricsRow: React.FC<MetricsRowProps> = ({ children }) => {
    return <div className="metricsRow">{children}</div>;
};
