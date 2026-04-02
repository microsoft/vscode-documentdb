/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Platform-neutral completion data interfaces.
 *
 * These types define the shared contract for completion item data that is
 * independent of any specific editor API (Monaco or VS Code). Platform-specific
 * mappers convert these types to their respective CompletionItem types.
 *
 * Currently serves as the documented interface contract. The webview and
 * scratchpad providers use the shared primitives (getOperatorSortPrefix,
 * getTypeSuggestionDefs, etc.) directly rather than routing through a
 * `CompletionData[]` intermediary — this avoids an unnecessary abstraction
 * layer while both providers are already functional.
 *
 * When a third consumer is added (e.g., interactive shell), this interface
 * can be promoted to the primary data flow.
 */

/**
 * Platform-neutral completion item data.
 *
 * Both Monaco and VS Code mappers can consume this to produce
 * their respective completion items.
 */
export interface CompletionData {
    /** Display label */
    label: string;
    /** Short description shown right-aligned or as subtitle */
    description?: string;
    /** Detail text (e.g., type info for fields) */
    detail?: string;
    /** Documentation markdown content */
    documentation?: string;
    /** External documentation link */
    documentationLink?: string;
    /** Text or snippet to insert */
    insertText: string;
    /** Whether insertText contains snippet tab stops */
    isSnippet: boolean;
    /** Sort prefix for ordering in the completion list */
    sortPrefix: string;
    /** Semantic kind of the completion item */
    kind: CompletionKind;
    /** Whether this item should be preselected in the list */
    preselect?: boolean;
}

/**
 * Semantic kinds for completion items.
 *
 * Platform-specific mappers convert these to the appropriate enum
 * values for Monaco or VS Code.
 */
export enum CompletionKind {
    Field = 'field',
    Operator = 'operator',
    Constructor = 'constructor',
    Method = 'method',
    Module = 'module',
    Variable = 'variable',
    Value = 'value',
    Event = 'event',
    Snippet = 'snippet',
    Constant = 'constant',
}
