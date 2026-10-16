/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue, type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { createGenericElementWithContext } from './createGenericElementWithContext';

/**
 * Canonical building blocks for "retry" error-recovery nodes used across all tree views.
 *
 * Many tree elements append a clickable "retry" node when they fail to load their children, and
 * their branch data providers detect that node to cache the failed state (instead of re-running the
 * failing operation on every expand). Historically each view hand-rolled both the node and the
 * detector, which drifted in id suffix (`/retry` vs `/reconnect`) and detection robustness
 * (contextValue-only vs suffix + contextValue). This module is the single source of truth.
 *
 * A retry node is identified by BOTH:
 * - an id ending in {@link RETRY_NODE_ID_SUFFIX}, and
 * - a contextValue of {@link RETRY_NODE_CONTEXT_VALUE}.
 *
 * Requiring both lets an element render additional `contextValue: 'error'` companion nodes (e.g.
 * "open shell", "edit source") alongside the retry node without them being mistaken for it.
 */

/** Context-value carried by retry nodes (also drives the error styling in the tree). */
export const RETRY_NODE_CONTEXT_VALUE = 'error';

/** Id suffix that marks a node as the "retry" recovery node. */
export const RETRY_NODE_ID_SUFFIX = '/retry';

/** Command a retry node invokes by default: re-run the parent's `getChildren`. */
const DEFAULT_RETRY_COMMAND_ID = 'vscode-documentdb.command.internal.retry';

/**
 * Builds the canonical "Click here to retry" recovery node.
 *
 * @param parentId Id of the failing element; the retry node's id is `${parentId}${RETRY_NODE_ID_SUFFIX}`.
 * @param retryTarget Element passed as the command argument (usually the failing element, `this`).
 * @param options.commandId Overrides the default retry command for views that reload differently
 *   (e.g. a Kubernetes source reload) while still presenting a "retry" affordance.
 */
export function createRetryNode(
    parentId: string,
    retryTarget: unknown,
    options?: { readonly commandId?: string },
): TreeElement & TreeElementWithContextValue {
    return createGenericElementWithContext({
        contextValue: RETRY_NODE_CONTEXT_VALUE,
        id: `${parentId}${RETRY_NODE_ID_SUFFIX}`,
        label: vscode.l10n.t('Click here to retry'),
        iconPath: new vscode.ThemeIcon('refresh'),
        commandId: options?.commandId ?? DEFAULT_RETRY_COMMAND_ID,
        commandArgs: [retryTarget],
    });
}

/**
 * Robustly detects whether a children array contains a retry node (see module doc for the contract).
 *
 * The `typeof child.id === 'string'` guard is required because temporary nodes added during
 * `showCreatingChild` may lack an `id`.
 */
export function containsRetryNode(children: TreeElement[] | null | undefined): boolean {
    return (
        children?.some(
            (child) =>
                typeof child.id === 'string' &&
                child.id.endsWith(RETRY_NODE_ID_SUFFIX) &&
                isTreeElementWithContextValue(child) &&
                child.contextValue === RETRY_NODE_CONTEXT_VALUE,
        ) ?? false
    );
}
