/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completion items for the `documentdb-query` language (Monaco-specific).
 *
 * This folder contains Monaco-specific completion logic:
 * - `createCompletionItems.ts` — main entry point, context branching
 * - `mapCompletionItems.ts` — operator/field → Monaco CompletionItem mapping
 * - `typeSuggestions.ts` — type-aware value suggestions (Monaco CompletionItems)
 * - `jsGlobals.ts` — JS globals as Monaco CompletionItems
 *
 * Platform-neutral logic (shared with query playground provider) lives in `src/documentdb/query-language/shared/`.
 */

// Re-export platform-neutral modules from shared/
export {
    INFO_INDICATOR,
    KEY_POSITION_OPERATORS,
    LABEL_PLACEHOLDER,
} from '../../../documentdb/query-language/shared/completionKnowledge';
export { escapeSnippetDollars, stripOuterBraces } from '../../../documentdb/query-language/shared/snippetUtils';
export { getCategoryLabel, getOperatorSortPrefix } from '../../../documentdb/query-language/shared/sortPrefixes';

// Monaco-specific exports
export {
    createCompletionItems,
    getMetaTagsForEditorType,
    type CreateCompletionItemsParams,
} from './createCompletionItems';
export { createJsGlobalCompletionItems } from './jsGlobals';
export { getCompletionKindForMeta, mapFieldToCompletionItem, mapOperatorToCompletionItem } from './mapCompletionItems';
export { createTypeSuggestions } from './typeSuggestions';
