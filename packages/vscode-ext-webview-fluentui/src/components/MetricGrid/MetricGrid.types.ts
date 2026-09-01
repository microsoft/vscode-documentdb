/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

export interface MetricGridProps extends ComponentPropsWithoutRef<'div'> {
    /** {@link MetricCardProps | MetricCard} elements. */
    readonly children: ReactNode;
}

export interface MetricCardProps extends ComponentPropsWithoutRef<'div'> {
    /** The caption above the value. */
    readonly label: ReactNode;
    /**
     * `undefined` renders {@link MetricCardProps.loadingPlaceholder}, `null` renders
     * {@link MetricCardProps.nullValuePlaceholder}, and anything else renders as it is, including
     * `0` and the empty string.
     *
     * The card never formats. Pass a finished string, or a node for something the type scale cannot
     * express, such as a value with a bar beneath it.
     */
    readonly value?: ReactNode;
    /**
     * A sentence or two explaining what the number means. Shown in a tooltip, and marked beside the
     * label with an info glyph. Its absence removes both.
     */
    readonly description?: string;
    /**
     * `filled` puts the card on a `Card` surface, for a metric that stands on its own.
     * `subtle` drops the surface, for a cell inside a card that already has one.
     *
     * @default 'filled'
     */
    readonly appearance?: 'filled' | 'subtle';
    /**
     * The value's type scale, and with it the height the card reserves for the value before it
     * arrives.
     *
     * @default 'large'
     */
    readonly size?: 'large' | 'small';
    /**
     * What occupies the value slot while {@link MetricCardProps.value} is `undefined`. `empty`
     * leaves the reserved height blank, which is quieter on a surface that has many cards loading
     * at once.
     *
     * @default 'skeleton'
     */
    readonly loadingPlaceholder?: 'skeleton' | 'empty';
    /**
     * Shown when {@link MetricCardProps.value} is `null`. Defaults to English; pass a localized
     * string if the consumer ships translations.
     *
     * @default 'N/A'
     */
    readonly nullValuePlaceholder?: string;
    /**
     * Where the tooltip opens. `below` suits a card in a row with space under it; `above-start`
     * suits a cell low in a dense grid.
     *
     * @default 'below'
     */
    readonly tooltipPositioning?: 'below' | 'above-start';
    /**
     * Repeat the value inside the tooltip, under the explanation and beside a glyph.
     *
     * Off by default: a tooltip that restates the number already on screen is decoration, and it
     * lengthens what assistive technology reads out as the description.
     *
     * @default false
     */
    readonly tooltipRepeatsValue?: boolean;
    /**
     * A complete accessible name, composed by the consumer.
     *
     * Supplying it makes the visible label and value **decorative**: they are hidden from assistive
     * technology, so this string must carry everything they say. Omitting it lets the visible
     * content name the card, which is the simpler contract and usually the right one.
     *
     * The card takes no position on which is correct, because the right answer depends on whether
     * the surface already describes the card some other way. Fluent's `Tooltip` with
     * `relationship="description"` sets `aria-describedby`, so a card that also composes the
     * description into this name will have it announced twice.
     */
    readonly ariaLabel?: string;
}
