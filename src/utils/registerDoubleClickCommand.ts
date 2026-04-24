/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    registerCommand,
    type CommandCallback,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';

/**
 * Registers a command that requires a double-click to execute.
 * The first click starts a timer; if a second click arrives within the delay, the command executes.
 * If no second click arrives, the command is not executed.
 *
 * This is the inverse of the library's debounce behavior (which fires immediately and blocks subsequent calls).
 *
 * @param commandId The command ID to register
 * @param callback The command handler function
 * @param delay The double-click detection window in milliseconds
 * @param telemetryId Optional custom telemetry ID
 */
export function registerDoubleClickCommand(
    commandId: string,
    callback: CommandCallback,
    delay: number,
    telemetryId?: string,
): void {
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;

    registerCommand(
        commandId,
        (context: IActionContext, ...args: unknown[]) => {
            if (pendingTimer) {
                // Second click within the window — execute now
                clearTimeout(pendingTimer);
                pendingTimer = undefined;

                // Suppress telemetry for this "gate" context since the real
                // telemetry is sent by the inner callWithTelemetryAndErrorHandling
                context.telemetry.suppressAll = true;
                context.errorHandling.suppressDisplay = true;

                // Fire the actual command in its own telemetry context
                void callWithTelemetryAndErrorHandling(telemetryId ?? commandId, async (innerContext) => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                    return callback(innerContext, ...args);
                });
                return;
            }

            // First click — start the timer, suppress this invocation entirely
            context.telemetry.suppressAll = true;
            context.errorHandling.suppressDisplay = true;

            pendingTimer = setTimeout(() => {
                pendingTimer = undefined;
            }, delay);
        },
        undefined,
        telemetryId,
    );
}
