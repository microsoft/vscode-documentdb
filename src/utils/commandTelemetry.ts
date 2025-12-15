/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CommandCallback, type IActionContext, type TreeNodeCommandCallback } from '@microsoft/vscode-azext-utils';

interface HasJourneyCorrelationId {
    journeyCorrelationId?: string;
}

function tryExtractJourneyCorrelationId(maybeNode: unknown): string | undefined {
    if (maybeNode && typeof maybeNode === 'object') {
        const value = (maybeNode as HasJourneyCorrelationId).journeyCorrelationId;
        if (value) {
            return value;
        }
    }
    return undefined;
}

export function trackJourneyCorrelationId(context: IActionContext, ...args: unknown[]): void {
    for (const arg of args) {
        const correlationId = tryExtractJourneyCorrelationId(arg);
        if (correlationId) {
            context.telemetry.properties.journeyCorrelationId = correlationId;
            return;
        }
    }
}

export function withCommandCorrelation<T extends CommandCallback>(callback: T): T {
    const wrapper = (context: IActionContext, ...args: unknown[]) => {
        trackJourneyCorrelationId(context, ...args);
        // CommandCallback returns 'any', which we pass through unchanged, the exception below is required.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return callback(context, ...args);
    };
    return wrapper as T;
}

export function withTreeNodeCommandCorrelation<T extends TreeNodeCommandCallback<unknown>>(callback: T): T {
    const wrapper = (context: IActionContext, ...args: unknown[]) => {
        trackJourneyCorrelationId(context, ...args);
        // TreeNodeCommandCallback returns 'unknown', which we pass through unchanged, no need or eslint-exception here.
        return callback(context, ...args);
    };
    return wrapper as T;
}
