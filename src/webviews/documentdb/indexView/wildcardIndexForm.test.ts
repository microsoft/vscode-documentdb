/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    applyConfirmedWildcardTransition,
    applyWildcardConfirmationResult,
    createInitialIndexFormState,
    disableWildcardMode,
    getEnableWildcardImpact,
    getWildcardActivationDecision,
    setWildcardPath,
    setWildcardScope,
} from './wildcardIndexForm';

const createFieldId = (): string => 'test-field';

describe('wildcard index form transitions', () => {
    it('enables a pristine form without confirmation', () => {
        expect(getWildcardActivationDecision(createInitialIndexFormState(createFieldId), false)).toBe('enable');
    });

    it('requires confirmation for selected ordinary fields', () => {
        const state = createInitialIndexFormState(createFieldId);
        state.fields = [{ id: 'name', field: 'name', type: 'desc' }];
        expect(getWildcardActivationDecision(state, false)).toBe('confirm');
    });

    it.each(['unique', 'sparse', 'ttlEnabled', 'ttlConfigured'] as const)(
        'requires confirmation when %s is set',
        (option) => {
            const state = { ...createInitialIndexFormState(createFieldId), [option]: true };
            expect(getWildcardActivationDecision(state, false)).toBe('confirm');
        },
    );

    it('computes the exact destructive and retained impact', () => {
        const state = {
            ...createInitialIndexFormState(createFieldId),
            fields: [
                { id: 'name', field: 'name', type: 'asc' as const },
                { id: 'category', field: 'metadata.category', type: 'text' as const },
            ],
            unique: true,
            sparse: true,
            ttlConfigured: true,
            name: 'custom_name',
            nameEnabled: true,
            partialText: '{ active: true }',
            collationText: "{ locale: 'en' }",
        };

        expect(getEnableWildcardImpact(state)).toEqual({
            fields: [
                { field: 'name', type: 'asc' },
                { field: 'metadata.category', type: 'text' },
            ],
            clearUnique: true,
            clearSparse: true,
            clearTtl: true,
            retainName: true,
            retainPartialFilter: true,
            retainCollation: true,
        });
    });

    it('preserves the complete original state on cancellation', () => {
        const state = {
            ...createInitialIndexFormState(createFieldId),
            fields: [{ id: 'name', field: 'name', type: 'desc' as const }],
            unique: true,
            name: 'custom_name',
        };
        expect(applyWildcardConfirmationResult(state, false, createFieldId)).toBe(state);
    });

    it('replaces fields and clears only incompatible settings on confirmation', () => {
        const state = {
            ...createInitialIndexFormState(createFieldId),
            fields: [{ id: 'name', field: 'name', type: 'desc' as const }],
            unique: true,
            sparse: true,
            ttlEnabled: true,
            ttlSeconds: '60',
            ttlConfigured: true,
            name: 'custom_name',
            nameEnabled: true,
            partialText: '{ active: true }',
            collationText: "{ locale: 'en' }",
        };

        const result = applyConfirmedWildcardTransition(state, createFieldId);

        expect(result.fields).toEqual([{ id: 'test-field', field: '$**', type: 'asc' }]);
        expect(result).toMatchObject({
            unique: false,
            sparse: false,
            ttlEnabled: false,
            ttlSeconds: '3600',
            ttlConfigured: false,
            wildcardEnabled: true,
            name: 'custom_name',
            nameEnabled: true,
            partialText: '{ active: true }',
            collationText: "{ locale: 'en' }",
        });
    });

    it('normalizes a scoped parent path into one generated key', () => {
        let state = createInitialIndexFormState(createFieldId);
        state = applyConfirmedWildcardTransition(state, createFieldId);
        state = setWildcardScope(state, 'path');
        state = setWildcardPath(state, ' metadata.. ');
        expect(state.fields[0].field).toBe('metadata.$**');
    });

    it('returns to one blank ascending field when wildcard mode is disabled', () => {
        const enabled = applyConfirmedWildcardTransition(createInitialIndexFormState(createFieldId), createFieldId);
        expect(disableWildcardMode(enabled, createFieldId).fields).toEqual([
            { id: 'test-field', field: '', type: 'asc' },
        ]);
    });

    it('resets all wildcard state', () => {
        const reset = createInitialIndexFormState(createFieldId);
        expect(reset).toMatchObject({
            wildcardEnabled: false,
            wildcardScope: 'all',
            wildcardPath: '',
            wildcardProjectionText: '{  }',
        });
    });

    it('blocks repeated activation while confirmation is pending', () => {
        expect(getWildcardActivationDecision(createInitialIndexFormState(createFieldId), true)).toBe('blocked');
    });
});
