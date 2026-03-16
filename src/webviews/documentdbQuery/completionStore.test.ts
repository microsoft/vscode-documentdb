/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    clearAllCompletionContexts,
    clearCompletionContext,
    getCompletionContext,
    setCompletionContext,
} from './completionStore';

describe('completionStore', () => {
    beforeEach(() => {
        clearAllCompletionContexts();
    });

    test('setCompletionContext then getCompletionContext round-trips correctly', () => {
        const context = {
            fields: [
                {
                    fieldName: 'name',
                    displayType: 'String',
                    bsonType: 'string',
                    isSparse: false,
                    insertText: 'name',
                    referenceText: '$name',
                },
            ],
        };

        setCompletionContext('session-1', context);
        expect(getCompletionContext('session-1')).toEqual(context);
    });

    test('getCompletionContext returns undefined for unknown session', () => {
        expect(getCompletionContext('unknown')).toBeUndefined();
    });

    test('clearCompletionContext removes the entry', () => {
        setCompletionContext('session-1', { fields: [] });
        expect(getCompletionContext('session-1')).toBeDefined();

        clearCompletionContext('session-1');
        expect(getCompletionContext('session-1')).toBeUndefined();
    });

    test('clearCompletionContext is a no-op for unknown session', () => {
        expect(() => clearCompletionContext('unknown')).not.toThrow();
    });

    test('clearAllCompletionContexts removes all entries', () => {
        setCompletionContext('session-1', { fields: [] });
        setCompletionContext('session-2', { fields: [] });

        clearAllCompletionContexts();

        expect(getCompletionContext('session-1')).toBeUndefined();
        expect(getCompletionContext('session-2')).toBeUndefined();
    });

    test('setCompletionContext overwrites existing data', () => {
        const original = {
            fields: [
                {
                    fieldName: 'old',
                    displayType: 'String',
                    bsonType: 'string',
                    isSparse: false,
                    insertText: 'old',
                    referenceText: '$old',
                },
            ],
        };
        const updated = {
            fields: [
                {
                    fieldName: 'new',
                    displayType: 'Number',
                    bsonType: 'double',
                    isSparse: true,
                    insertText: 'new',
                    referenceText: '$new',
                },
            ],
        };

        setCompletionContext('session-1', original);
        setCompletionContext('session-1', updated);

        expect(getCompletionContext('session-1')).toEqual(updated);
    });

    test('multiple sessions are independent', () => {
        const ctx1 = {
            fields: [
                {
                    fieldName: 'a',
                    displayType: 'String',
                    bsonType: 'string',
                    isSparse: false,
                    insertText: 'a',
                    referenceText: '$a',
                },
            ],
        };
        const ctx2 = {
            fields: [
                {
                    fieldName: 'b',
                    displayType: 'Number',
                    bsonType: 'int',
                    isSparse: true,
                    insertText: 'b',
                    referenceText: '$b',
                },
            ],
        };

        setCompletionContext('session-1', ctx1);
        setCompletionContext('session-2', ctx2);

        expect(getCompletionContext('session-1')).toEqual(ctx1);
        expect(getCompletionContext('session-2')).toEqual(ctx2);
    });
});
