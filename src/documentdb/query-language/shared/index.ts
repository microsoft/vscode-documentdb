/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared completion logic — platform-neutral modules.
 *
 * This folder contains completion logic that has NO dependency on Monaco or
 * VS Code APIs. Both the webview (Monaco) and scratchpad (VS Code) completion
 * providers import from here.
 *
 * Modules:
 * - `completionKnowledge` — KEY_POSITION_OPERATORS, placeholder constants
 * - `snippetUtils` — brace stripping, `$` escaping for snippets
 * - `sortPrefixes` — operator sort tier computation
 * - `cursorContext` — heuristic cursor position detection (key/value/operator)
 * - `extractQuotedKey` — quoted key extraction for hover range
 * - `typeSuggestionData` — type-aware value suggestion definitions
 * - `jsGlobalDefs` — JS global completion definitions (Date, Math, etc.)
 */

// Pure data and constants
export { INFO_INDICATOR, KEY_POSITION_OPERATORS, LABEL_PLACEHOLDER } from './completionKnowledge';
export { escapeSnippetDollars, stripOuterBraces } from './snippetUtils';

// Sort logic
export { getCategoryLabel, getOperatorSortPrefix } from './sortPrefixes';

// Cursor context detection
export { detectCursorContext, type CursorContext, type FieldTypeLookup } from './cursorContext';

// Quoted key extraction
export { extractQuotedKey } from './extractQuotedKey';

// Type suggestion data
export { getTypeSuggestionDefs, type TypeSuggestionDef } from './typeSuggestionData';

// JS global definitions
export { JS_GLOBALS, type JsGlobalDef } from './jsGlobalDefs';

// Platform-neutral completion data types
export { CompletionKind, type CompletionData } from './types';
