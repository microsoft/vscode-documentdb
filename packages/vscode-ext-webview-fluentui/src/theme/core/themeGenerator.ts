/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BrandVariants, createDarkTheme, createLightTheme, type Theme } from '@fluentui/react-components';
import { hex_to_LCH, hexColorsFromPalette, type Palette, RGBAToHexA } from '../../palette/index.js';

type Options = {
    darkCp?: number;
    lightCp?: number;
    hueTorsion?: number;
};

/**
 * Used when the key color cannot be parsed. `--vscode-button-background` is absent outside a
 * VS Code webview — in jsdom, Storybook or a browser preview `getPropertyValue` returns `''` —
 * and the palette math has no guards of its own: `hexToHue('')` yields NaN, which poisons the
 * whole sixteen-stop ramp and then throws on the snapping-point lookup. This is VS Code's own
 * default accent, so the fallback ramp still looks like VS Code.
 */
const FALLBACK_KEY_COLOR = '#0078d4';

const SIX_DIGIT_HEX = /^#[0-9a-f]{6}$/i;

/** Normalises whatever `getPropertyValue` returned into a six-digit hex the palette math accepts. */
function toKeyColorHex(keyColor: string): string {
    const trimmed = keyColor.trim();

    if (SIX_DIGIT_HEX.test(trimmed)) {
        return trimmed;
    }

    if (trimmed.startsWith('rgb')) {
        const converted = RGBAToHexA(trimmed, true);
        return SIX_DIGIT_HEX.test(converted) ? converted : FALLBACK_KEY_COLOR;
    }

    return FALLBACK_KEY_COLOR;
}

/**
 * A palette is represented as a continuous curve through LAB space, made of two quadratic bezier curves that start at
 * 0L (black) and 100L (white) and meet at the LAB value of the provided key color.
 *
 * This function takes in a palette as input, which consists of:
 * keyColor:        The primary color in the LCH (Lightness Chroma Hue) color space
 * darkCp, lightCp: The control point of the quadratic beizer curve towards black and white, respectively (between 0-1).
 *                  Higher values move the control point toward the ends of the gamut causing chroma/saturation to
 *                  diminish more slowly near the key color, and lower values move the control point toward the key
 *                  color causing chroma/saturation to diminish more linearly.
 * hueTorsion:      Enables the palette to move through different hues by rotating the curve’s points in LAB space,
 *                  creating a helical curve

 * The function returns a set of brand tokens.
 */
export function getBrandTokensFromPalette(keyColor: string, options: Options = {}) {
    const { darkCp = 2 / 3, lightCp = 1 / 3, hueTorsion = 0 } = options;

    const resolvedKeyColor = toKeyColorHex(keyColor);

    const brandPalette: Palette = {
        keyColor: hex_to_LCH(resolvedKeyColor),
        darkCp,
        lightCp,
        hueTorsion,
    };
    const hexColors = hexColorsFromPalette(resolvedKeyColor, brandPalette, 16, 1);
    return hexColors.reduce((acc: Record<string, string>, hexColor, h) => {
        acc[`${(h + 1) * 10}`] = hexColor;
        return acc;
    }, {}) as BrandVariants;
}

