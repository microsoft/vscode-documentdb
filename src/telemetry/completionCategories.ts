/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Single source of truth for the "completion accepted" telemetry signal.
 *
 * Must remain **dependency-free** (no `vscode`, no Node.js APIs) so it can
 * be imported from both extension host and webview bundles.
 */

// ---------------------------------------------------------------------------
// Categories — what kind of completion item the user accepted
// ---------------------------------------------------------------------------

/** All valid completion categories. Used by the zod schema in collectionViewRouter. */
export const COMPLETION_CATEGORIES = [
    'field',
    'operator',
    'bsonConstructor',
    'typeSuggestion',
    'jsGlobal',
    'collectionName',
    'other',
] as const;

export type CompletionCategory = (typeof COMPLETION_CATEGORIES)[number];

const validCategories: ReadonlySet<string> = new Set<string>(COMPLETION_CATEGORIES);

/** Returns the category if valid, otherwise `'unknown'`. */
export function normalizeCompletionCategory(raw: string | undefined): CompletionCategory | 'unknown' {
    return raw && validCategories.has(raw) ? (raw as CompletionCategory) : 'unknown';
}

// ---------------------------------------------------------------------------
// Sources — which surface produced the completion
// ---------------------------------------------------------------------------

export type CompletionSource = 'playground' | 'collectionView';

export const CompletionSources = {
    Playground: 'playground',
    CollectionView: 'collectionView',
} as const satisfies Record<string, CompletionSource>;

const validSources: ReadonlySet<string> = new Set<string>(Object.values(CompletionSources));

/** Returns the source if valid, otherwise `'unknown'`. */
export function normalizeCompletionSource(raw: string | undefined): CompletionSource | 'unknown' {
    return raw && validSources.has(raw) ? (raw as CompletionSource) : 'unknown';
}

// ---------------------------------------------------------------------------
// Command ids
// ---------------------------------------------------------------------------

export const CompletionCommandIds = {
    completionAccepted: 'vscode-documentdb.command.internal.completionAccepted',
} as const;
