/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EnableWildcardIndexConfirmationDetails, type FieldIndexType } from './types';

export type WildcardScope = 'all' | 'path';
export type WildcardActivationDecision = 'enable' | 'confirm' | 'blocked';

export interface IndexFieldDraft {
    id: string;
    field: string;
    type: FieldIndexType;
}

export interface CreateIndexFormState {
    fields: IndexFieldDraft[];
    name: string;
    nameEnabled: boolean;
    unique: boolean;
    sparse: boolean;
    ttlEnabled: boolean;
    ttlSeconds: string;
    ttlConfigured: boolean;
    partialText: string;
    collationText: string;
    wildcardEnabled: boolean;
    wildcardScope: WildcardScope;
    wildcardPath: string;
    wildcardProjectionText: string;
}

export type FieldIdFactory = () => string;

export function makeIndexFieldId(): string {
    return `field-${Math.random().toString(36).slice(2, 10)}`;
}

function blankField(createFieldId: FieldIdFactory): IndexFieldDraft {
    return { id: createFieldId(), field: '', type: 'asc' };
}

export function createInitialIndexFormState(createFieldId: FieldIdFactory = makeIndexFieldId): CreateIndexFormState {
    return {
        fields: [blankField(createFieldId)],
        name: '',
        nameEnabled: false,
        unique: false,
        sparse: false,
        ttlEnabled: false,
        ttlSeconds: '3600',
        ttlConfigured: false,
        partialText: '{  }',
        collationText: '{  }',
        wildcardEnabled: false,
        wildcardScope: 'all',
        wildcardPath: '',
        wildcardProjectionText: '{  }',
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

export function isWildcardParentPathValid(path: string): boolean {
    return normalizeWildcardParentPath(path).length > 0 && !path.includes('$**');
}

/** Produce the generated ascending wildcard key owned by the UI. */
export function buildWildcardKey(scope: WildcardScope, path: string): string {
    if (scope === 'all' || !isWildcardParentPathValid(path)) {
        return '$**';
    }
    return `${normalizeWildcardParentPath(path)}.$**`;
}

export function getEnableWildcardImpact(state: CreateIndexFormState): EnableWildcardIndexConfirmationDetails {
    return {
        fields: state.fields
            .filter((entry) => entry.field.trim().length > 0)
            .map((entry) => ({ field: entry.field.trim(), type: entry.type })),
        clearUnique: state.unique,
        clearSparse: state.sparse,
        clearTtl: state.ttlEnabled || state.ttlConfigured,
        retainName: state.nameEnabled && state.name.trim().length > 0,
        retainPartialFilter: !isBlankIndexOption(state.partialText),
        retainCollation: !isBlankIndexOption(state.collationText),
    };
}

export function requiresEnableWildcardConfirmation(details: EnableWildcardIndexConfirmationDetails): boolean {
    return details.fields.length > 0 || details.clearUnique || details.clearSparse || details.clearTtl;
}

export function getWildcardActivationDecision(
    state: CreateIndexFormState,
    confirmationPending: boolean,
): WildcardActivationDecision {
    if (confirmationPending) {
        return 'blocked';
    }
    return requiresEnableWildcardConfirmation(getEnableWildcardImpact(state)) ? 'confirm' : 'enable';
}

/** Atomically replace ordinary fields and clear only wildcard-incompatible options. */
export function applyConfirmedWildcardTransition(
    state: CreateIndexFormState,
    createFieldId: FieldIdFactory = makeIndexFieldId,
): CreateIndexFormState {
    return {
        ...state,
        fields: [
            {
                id: createFieldId(),
                field: buildWildcardKey(state.wildcardScope, state.wildcardPath),
                type: 'asc',
            },
        ],
        unique: false,
        sparse: false,
        ttlEnabled: false,
        ttlSeconds: '3600',
        ttlConfigured: false,
        wildcardEnabled: true,
    };
}

export function applyWildcardConfirmationResult(
    state: CreateIndexFormState,
    confirmed: boolean,
    createFieldId: FieldIdFactory = makeIndexFieldId,
): CreateIndexFormState {
    return confirmed ? applyConfirmedWildcardTransition(state, createFieldId) : state;
}

export function disableWildcardMode(
    state: CreateIndexFormState,
    createFieldId: FieldIdFactory = makeIndexFieldId,
): CreateIndexFormState {
    return { ...state, fields: [blankField(createFieldId)], wildcardEnabled: false };
}

export function setWildcardScope(state: CreateIndexFormState, scope: WildcardScope): CreateIndexFormState {
    const fields: IndexFieldDraft[] = state.wildcardEnabled
        ? state.fields.map((field, index) =>
              index === 0 ? { ...field, field: buildWildcardKey(scope, state.wildcardPath), type: 'asc' } : field,
          )
        : state.fields;
    return { ...state, wildcardScope: scope, fields };
}

export function setWildcardPath(state: CreateIndexFormState, path: string): CreateIndexFormState {
    const fields: IndexFieldDraft[] = state.wildcardEnabled
        ? state.fields.map((field, index) =>
              index === 0 ? { ...field, field: buildWildcardKey(state.wildcardScope, path), type: 'asc' } : field,
          )
        : state.fields;
    return { ...state, wildcardPath: path, fields };
}