/**
 * Fluent's neutral ramp (colorNeutralBackground2/3, strokes, …) is a *fixed*
 * gray produced by `createLightTheme`/`createDarkTheme`. It ignores the active
 * VS Code color theme, so surfaces painted with it (the collection-view tab
 * band, the alternating index-list rows, section separators) drift out of tune
 * on themes whose editor background is tinted or otherwise far from that gray.
 *
 * These overrides remap the neutral surfaces our webviews actually paint with
 * (tab band, alternating index-list rows, section separators) onto VS Code theme
 * variables so they track the active theme. Each value falls
 * back through progressively more common surface tokens, because many community
 * themes leave the ideal one undefined. The VS Code variables are already
 * theme-appropriate, so the exact same expressions work for both the light and
 * dark adaptive themes.
 *
 * NOTE — neutral tokens still on the fixed Fluent ramp (candidates for a future
 * pass; see the "theme color coverage" tracking issue):
 *   - colorNeutralBackground3           (markdown cards, feedback dialog, query-plan blocks)
 *   - colorNeutralForeground3 / Foreground4 / colorNeutralStroke1 / StrokeAccessible
 *     — globally, that is; fluentOverrides.scss remaps them inside field controls only,
 *     because these aliases also drive Switch indicators and Tab hover bars
 *   - colorNeutralStroke3
 *   - colorSubtleBackgroundSelected
 *   - High-contrast theme kinds bypass this generator entirely and fall back to
 *     the static Teams themes (see createVSCodeFluentTheme), so none of these token
 *     mappings apply there. The CSS in fluentOverrides.scss is not theme-kind aware
 *     and does apply — pending a visual pass.
 */
const adaptiveNeutralSurfaces = {
    // Fluent's Card interaction recipe and the Card/Button disabled recipes use
    // these Background1/Disabled aliases. The initial adaptive pass missed them,
    // so Solarized, Red and other tinted themes fell back to Fluent's fixed gray
    // ramps. Map them to VS Code interaction colors so those states now follow
    // the active workbench theme as well.
    colorNeutralBackground1Hover:
        'var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background, var(--vscode-editor-background)))',
    colorNeutralBackground1Pressed:
        'var(--vscode-toolbar-activeBackground, var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background)))',
    colorNeutralBackground1Selected:
        'var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background)))',
    colorNeutralBackgroundDisabled:
        'var(--vscode-input-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)))',
    colorNeutralForegroundDisabled:
        'var(--vscode-disabledForeground, var(--vscode-descriptionForeground, var(--vscode-foreground)))',
    colorNeutralStrokeDisabled:
        'var(--vscode-disabledForeground, var(--vscode-widget-border, var(--vscode-panel-border)))',
    // Fluent uses these subtle aliases across buttons, cards, tables, tabs,
    // tags and trees. VS Code's toolbar tokens are the corresponding general
    // action colors; list-specific surfaces can use list.* tokens locally.
    // Falling back to list colors also covers themes that omit toolbar colors.
    colorSubtleBackgroundHover:
        'var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background)))',
    colorSubtleBackgroundPressed:
        'var(--vscode-toolbar-activeBackground, var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)))',
    // Secondary neutral surface: tab band + odd alternating rows. Prefer VS
    // Code's own alternating table-row color, then the side bar / editor-widget
    // backgrounds.
    colorNeutralBackground2:
        'var(--vscode-tree-tableOddRowsBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background)))',
    colorNeutralBackground2Hover:
        'var(--vscode-list-hoverBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background)))',
    colorNeutralBackground2Pressed:
        'var(--vscode-toolbar-activeBackground, var(--vscode-list-hoverBackground, var(--vscode-sideBar-background)))',
    colorNeutralBackground2Selected:
        'var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground, var(--vscode-sideBar-background)))',
    // Subtle separators: tab-band bottom border, section rules.
    colorNeutralStroke2: 'var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-editorWidget-border)))',
} satisfies Partial<Theme>;

