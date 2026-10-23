/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CloudCategory } from '../documentdbTokenResource';

export interface EntraTokenFailureContext {
    readonly cloudCategory: CloudCategory;
    readonly authMethod: 'interactive' | 'managedIdentity';
}

export interface EntraTokenFailure extends EntraTokenFailureContext {
    readonly timestamp: number;
}

const failures = new Map<string, EntraTokenFailure>();

export function recordEntraTokenFailure(clusterId: string, context: EntraTokenFailureContext): void {
    failures.set(clusterId, {
        cloudCategory: context.cloudCategory,
        authMethod: context.authMethod,
        timestamp: Date.now(),
    });
}

export function getRecentEntraTokenFailure(clusterId: string, maxAgeMs = 10 * 60_000): EntraTokenFailure | undefined {
    const failure = failures.get(clusterId);
    if (failure && Date.now() - failure.timestamp > maxAgeMs) {
        failures.delete(clusterId);
        return undefined;
    }
    return failure;
}

export function resetEntraTokenFailuresForTests(): void {
    failures.clear();
}
