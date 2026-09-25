/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Wait before showing progress so brief operations do not create distracting notifications. */
export const PROGRESS_NOTIFICATION_DELAY_MS = 2000;

export function withProgress<T>(
    promise: Thenable<T>,
    title: string,
    location: vscode.ProgressLocation = vscode.ProgressLocation.Notification,
): Thenable<T> {
    return vscode.window.withProgress<T>(
        {
            location: location,
            title: title,
        },
        (_progress) => {
            return promise;
        },
    );
}

/**
 * Waits briefly before displaying cancellable progress for an operation already in flight.
 *
 * The operation begins immediately. If it finishes before the delay elapses, no notification is
 * shown; otherwise the existing operation is awaited behind a cancellable progress notification.
 */
export async function withDelayedProgress<T>(
    promise: Promise<T>,
    options: vscode.ProgressOptions,
    onCancellationRequested: () => void,
    delayMs: number = PROGRESS_NOTIFICATION_DELAY_MS,
): Promise<T> {
    let progressDelayTimer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            promise.then((value) => ({ completed: true as const, value })),
            new Promise<{ completed: false }>((resolve) => {
                progressDelayTimer = setTimeout(() => resolve({ completed: false }), delayMs);
            }),
        ]);

        if (result.completed) {
            return result.value;
        }

        return vscode.window.withProgress(options, (_progress, token) => {
            token.onCancellationRequested(onCancellationRequested);
            return promise;
        });
    } finally {
        if (progressDelayTimer) {
            clearTimeout(progressDelayTimer);
        }
    }
}
