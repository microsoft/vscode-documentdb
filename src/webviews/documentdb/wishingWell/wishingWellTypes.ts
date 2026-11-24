/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** What a granted wish turned into. The webview picks the card's icon from it. */
export type WishKind =
    | 'answer'
    | 'query'
    | 'view'
    | 'shell'
    | 'playground'
    | 'document'
    | 'tool'
    | 'command'
    | 'agent'
    | 'link'
    | 'trivia'
    | 'tip'
    | 'fortune';

export type WishStatus = 'answered' | 'proposed' | 'refused' | 'info';

/** The well's reply to one wish or lucky draw. Serialized across the webview boundary. */
export interface WishOutcome {
    readonly id: string;
    readonly kind: WishKind;
    readonly title: string;
    readonly message: string;
    /** Code or document shown verbatim under the message. */
    readonly detail?: string;
    /** Present when the outcome needs one click to happen; the host keeps what that click does. */
    readonly actionLabel?: string;
    /** Says exactly what the action will do, so nothing happens behind the user's back. */
    readonly actionHint?: string;
    /** How many documents or result rows a read-only query returned; `detail` shows them. */
    readonly resultCount?: number;
    /** `detail` was cut to fit; it ends on a whole document. */
    readonly truncated?: boolean;
    /** The read hit its row cap, so more rows exist than `resultCount`. */
    readonly capped?: boolean;
    /** The user's own words, echoed on the card. Absent for lucky draws. */
    readonly wish?: string;
    /**
     * answered: a read already ran (opening it is optional). proposed: waits for a grant.
     * refused: nothing to grant, `message` says why. info: nothing to do (answers, fortunes).
     */
    readonly status: WishStatus;
    /** Who read the wish: Copilot, the built-in fallback (and lucky draws), or the calling agent's own spell. */
    readonly interpretedBy: 'copilot' | 'well' | 'agent';
}

export interface WishingWellStatus {
    /** Whether typed wishes are read by Copilot or only by the keyword fallback. */
    readonly copilotAvailable: boolean;
    /** Example wishes the well can really grant in this scope and mode. */
    readonly examples: readonly string[];
}

export interface WishingWellWebviewConfig {
    /** Set when the well was opened on a cluster: lucky draws can then peek at its data. */
    readonly clusterDisplayName?: string;
    readonly databaseName?: string;
    readonly collectionName?: string;
}
