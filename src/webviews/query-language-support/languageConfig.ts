/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Constants and configuration for the `documentdb-query` custom Monaco language.
 *
 * This language reuses the JavaScript Monarch tokenizer for syntax highlighting
 * but does NOT attach the TypeScript/JavaScript language service worker.
 * Completions are driven entirely by custom providers using `operator-registry`.
 */

/** The language identifier registered with Monaco. */
export const LANGUAGE_ID = 'documentdb-query';

/** URI scheme used for query editor models. */
export const URI_SCHEME = 'documentdb';

/**
 * Known editor types for URI-based routing.
 * The completion provider inspects `model.uri` to determine which
 * completions to offer.
 */
export enum EditorType {
    Filter = 'filter',
    Project = 'project',
    Sort = 'sort',
    Aggregation = 'aggregation',
}

/**
 * Builds a Monaco model URI for a given editor type and session.
 *
 * @param editorType - the type of query editor (filter, project, sort)
 * @param sessionId - unique session identifier for this editor instance
 * @returns a URI string like `documentdb://filter/session-abc-123`
 */
export function buildEditorUri(editorType: EditorType, sessionId: string): string {
    return `${URI_SCHEME}://${editorType}/${sessionId}`;
}

/**
 * Parses a Monaco model URI to extract the editor type.
 *
 * @param uri - the URI string (e.g., `documentdb://filter/session-abc-123`)
 * @returns the EditorType or undefined if the URI doesn't match
 */
export function parseEditorUri(uri: string): { editorType: EditorType; sessionId: string } | undefined {
    // Handle both URI objects and strings
    const uriString = typeof uri === 'string' ? uri : String(uri);

    const match = uriString.match(new RegExp(`^${URI_SCHEME}://([^/]+)/(.+)$`));
    if (!match) {
        return undefined;
    }

    const editorType = match[1] as EditorType;
    const sessionId = match[2];

    // Validate that it's a known editor type
    if (!Object.values(EditorType).includes(editorType)) {
        return undefined;
    }

    return { editorType, sessionId };
}
