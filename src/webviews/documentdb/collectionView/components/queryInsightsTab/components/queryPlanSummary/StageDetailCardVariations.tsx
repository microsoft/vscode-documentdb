/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text } from '@fluentui/react-components';
import { StageDetailCard } from './StageDetailCard';

/**
 * Component to showcase all StageDetailCard layout variations for design evaluation.
 * Displays the same data across different variants to compare readability and space usage.
 */
export const StageDetailCardVariations: React.FC = () => {
    const sampleMetrics = [
        { label: 'Index Bounds', value: '{ user_id: [1, 1000] }' },
        { label: 'Keys Examined', value: 523 },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '16px' }}>
            <Text size={500} weight="semibold">
                Stage Detail Card Layout Variations
            </Text>
            <Text size={300}>
                Compare different layouts balancing readability and space efficiency. All variants show the same data.
            </Text>

            {/* v1: Primary row, additional in 2-col grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v1: Primary Metrics Row + 2-Column Grid</Text>
                <Text size={200}>
                    Returned and Execution Time in horizontal row, additional metrics in 2-column grid (key | value)
                </Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v1"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v1"
                />
            </div>

            {/* v2: All metrics single column inline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v2: Compact Single Column</Text>
                <Text size={200}>All metrics stacked vertically with inline label: value format - most compact</Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v2"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v2"
                />
            </div>

            {/* v3: All uniform 2-col grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v3: Uniform 2-Column Grid</Text>
                <Text size={200}>All metrics (including primary) in consistent 2-column grid layout</Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v3"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v3"
                />
            </div>

            {/* v4: Primary row, 3-col grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v4: Primary Row + 3-Column Grid</Text>
                <Text size={200}>
                    Primary metrics in row, additional metrics in responsive 3-column grid - most space efficient
                </Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v4"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v4"
                />
            </div>

            {/* v5: Primary spaced, compact list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v5: Emphasized Primary + Compact List</Text>
                <Text size={200}>Primary metrics with generous spacing, additional metrics in compact list below</Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v5"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v5"
                />
            </div>

            {/* v6: Uniform table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v6: Uniform Table Layout</Text>
                <Text size={200}>All metrics treated equally in table format - most predictable and scannable</Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v6"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v6"
                />
            </div>

            {/* v7: Like v4 but with uniform 2-col grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v7: Primary Row + Uniform 2-Column Grid</Text>
                <Text size={200}>
                    Like v4 but additional metrics in uniform 2-column grid instead of 3-column - more consistent
                </Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v7"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v7"
                />
            </div>

            {/* v8: Like v5 but with uniform 2-col grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Text weight="semibold">v8: Emphasized Primary + Uniform 2-Column Grid</Text>
                <Text size={200}>
                    Like v5 but additional metrics in uniform 2-column grid instead of inline - more structured
                </Text>
                <StageDetailCard
                    stageType="IXSCAN"
                    description="Index Name: user_id_1"
                    returned={1247}
                    executionTimeMs={54.23}
                    metrics={sampleMetrics}
                    variant="v8"
                />
                <StageDetailCard
                    stageType="FETCH"
                    description="Fetching documents"
                    returned={1247}
                    executionTimeMs={37.89}
                    variant="v8"
                />
            </div>
        </div>
    );
};
