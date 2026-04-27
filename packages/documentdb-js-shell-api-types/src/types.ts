/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shell API method entry describing a single method available on a
 * DocumentDB shell object (database, collection, or cursor).
 */
export interface ShellMethodEntry {
    /** The method name as it appears in code (e.g., 'find', 'insertOne'). */
    readonly name: string;
    /** The shell object this method belongs to. */
    readonly target: 'database' | 'collection' | 'findCursor' | 'aggregationCursor' | 'global';
    /** The underlying server command(s) this method maps to. */
    readonly serverCommands: readonly string[];
    /**
     * Whether this method is shell-only (no direct server command).
     * Shell-only methods are utility functions that don't send a command
     * to the server (e.g., cursor iteration helpers, display functions).
     */
    readonly shellOnly: boolean;
    /** Brief description of what the method does. */
    readonly description: string;
}
