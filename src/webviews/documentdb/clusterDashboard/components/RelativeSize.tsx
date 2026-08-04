/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from 'react';

import { formatBytes } from '../formatUtils';

/**
 * Minimum width of a non-zero bar, so a database that is three orders of magnitude smaller
 * than the largest one still shows *something* rather than a bar rounded out of existence.
 * Matches the index list's `MIN_POSITIVE_BAR_PERCENT`.
 */
const MIN_POSITIVE_BAR_PERCENT = 20;

export interface RelativeSizeProps {
    /** The value to render, or `null` when the server did not report it. */
    value: number | null | undefined;
    /** The largest comparable value in the same list; the bar is scaled against it. */
    maximum: number;
}

/**
 * A formatted byte figure with a short bar beside it showing its share of the largest row.
 *
 * Deliberately identical to the index list's size column in the Collection View — same
 * geometry, same colour, same minimum width — because they answer the same question about
 * two different lists, and a reader who has learned one should not have to learn the other.
 *
 * There is no track behind the bar. A track reads as capacity, which would say the row is
 * approaching a limit as it fills; nothing here knows about provisioned disk, and the bar's
 * only claim is "this much of the biggest row".
 */
export const RelativeSize = ({ value, maximum }: RelativeSizeProps): JSX.Element => {
    const barWidth =
        value === null || value === undefined || !Number.isFinite(value) || value < 0 || maximum <= 0
            ? undefined
            : value === 0
              ? '0%'
              : `${Math.max(MIN_POSITIVE_BAR_PERCENT, (value / maximum) * 100)}%`;

    return (
        <div className="relativeSizeCell">
            <span className="relativeSizeText">{formatBytes(value)}</span>
            {barWidth !== undefined && (
                <span className="relativeSizeTrack" aria-hidden="true">
                    <span className="relativeSizeBar" style={{ width: barWidth }} />
                </span>
            )}
        </div>
    );
};
