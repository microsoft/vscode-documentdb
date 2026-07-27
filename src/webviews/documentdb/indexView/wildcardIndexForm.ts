/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldIndexType } from './types';

/**
 * The three mutually-exclusive index creation modes surfaced as tabs at the top
 * of the Create Index drawer. Each mode keeps its own draft in
 * {@link CreateIndexFormState} so switching between them never destroys the work
 * configured for another mode.
 */
export type IndexKind = 'standard' | 'wildcard' | 'vector';

export type WildcardScope = 'all' | 'path';

/** Whether the wildcard projection lists fields to include or to exclude. */
export type WildcardProjectionMode = 'include' | 'exclude';

export interface IndexFieldDraft {
    id: string;
    field: string;
    type: FieldIndexType;
}

/** One editable row in the wildcard-projection field list. */
export interface ProjectionFieldDraft {
    id: string;
    field: string;
}

export interface CreateIndexFormState {
    /** Active creation mode; the per-mode drafts below are all preserved. */
    indexKind: IndexKind;

    // --- Standard mode draft ------------------------------------------------
    fields: IndexFieldDraft[];
    unique: boolean;
    sparse: boolean;
    ttlEnabled: boolean;
    ttlSeconds: string;
    ttlConfigured: boolean;

    // --- Shared by Standard and Wildcard ------------------------------------
    name: string;
    nameEnabled: boolean;
    partialText: string;
    collationText: string;

    // --- Wildcard mode draft ------------------------------------------------
    wildcardScope: WildcardScope;
    wildcardPath: string;
    /** Whether the wildcard projection is configured (fields list below applies). */
    wildcardProjectionEnabled: boolean;
    /** Include-vs-exclude semantics for the listed projection fields. */
    wildcardProjectionMode: WildcardProjectionMode;
    /** Field paths the projection includes or excludes. */
    wildcardProjectionFields: ProjectionFieldDraft[];
}

export type FieldIdFactory = () => string;

export function makeIndexFieldId(): string {
    return `field-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable id factory for a wildcard-projection field row. */
export function makeProjectionFieldId(): string {
    return `projection-${Math.random().toString(36).slice(2, 10)}`;
}

function blankField(createFieldId: FieldIdFactory): IndexFieldDraft {
    return { id: createFieldId(), field: '', type: 'asc' };
}

/** A single blank projection row so the list is never empty when first shown. */
function blankProjectionField(createFieldId: FieldIdFactory): ProjectionFieldDraft {
    return { id: createFieldId(), field: '' };
}

export function createInitialIndexFormState(createFieldId: FieldIdFactory = makeIndexFieldId): CreateIndexFormState {
    return {
        indexKind: 'standard',
        fields: [blankField(createFieldId)],
        unique: false,
        sparse: false,
        ttlEnabled: false,
        ttlSeconds: '3600',
        ttlConfigured: false,
        name: '',
        nameEnabled: false,
        partialText: '{  }',
        collationText: '{  }',
        wildcardScope: 'all',
        wildcardPath: '',
        wildcardProjectionEnabled: false,
        wildcardProjectionMode: 'include',
        wildcardProjectionFields: [blankProjectionField(createFieldId)],
    };
}

/** Empty text and an empty object both mean that a JSON option is not configured. */
export function isBlankIndexOption(text: string): boolean {
    const trimmed = text.trim();
    return trimmed === '' || /^\{\s*\}$/.test(trimmed);
}

/** Collapse accidental empty path segments and surrounding whitespace. */
export function normalizeWildcardParentPath(path: string): string {
    return path
        .trim()
        .split('.')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .join('.');
}

/**
 * A parent path is acceptable as long as it does not itself contain the wildcard
 * token (`$**` is appended automatically). An empty path is allowed: it is
 * treated as the all-fields wildcard, so the field never shows an error for
 * empty input — validation of the final key happens at submit time.
 */
export function isWildcardParentPathValid(path: string): boolean {
    return !path.includes('$**');
}

/**
 * Produce the generated ascending wildcard key. An empty (or whitespace-only)
 * parent path collapses to the all-fields `$**` key, so a blank path behaves
 * exactly like selecting "All fields".
 */
export function buildWildcardKey(scope: WildcardScope, path: string): string {
    if (scope === 'all') {
        return '$**';
    }
    const normalized = normalizeWildcardParentPath(path);
    return normalized === '' ? '$**' : `${normalized}.$**`;
}

/**
 * Serialize the structured wildcard-projection editor into the plain object the
 * driver expects: each listed field maps to `1` (include) or `0` (exclude).
 * Blank rows are skipped; the result is `undefined` when nothing meaningful is
 * configured so callers can treat it exactly like an omitted option.
 */
export function buildWildcardProjectionObject(
    mode: WildcardProjectionMode,
    fields: ReadonlyArray<ProjectionFieldDraft>,
): Record<string, 0 | 1> | undefined {
    const value: 0 | 1 = mode === 'include' ? 1 : 0;
    const projection: Record<string, 0 | 1> = {};
    for (const entry of fields) {
        const name = entry.field.trim();
        if (name.length > 0) {
            projection[name] = value;
        }
    }
    return Object.keys(projection).length > 0 ? projection : undefined;
}
