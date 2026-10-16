/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { type JSX } from 'react';
import { type MetricGridProps } from './MetricGrid.types.js';

const useStyles = makeStyles({
    grid: {
        display: 'grid',
        gap: '16px',
        gridAutoRows: 'auto',
        // `minWidth: 0` lets a track shrink below its content, which is what makes the cards
        // truncate instead of pushing the grid wider than its container.
        minWidth: 0,
        gridTemplateColumns: '1fr',
        '@media (min-width: 400px)': { gridTemplateColumns: 'repeat(2, 1fr)' },
        '@media (min-width: 800px)': { gridTemplateColumns: 'repeat(4, 1fr)' },
    },
});

/**
 * The responsive grid {@link MetricCard} elements sit in: one column, two from 400px, four from
 * 800px.
 *
 * ```tsx
 * <MetricGrid>
 *     <MetricCard label="Execution time" value="2.33 ms" />
 *     <MetricCard label="Documents returned" value="10,000" />
 * </MetricGrid>
 * ```
 *
 * The breakpoints are on the viewport rather than on the grid's own width, which is the wrong
 * measure for a grid inside a resizable panel and is a known limitation rather than a choice.
 *
 * It is a plain grid, so anything can go in it. Cards of the same `size` line up; mixing sizes in
 * one grid produces rows of unequal height.
 */
export const MetricGrid = ({ children, className, ...rest }: MetricGridProps): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={mergeClasses(styles.grid, className)} {...rest}>
            {children}
        </div>
    );
};
