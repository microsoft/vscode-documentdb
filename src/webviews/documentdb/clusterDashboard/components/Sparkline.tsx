/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from 'react';

export interface SparklineProps {
    /** Series to draw, oldest first. `null` entries are gaps (unsupported/failed samples). */
    data: Array<number | null>;
    width?: number;
    height?: number;
    /** Stroke color; defaults to the VS Code chart palette. */
    color?: string;
    /** Fill the area under the line. Used by the larger Overview charts. */
    filled?: boolean;
}

/**
 * Minimal dependency-free sparkline.
 *
 * The chart is decorative: the accessible representation of every series is the numeric
 * value rendered next to it, so the SVG is `aria-hidden`. Colors come from the VS Code
 * chart palette so the chart re-themes with the editor.
 */
export const Sparkline = ({
    data,
    width = 160,
    height = 36,
    color = 'var(--vscode-charts-blue, currentColor)',
    filled = false,
}: SparklineProps): JSX.Element => {
    const points = data.map((value) => (value !== null && Number.isFinite(value) ? value : null));
    const present = points.filter((value): value is number => value !== null);

    if (present.length < 2) {
        return (
            <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                <line
                    x1={0}
                    y1={height / 2}
                    x2={width}
                    y2={height / 2}
                    stroke="var(--vscode-editorWidget-border, currentColor)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                />
            </svg>
        );
    }

    const minimum = Math.min(...present);
    const maximum = Math.max(...present);
    const isFlat = maximum === minimum;
    // A flat series has no range to normalize against; draw it through the vertical centre
    // rather than at y=0, which would render stable low latency as a "dead" bottom line.
    const range = isFlat ? 1 : maximum - minimum;
    const padding = 2;
    const usableHeight = height - padding * 2;
    // Positions are keyed to the slot index, not to the index among present values, so a
    // gap does not shift every earlier point sideways on each poll.
    const stepX = points.length > 1 ? width / (points.length - 1) : width;

    const toPoint = (value: number, index: number): string => {
        const x = index * stepX;
        const y = isFlat
            ? padding + usableHeight / 2
            : padding + usableHeight - ((value - minimum) / range) * usableHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    };

    // Split into contiguous runs so a gap (null = unsupported/failed sample) renders as a
    // break in the line instead of being stitched over, which would show an outage as a
    // healthy line stretched to "now".
    const segments: string[][] = [];
    let currentSegment: string[] = [];
    points.forEach((value, index) => {
        if (value === null) {
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
                currentSegment = [];
            }
            return;
        }
        currentSegment.push(toPoint(value, index));
    });
    if (currentSegment.length > 0) {
        segments.push(currentSegment);
    }

    const longestSegment = segments.reduce(
        (longest, segment) => (segment.length > longest.length ? segment : longest),
        [...[]] as string[],
    );

    return (
        <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {filled && longestSegment.length > 1 && (
                <polygon
                    points={`${longestSegment[0].split(',')[0]},${height} ${longestSegment.join(' ')} ${longestSegment[longestSegment.length - 1].split(',')[0]},${height}`}
                    fill={color}
                    fillOpacity={0.15}
                    stroke="none"
                />
            )}
            {segments.map((segment, index) =>
                segment.length > 1 ? (
                    <polyline
                        key={index}
                        points={segment.join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                    />
                ) : (
                    <circle
                        key={index}
                        cx={Number(segment[0].split(',')[0])}
                        cy={Number(segment[0].split(',')[1])}
                        r={1.5}
                        fill={color}
                    />
                ),
            )}
        </svg>
    );
};
