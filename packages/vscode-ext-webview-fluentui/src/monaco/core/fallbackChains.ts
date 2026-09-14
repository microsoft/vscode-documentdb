/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Where a colour id falls back to when the active theme does not publish it.
 *
 * The rule, so this does not become invented policy across all 392 ids:
 *
 * > An id gets a chain **only** if it paints a surface Fluent also paints, **and** the chain
 * > mirrors one that already exists in `theme/core/themeGenerator.ts`.
 *
 * Everything else is left to Monaco's own defaults, deliberately. For ids Monaco owns outright -
 * the cursor, the current-line highlight, bracket matching - Monaco's default *is* the right
 * answer and a chain would be worse. The divergence only matters where the same visual concept is
 * rendered twice, by two engines, resolving it two different ways: a Fluent popover beside a
 * Monaco hover widget, a Fluent menu beside Monaco's context menu, a Fluent Input beside the find
 * widget's.
 *
 * Each entry lists fallbacks only; the id's own value is preferred when published, so on a theme
 * that defines everything this table does nothing at all.
 */
export const MONACO_COLOR_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
    // Widget surfaces, against Fluent's colorNeutralBackground1Hover / BackgroundDisabled chains.
    'editorWidget.background': ['editor.background'],
    'editorHoverWidget.background': ['editorWidget.background', 'editor.background'],
    'editorSuggestWidget.background': ['editorWidget.background', 'editor.background'],
    'menu.background': ['editorWidget.background', 'editor.background'],
    'quickInput.background': ['editorWidget.background', 'editor.background'],
    'input.background': ['editorWidget.background', 'editor.background'],

    // Separators, against Fluent's colorNeutralStroke2 chain. `widget.border` and
    // `editorWidget.border` name each other, which is safe because every chain reads the raw
    // published values rather than resolved ones.
    'editorWidget.border': ['widget.border', 'panel.border'],
    'editorHoverWidget.border': ['editorWidget.border', 'widget.border', 'panel.border'],
    'editorSuggestWidget.border': ['editorWidget.border', 'widget.border', 'panel.border'],
    'widget.border': ['panel.border', 'editorWidget.border'],

    // List rows and selection, against Fluent's colorNeutralBackground1Hover / 1Selected and
    // colorSubtleBackgroundPressed chains.
    'list.hoverBackground': ['editorWidget.background', 'editor.background'],
    'list.activeSelectionBackground': ['list.hoverBackground'],
    'list.inactiveSelectionBackground': ['list.hoverBackground', 'editorWidget.background'],
    'editorSuggestWidget.selectedBackground': ['list.activeSelectionBackground', 'list.hoverBackground'],
    'menu.selectionBackground': ['list.activeSelectionBackground', 'list.hoverBackground'],

    // Menu text, against Fluent's colorNeutralForeground2 mapping.
    'menu.foreground': ['foreground', 'editor.foreground'],
};

/**
 * Chain sources Monaco does not register itself, so they are absent from `MONACO_COLOR_IDS` and
 * have to be read alongside it. They are read and then discarded - Monaco would ignore them.
 */
export const MONACO_FALLBACK_SOURCES: readonly string[] = ['panel.border'];
