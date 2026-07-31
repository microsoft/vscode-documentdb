/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildWildcardKey,
    buildWildcardProjectionObject,
    createInitialIndexFormState,
    isBlankIndexOption,
    isWildcardParentPathValid,
    isWildcardPathInputValid,
    normalizeWildcardParentPath,
} from './wildcardIndexForm';

const createFieldId = (): string => 'test-field';

describe('create index form state', () => {
    it('starts in the standard kind with pristine per-mode drafts', () => {
        const state = createInitialIndexFormState(createFieldId);
        expect(state).toMatchObject({
            indexKind: 'standard',
            unique: false,
            sparse: false,
            ttlEnabled: false,
            ttlSeconds: '3600',
            nameEnabled: false,
            partialText: '{  }',
            collationText: '{  }',
            wildcardName: '',
            wildcardNameEnabled: false,
            wildcardPartialText: '{  }',
            wildcardCollationText: '{  }',
            wildcardScope: 'all',
            wildcardPath: '',
            wildcardProjectionMode: 'include',
        });
        expect(state.fields).toEqual([{ id: 'test-field', field: '', type: 'asc' }]);
        expect(state.wildcardProjectionFields).toEqual([{ id: 'test-field', field: '' }]);
    });

    it('keeps Standard and Wildcard option drafts independent', () => {
        const state = createInitialIndexFormState(createFieldId);
        state.name = 'standard_name';
        state.nameEnabled = true;
        state.partialText = '{ standard: true }';
        state.collationText = "{ locale: 'en' }";

        expect(state).toMatchObject({
            wildcardName: '',
            wildcardNameEnabled: false,
            wildcardPartialText: '{  }',
            wildcardCollationText: '{  }',
        });
    });
});

describe('blank option detection', () => {
    it.each(['', '   ', '{}', '{  }', '{\n}'])('treats "%s" as blank', (text) => {
        expect(isBlankIndexOption(text)).toBe(true);
    });

    it.each(['{ a: 1 }', '{"a":1}'])('treats "%s" as configured', (text) => {
        expect(isBlankIndexOption(text)).toBe(false);
    });
});

describe('wildcard parent path', () => {
    it('normalizes stray dots and whitespace', () => {
        expect(normalizeWildcardParentPath(' metadata.. ')).toBe('metadata');
        expect(normalizeWildcardParentPath('a. b .c')).toBe('a.b.c');
    });

    it('accepts an empty path (treated as all fields)', () => {
        expect(isWildcardParentPathValid('')).toBe(true);
        expect(isWildcardParentPathValid('   ')).toBe(true);
    });

    it('accepts an ordinary path', () => {
        expect(isWildcardParentPathValid('metadata')).toBe(true);
    });

    it('rejects a path that already contains the wildcard token', () => {
        expect(isWildcardParentPathValid('metadata.$**')).toBe(false);
    });

    it('ignores a stale invalid parent path outside the path scope', () => {
        expect(isWildcardPathInputValid('all', 'metadata.$**')).toBe(true);
        expect(isWildcardPathInputValid('projection', 'metadata.$**')).toBe(true);
    });

    it('validates the parent path in the path scope', () => {
        expect(isWildcardPathInputValid('path', 'metadata')).toBe(true);
        expect(isWildcardPathInputValid('path', 'metadata.$**')).toBe(false);
    });
});

describe('wildcard key generation', () => {
    it('uses $** for the all-fields scope', () => {
        expect(buildWildcardKey('all', 'ignored')).toBe('$**');
    });

    it('uses $** for the projection scope', () => {
        expect(buildWildcardKey('projection', 'stale.parent.path')).toBe('$**');
    });

    it('appends $** to a normalized scoped path', () => {
        expect(buildWildcardKey('path', ' metadata.. ')).toBe('metadata.$**');
    });

    it('collapses an empty scoped path to the all-fields key', () => {
        expect(buildWildcardKey('path', '')).toBe('$**');
        expect(buildWildcardKey('path', '   ')).toBe('$**');
    });
});

describe('wildcard projection serialization', () => {
    it('maps included fields to 1 and skips blank rows', () => {
        expect(
            buildWildcardProjectionObject('include', [
                { id: 'a', field: 'name' },
                { id: 'b', field: '  ' },
                { id: 'c', field: 'metadata.category' },
            ]),
        ).toEqual({ name: 1, 'metadata.category': 1 });
    });

    it('maps excluded fields to 0', () => {
        expect(buildWildcardProjectionObject('exclude', [{ id: 'a', field: 'secret' }])).toEqual({ secret: 0 });
    });

    it('returns undefined when no field carries a value', () => {
        expect(buildWildcardProjectionObject('include', [{ id: 'a', field: '   ' }])).toBeUndefined();
        expect(buildWildcardProjectionObject('include', [])).toBeUndefined();
    });
});
