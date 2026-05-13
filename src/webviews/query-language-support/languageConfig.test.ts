/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildEditorUri, EditorType, LANGUAGE_ID, parseEditorUri, URI_SCHEME } from './languageConfig';

describe('languageConfig', () => {
    describe('constants', () => {
        test('LANGUAGE_ID is "documentdb-query"', () => {
            expect(LANGUAGE_ID).toBe('documentdb-query');
        });

        test('URI_SCHEME is "documentdb"', () => {
            expect(URI_SCHEME).toBe('documentdb');
        });
    });

    describe('EditorType', () => {
        test('has expected enum values', () => {
            expect(EditorType.Filter).toBe('filter');
            expect(EditorType.Project).toBe('project');
            expect(EditorType.Sort).toBe('sort');
            expect(EditorType.Aggregation).toBe('aggregation');
        });
    });

    describe('buildEditorUri', () => {
        test('builds filter URI with session ID', () => {
            const uri = buildEditorUri(EditorType.Filter, 'session-abc-123');
            expect(uri).toBe('documentdb://filter/session-abc-123');
        });

        test('builds project URI with session ID', () => {
            const uri = buildEditorUri(EditorType.Project, 'my-session');
            expect(uri).toBe('documentdb://project/my-session');
        });

        test('builds sort URI with session ID', () => {
            const uri = buildEditorUri(EditorType.Sort, 'sess-1');
            expect(uri).toBe('documentdb://sort/sess-1');
        });

        test('builds aggregation URI with session ID', () => {
            const uri = buildEditorUri(EditorType.Aggregation, 'agg-session');
            expect(uri).toBe('documentdb://aggregation/agg-session');
        });
    });

    describe('parseEditorUri', () => {
        test('parses valid filter URI', () => {
            const result = parseEditorUri('documentdb://filter/session-abc-123');
            expect(result).toEqual({
                editorType: EditorType.Filter,
                sessionId: 'session-abc-123',
            });
        });

        test('parses valid project URI', () => {
            const result = parseEditorUri('documentdb://project/my-session');
            expect(result).toEqual({
                editorType: EditorType.Project,
                sessionId: 'my-session',
            });
        });

        test('parses valid sort URI', () => {
            const result = parseEditorUri('documentdb://sort/sess-1');
            expect(result).toEqual({
                editorType: EditorType.Sort,
                sessionId: 'sess-1',
            });
        });

        test('parses valid aggregation URI', () => {
            const result = parseEditorUri('documentdb://aggregation/agg-123');
            expect(result).toEqual({
                editorType: EditorType.Aggregation,
                sessionId: 'agg-123',
            });
        });

        test('returns undefined for unrecognized scheme', () => {
            const result = parseEditorUri('vscode://filter/session-1');
            expect(result).toBeUndefined();
        });

        test('returns undefined for unknown editor type', () => {
            const result = parseEditorUri('documentdb://unknown/session-1');
            expect(result).toBeUndefined();
        });

        test('returns undefined for malformed URI (no session)', () => {
            const result = parseEditorUri('documentdb://filter');
            expect(result).toBeUndefined();
        });

        test('returns undefined for empty string', () => {
            const result = parseEditorUri('');
            expect(result).toBeUndefined();
        });

        test('roundtrips with buildEditorUri', () => {
            for (const editorType of Object.values(EditorType)) {
                const sessionId = `test-session-${editorType}`;
                const uri = buildEditorUri(editorType, sessionId);
                const parsed = parseEditorUri(uri);
                expect(parsed).toEqual({ editorType, sessionId });
            }
        });
    });
});
