/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` - the four forms Monaco's `Color.fromHex` parses. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Both the legacy `rgb(r, g, b)` and the modern `rgb(r g b / a)` serializations. */
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;

const clamp = (value: number, max: number): number => (value < 0 ? 0 : value > max ? max : value);

/** A channel is a number 0-255 or a percentage; `getComputedStyle` can return either. */
function parseChannel(part: string): number | undefined {
    const percentage = part.endsWith('%');
    const value = Number.parseFloat(percentage ? part.slice(0, -1) : part);

    if (!Number.isFinite(value)) {
        return undefined;
    }

    return Math.round(clamp(percentage ? (value / 100) * 255 : value, 255));
}

function parseAlpha(part: string): number | undefined {
    const percentage = part.endsWith('%');
    const value = Number.parseFloat(percentage ? part.slice(0, -1) : part);

    if (!Number.isFinite(value)) {
        return undefined;
    }

    return clamp(percentage ? value / 100 : value, 1);
}

const toHexPair = (channel: number): string => channel.toString(16).padStart(2, '0');

/**
 * Normalizes a computed CSS color into a hex string, or `undefined` if it is not one.
 *
 * Returning `undefined` rather than passing the value through is the point. Monaco's
 * `Color.fromHex` is `parseHex(value) || Color.red`, so a single unparseable value does not
 * degrade - it paints that surface **red**. Dropping the id instead lets Monaco fall back to its
 * own default for it, which is the correct behavior for an unreadable color.
 *
 * Deliberately narrower than a general CSS color parser: `color-mix()`, `color()`, `hsl()` and
 * named colors all return `undefined`. VS Code publishes its theme colors as hex or `rgba()`, so
 * widening this would only add ways to guess wrong.
 */
export function toHexColor(value: string): string | undefined {
    const trimmed = value.trim();

    if (HEX_COLOR.test(trimmed)) {
        return trimmed.toLowerCase();
    }

    const rgb = RGB_FUNCTION.exec(trimmed);
    if (!rgb) {
        return undefined;
    }

    const parts = rgb[1].split(/[\s,/]+/).filter((part) => part !== '');
    if (parts.length < 3 || parts.length > 4) {
        return undefined;
    }

    const red = parseChannel(parts[0]);
    const green = parseChannel(parts[1]);
    const blue = parseChannel(parts[2]);
    const alpha = parts.length === 4 ? parseAlpha(parts[3]) : 1;

    if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
        return undefined;
    }

    const opaque = `#${toHexPair(red)}${toHexPair(green)}${toHexPair(blue)}`;

    return alpha === 1 ? opaque : `${opaque}${toHexPair(Math.round(alpha * 255))}`;
}
