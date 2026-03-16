/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Barrel re-export for the completions module.
 *
 * The completion provider logic has been refactored into the `completions/` folder:
 * - `completions/createCompletionItems.ts` — main entry point, context branching
 * - `completions/mapCompletionItems.ts` — operator/field → CompletionItem mapping
 * - `completions/typeSuggestions.ts` — type-aware value suggestions
 * - `completions/snippetUtils.ts` — snippet text manipulation
 *
 * This file preserves the original import path for existing consumers.
 */

// eslint-disable-next-line no-restricted-exports
export {
    KEY_POSITION_OPERATORS,
    createCompletionItems,
    createTypeSuggestions,
    escapeSnippetDollars,
    getCategoryLabel,
    getCompletionKindForMeta,
    getMetaTagsForEditorType,
    getOperatorSortPrefix,
    mapFieldToCompletionItem,
    mapOperatorToCompletionItem,
    stripOuterBraces,
    type CreateCompletionItemsParams,
} from './completions';
