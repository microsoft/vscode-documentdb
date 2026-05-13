/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DocumentDB Query Language for Monaco Editor.
 *
 * This module provides the `documentdb-query` custom language that reuses
 * the JavaScript Monarch tokenizer for syntax highlighting while providing
 * custom completions from the `operator-registry` package.
 *
 * Usage:
 * ```typescript
 * import { registerDocumentDBQueryLanguage, LANGUAGE_ID } from './documentdbQuery';
 *
 * // During Monaco initialization:
 * await registerDocumentDBQueryLanguage(monaco);
 *
 * // In editor props:
 * <Editor language={LANGUAGE_ID} />
 * ```
 */

export {
    detectCursorContext,
    type CursorContext,
    type FieldTypeLookup,
} from '../../documentdb/query-language/shared/cursorContext';
export { clearCompletionContext, getCompletionContext, setCompletionContext } from './completionStore';
export { validateExpression, type Diagnostic } from './documentdbQueryValidator';
export { EditorType, LANGUAGE_ID, URI_SCHEME, buildEditorUri, parseEditorUri } from './languageConfig';
export { registerDocumentDBQueryLanguage } from './registerLanguage';
