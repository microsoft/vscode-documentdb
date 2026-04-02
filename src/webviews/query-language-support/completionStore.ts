/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldCompletionData } from '../../utils/json/data-api/autocomplete/toFieldCompletionItems';

/**
 * Completion context for a single editor session.
 * Holds dynamic field data fetched from the extension host after query execution.
 */
export interface CompletionContext {
    fields: FieldCompletionData[];
}

const store = new Map<string, CompletionContext>();

/** Update field data for a session (called after query execution). */
export function setCompletionContext(sessionId: string, context: CompletionContext): void {
    store.set(sessionId, context);
}

/** Get field data for a session. */
export function getCompletionContext(sessionId: string): CompletionContext | undefined {
    return store.get(sessionId);
}

/** Remove a session's data (called on tab close / dispose). */
export function clearCompletionContext(sessionId: string): void {
    store.delete(sessionId);
}

/** Clear all sessions (for testing). */
export function clearAllCompletionContexts(): void {
    store.clear();
}