// Opaque skeleton/shimmer stencils. Fluent's defaults are fixed grays on the
// neutral ramp, so `opaque` skeletons render as a flat gray block that ignores
// the theme.
//
// These must stay **opaque**, and that is not a stylistic preference. Fluent's
// wave recipe paints the resting fill as `background-color: Stencil1` and then
// slides an `::after` of the same size across it, whose gradient runs
// Stencil1 → Stencil2 → Stencil1. The sweep is invisible at its own edges only
// because Stencil1 there *replaces* an identical resting fill. Give the tokens
// an alpha and the sweep composites on top of the base instead, so its leading
// and trailing edges become a hard vertical step — which is exactly how a
// translucent stencil renders, and why an earlier alpha-overlay version of this
// map looked broken.
//
// `color-mix` gets the theme-adaptiveness without the alpha: both operands are
// opaque, so the result is too, and because the tint is keyed on the foreground
// the direction follows the theme by itself — darken on light, lighten on dark —
// with no light/dark split needed here.
//
// The ratios mirror Fluent's own: Stencil1 is the stronger resting fill,
// Stencil2 the *weaker* sweep band that dips back toward the surface. (Fluent
// light is #e6e6e6 / #fafafa on white — 10% and ~2%.) Getting that order
// backwards inverts the shimmer.
//
// Note the inherent limit of `opaque`: the fill is mixed against the editor
// background, so on a card painted with some other surface it is a visible
// rectangle. That is what `opaque` means; `translucent` is the appearance that
// composites over its card, and it is what every skeleton in this extension
// uses.
//
// (The translucent `*Alpha` variants are left at Fluent's defaults — that path
// already composites correctly.)
const adaptiveSkeletonStencils = {
    colorNeutralStencil1: 'color-mix(in srgb, var(--vscode-foreground) 10%, var(--vscode-editor-background))',
    colorNeutralStencil2: 'color-mix(in srgb, var(--vscode-foreground) 3%, var(--vscode-editor-background))',
} satisfies Partial<Theme>;

// https://react.fluentui.dev/?path=/docs/concepts-developer-theming--page#overriding-existing-tokens
export const generateAdaptiveLightTheme = (): Theme => {
    const style = getComputedStyle(document.documentElement);
    const buttonBackground = style.getPropertyValue('--vscode-button-background');
    const brandVSCode: BrandVariants = getBrandTokensFromPalette(buttonBackground);

    return {
        ...createLightTheme(brandVSCode),
        ...{
            colorNeutralForeground1: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Hover: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Pressed: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Selected:
                'var(--vscode-list-inactiveSelectionForeground, var(--vscode-editor-foreground))',
            colorNeutralForeground2Selected:
                'var(--vscode-list-inactiveSelectionForeground, var(--vscode-editor-foreground))',

            colorNeutralBackground1: 'var(--vscode-editor-background)',

            // Remap the secondary neutral surfaces onto VS Code theme variables
            // (see adaptiveNeutralSurfaces) so the tab band, alternating rows and
            // separators track the active theme instead of Fluent's fixed gray.
            ...adaptiveNeutralSurfaces,

            // Opaque skeletons read as a gentle tint of the editor background rather
            // than a flat gray block (see adaptiveSkeletonStencils).
            ...adaptiveSkeletonStencils,
        },
    };
};

export const generateAdaptiveDarkTheme = (): Theme => {
    const style = getComputedStyle(document.documentElement);
    const buttonBackground = style.getPropertyValue('--vscode-button-background');
    const brandVSCode: BrandVariants = getBrandTokensFromPalette(buttonBackground);

    return {
        ...createDarkTheme(brandVSCode),
        ...{
            // Use editor-foreground for text on editor-background (fixes Nord theme and similar)
            colorNeutralForeground1: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Hover: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Pressed: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Selected:
                'var(--vscode-list-inactiveSelectionForeground, var(--vscode-editor-foreground))',
            colorNeutralForeground2: 'var(--vscode-foreground)',
            colorNeutralForeground2Hover: 'var(--vscode-foreground)',
            colorNeutralForeground2Pressed: 'var(--vscode-foreground)',
            colorNeutralForeground2Selected:
                'var(--vscode-list-inactiveSelectionForeground, var(--vscode-editor-foreground))',

            colorNeutralBackground1: 'var(--vscode-editor-background)',

            // Remap the secondary neutral surfaces onto VS Code theme variables
            // (see adaptiveNeutralSurfaces) so the tab band, alternating rows and
            // separators track the active theme instead of Fluent's fixed gray.
            ...adaptiveNeutralSurfaces,

            // Opaque skeletons read as a gentle tint of the editor background rather
            // than a flat gray block (see adaptiveSkeletonStencils).
            ...adaptiveSkeletonStencils,
        },
    };
};
