/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { collectionNameToCompletionItem } from './PlaygroundCompletionItemProvider';

describe('collectionNameToCompletionItem', () => {
    it('uses bare name for a simple identifier', () => {
        const item = collectionNameToCompletionItem('stores');
        expect(item.label).toBe('stores');
        expect(item.insertText).toBeUndefined();
        expect(item.filterText).toBeUndefined();
        expect(item.kind).toBe(vscode.CompletionItemKind.Module);
        expect(item.detail).toBe('discovered collection');
    });

    it('uses getCollection for a name with spaces', () => {
        const item = collectionNameToCompletionItem('my collection');
        expect(item.label).toBe('my collection');
        expect(item.insertText).toBe("getCollection('my collection')");
        expect(item.filterText).toBe('my collection');
    });

    it('uses getCollection for a name with parentheses', () => {
        const item = collectionNameToCompletionItem('stores (10)');
        expect(item.label).toBe('stores (10)');
        expect(item.insertText).toBe("getCollection('stores (10)')");
        expect(item.filterText).toBe('stores (10)');
    });

    it('uses getCollection for a name starting with a digit', () => {
        const item = collectionNameToCompletionItem('123abc');
        expect(item.label).toBe('123abc');
        expect(item.insertText).toBe("getCollection('123abc')");
    });

    it('uses getCollection for a name with hyphens', () => {
        const item = collectionNameToCompletionItem('my-collection');
        expect(item.label).toBe('my-collection');
        expect(item.insertText).toBe("getCollection('my-collection')");
    });

    it('uses getCollection for a name with dots', () => {
        const item = collectionNameToCompletionItem('system.users');
        expect(item.label).toBe('system.users');
        expect(item.insertText).toBe("getCollection('system.users')");
    });

    it('escapes single quotes inside collection names', () => {
        const item = collectionNameToCompletionItem("it's");
        expect(item.insertText).toBe("getCollection('it\\'s')");
    });

    it('escapes backslashes inside collection names', () => {
        const item = collectionNameToCompletionItem('path\\to');
        expect(item.insertText).toBe("getCollection('path\\\\to')");
    });

    it('uses bare name for underscored identifiers', () => {
        const item = collectionNameToCompletionItem('_internal');
        expect(item.insertText).toBeUndefined();
    });

    it('uses bare name for dollar-prefixed identifiers', () => {
        const item = collectionNameToCompletionItem('$special');
        expect(item.insertText).toBeUndefined();
    });

    it('preserves sort text', () => {
        const item = collectionNameToCompletionItem('stores (10)');
        expect(item.sortText).toBe('!0_stores (10)');
    });
});
