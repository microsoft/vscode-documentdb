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
    const points = data.filter((value): value is number => value !== null && Number.isFinite(value));

    if (points.length < 2) {
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

    const minimum = Math.min(...points);
    const maximum = Math.max(...points);
    // A flat series would divide by zero; render it as a centered horizontal line instead.
    const range = maximum - minimum || 1;
    const padding = 2;
    const usableHeight = height - padding * 2;
    const stepX = width / (points.length - 1);

    const coordinates = points.map((value, index) => {
        const x = index * stepX;
        const y = padding + usableHeight - ((value - minimum) / range) * usableHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return (
        <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {filled && (
                <polygon
                    points={`0,${height} ${coordinates.join(' ')} ${width},${height}`}
                    fill={color}
                    fillOpacity={0.15}
                    stroke="none"
                />
            )}
            <polyline
                points={coordinates.join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
};
