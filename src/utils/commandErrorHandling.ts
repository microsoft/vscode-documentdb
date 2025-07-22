/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    registerCommand,
    type CommandCallback,
    type IActionContext,
    type TreeNodeCommandCallback,
} from '@microsoft/vscode-azext-utils';
import { unwrapArgs } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';

/**
 * UserFacingError represents an error that should be prominently displayed to the user
 * in a modal dialog rather than a notification. Use this for critical errors that
 * require immediate user attention or action.
 *
 * Example usage:
 * ```
 * if (!isConnectionValid) {
 *   throw new UserFacingError('Connection failed. Please check your credentials and try again.');
 * }
 * ```
 */
export class UserFacingError extends Error {
    /**
     * Creates a new UserFacingError
     * @param message Error message to display to the user in a modal dialog
     * @param options Additional error options
     */
    constructor(
        message: string,
        public readonly options: {
            /** Original error that caused this error, if any */
            cause?: Error;
            /** Additional details that may be shown in the error dialog */
            details?: string;
        } = {},
    ) {
        super(message);
        this.name = 'UserFacingError';

        // Ensures proper stack traces in modern JS engines
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, UserFacingError);
        }
    }
}

/**
 * Registers a command that shows UserFacingErrors in modal dialogs rather than notifications.
 * All other error types continue to use the default error handling mechanism.
 *
 * This function should be used for commands where errors require immediate user attention,
 * such as connection failures or critical configuration issues.
 *
 * @param commandId The command ID to register
 * @param callback The command handler function
 * @param debounce Optional debounce time in milliseconds
 * @param telemetryId Optional custom telemetry ID
 */
export function registerCommandWithModalErrors(
    commandId: string,
    callback: CommandCallback,
    debounce?: number,
    telemetryId?: string,
): void {
    registerCommand(
        commandId,
        async (context: IActionContext, ...args: unknown[]) => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return await callback(context, ...args);
            } catch (error) {
                // Only handle UserFacingError specially
                if (error instanceof UserFacingError) {
                    // Suppress the default notification
                    context.errorHandling.suppressDisplay = true;

                    // Show a modal dialog instead
                    const message = error.message;

                    await vscode.window.showErrorMessage(message, {
                        modal: true,
                        detail: error.options.details,
                    });

                    // Preserve telemetry by re-throwing
                    throw error;
                }

                // For all other error types, just re-throw to use default handling
                throw error;
            }
        },
        debounce,
        telemetryId,
    );
}

/**
 * Registers a command that unwraps tree node arguments and shows UserFacingErrors in modal dialogs.
 * This combines the functionality of registerCommandWithTreeNodeUnwrapping and registerCommandWithModalErrors.
 *
 * Use this function for tree-based commands where critical errors should be displayed in modal dialogs
 * rather than notifications, such as connection operations or destructive actions.
 *
 * @param commandId The command ID to register
 * @param callback The command handler function that expects unwrapped tree node arguments
 * @param debounce Optional debounce time in milliseconds
 * @param telemetryId Optional custom telemetry ID
 */
export function registerCommandWithTreeNodeUnwrappingAndModalErrors<T>(
    commandId: string,
    callback: TreeNodeCommandCallback<T>,
    debounce?: number,
    telemetryId?: string,
): void {
    registerCommand(
        commandId,
        async (context: IActionContext, ...args: unknown[]) => {
            try {
                // Unwrap tree node arguments before passing to the callback
                return await callback(context, ...unwrapArgs<T>(args));
            } catch (error) {
                // Only handle UserFacingError specially
                if (error instanceof UserFacingError) {
                    // Suppress the default notification
                    context.errorHandling.suppressDisplay = true;

                    // Show a modal dialog instead
                    const message = error.message;

                    await vscode.window.showErrorMessage(message, {
                        modal: true,
                        detail: error.options.details,
                    });

                    // Preserve telemetry by re-throwing
                    throw error;
                }

                // For all other error types, just re-throw to use default handling
                throw error;
            }
        },
        debounce,
        telemetryId,
    );
}
