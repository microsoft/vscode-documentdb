/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Mock data for experimental Query Insights tab implementations
 * Used to demonstrate different accessibility approaches
 */

import type { PerformanceDiagnostic } from '../../../types/queryInsights';

export interface MockMetricData {
    label: string;
    value: string | number;
    tooltipExplanation: string;
}

export interface MockPerformanceRating {
    score: 'poor' | 'fair' | 'good' | 'excellent';
    diagnostics: PerformanceDiagnostic[];
}

export const mockMetrics: MockMetricData[] = [
    {
        label: 'Execution Time',
        value: '2.33 ms',
        tooltipExplanation: 'Total time taken to execute the query on the server',
    },
    {
        label: 'Documents Returned',
        value: 42,
        tooltipExplanation: 'Number of documents returned by the query',
    },
    {
        label: 'Keys Examined',
        value: 42,
        tooltipExplanation: 'Number of index keys scanned during query execution. Lower is better.',
    },
    {
        label: 'Documents Examined',
        value: 42,
        tooltipExplanation:
            'Number of documents scanned to find matching results. Should be close to documents returned for optimal performance.',
    },
];

export const mockPerformanceRating: MockPerformanceRating = {
    score: 'fair',
    diagnostics: [
        {
            type: 'negative',
            message: 'Collection Scan Detected',
            details:
                'The query is performing a full collection scan instead of using an index. This can be slow for large collections.\n\nConsider creating an index on the fields used in your query filter.',
        },
        {
            type: 'positive',
            message: 'Fast Execution',
            details:
                'The query executed quickly (under 5ms). This indicates good performance for the current dataset size.\n\nMonitor execution time as your collection grows.',
        },
    ],
};

export const mockEfficiencyData = {
    executionStrategy: 'COLLSCAN',
    indexUsed: 'None',
    examinedReturnedRatio: '1.0',
    hasInMemorySort: false,
};
