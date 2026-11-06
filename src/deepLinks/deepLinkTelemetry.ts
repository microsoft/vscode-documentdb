/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface DeepLinkTelemetry {
    readonly deepLinkCorrelationId: string;
    readonly deepLinkSource?: string;
}

export interface DeepLinkOpenOptions {
    readonly deepLink?: DeepLinkTelemetry;
}

export interface DeepLinkOpenResult {
    readonly opened: boolean;
    readonly canceled?: boolean;
    readonly shellSessionId?: string;
    readonly dashboardSessionId?: string;
    readonly panelReused?: boolean;
}

export function readDeepLinkTelemetry(value: unknown): DeepLinkTelemetry | undefined {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('deepLinkCorrelationId' in value) ||
        typeof value.deepLinkCorrelationId !== 'string'
    ) {
        return undefined;
    }
    return {
        deepLinkCorrelationId: value.deepLinkCorrelationId,
        ...('deepLinkSource' in value && typeof value.deepLinkSource === 'string'
            ? { deepLinkSource: value.deepLinkSource }
            : {}),
    };
}

export function trackDeepLinkTelemetry(context: IActionContext, details: DeepLinkTelemetry | undefined): void {
    if (details) {
        Object.assign(context.telemetry.properties, details, { activationSource: 'deepLink' });
    }
}

/** Source is publisher-supplied metadata, never a URL, resource locator, or free-form text. */
export function recordDeepLinkSource(context: IActionContext, params: URLSearchParams): void {
    const sources = params.getAll('source');
    if (sources.length === 0) {
        context.telemetry.properties.deepLinkSourceStatus = 'absent';
    } else if (
        sources.length === 1 &&
        sources[0] === sources[0].trim() &&
        /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(sources[0])
    ) {
        context.telemetry.properties.deepLinkSourceStatus = 'valid';
        context.telemetry.properties.deepLinkSource = sources[0].toLowerCase();
    } else {
        context.telemetry.properties.deepLinkSourceStatus = 'invalid';
        context.valuesToMask.push(...sources.filter(Boolean));
    }
}

export function cancelDeepLink(context: IActionContext, step: string): void {
    context.telemetry.properties.userCancelledAtStep = step;
    context.telemetry.properties.deepLinkOutcome = 'canceled';
    context.telemetry.properties.result = 'Canceled';
}

export function failDeepLink(
    context: IActionContext,
    outcome: 'connectionFailed' | 'destinationFailed',
    reason: string,
): void {
    if (context.telemetry.properties.deepLinkOutcome === 'canceled') {
        return;
    }
    context.telemetry.properties.deepLinkOutcome = outcome;
    context.telemetry.properties.errorReason = reason;
    context.telemetry.properties.result = 'Failed';
}

/** Keep the attempt id even when the failed client has already been evicted from the cache. */
export function recordDeepLinkConnectionAttempt(context: IActionContext, node: unknown): void {
    if (!context.telemetry.properties.deepLinkCorrelationId || typeof node !== 'object' || node === null) {
        return;
    }
    if ('lastConnectionCorrelationId' in node && typeof node.lastConnectionCorrelationId === 'string') {
        context.telemetry.properties.connectionCorrelationId = node.lastConnectionCorrelationId;
    }
    if ('lastConnectionOutcome' in node && node.lastConnectionOutcome === 'canceled') {
        cancelDeepLink(context, 'ConnectCluster');
    }
}

/** Accumulate phase time across retries; the framework still owns total event duration. */
export async function measureDeepLinkPhase<T>(
    context: IActionContext,
    phase: string,
    operation: () => PromiseLike<T>,
): Promise<T> {
    const start = Date.now();
    try {
        return await operation();
    } finally {
        const key = `${phase}TimeMs`;
        context.telemetry.measurements[key] = (context.telemetry.measurements[key] ?? 0) + Date.now() - start;
    }
}
