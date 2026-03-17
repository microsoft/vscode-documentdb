/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completion items for the `documentdb-query` language.
 *
 * This folder contains context-sensitive completion logic:
 * - `createCompletionItems.ts` — main entry point, context branching
 * - `mapCompletionItems.ts` — operator/field → CompletionItem mapping
 * - `typeSuggestions.ts` — type-aware value suggestions (bool → true/false, etc.)
 * - `jsGlobals.ts` — JS globals available in the shell-bson-parser sandbox (Date, Math, etc.)
 * - `snippetUtils.ts` — snippet text manipulation (brace stripping, $ escaping)
 */

export { INFO_INDICATOR, LABEL_PLACEHOLDER } from './completionKnowledge';
export {
    createCompletionItems,
    getMetaTagsForEditorType, KEY_POSITION_OPERATORS, type CreateCompletionItemsParams
} from './createCompletionItems';
export { createJsGlobalCompletionItems } from './jsGlobals';
export {
    getCategoryLabel,
    getCompletionKindForMeta,
    getOperatorSortPrefix,
    mapFieldToCompletionItem,
    mapOperatorToCompletionItem
} from './mapCompletionItems';
export { escapeSnippetDollars, stripOuterBraces } from './snippetUtils';
export { createTypeSuggestions } from './typeSuggestions';

