/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ConnectionBinding } from './ClustersClient';

const retiredThroughGeneration = new Map<string, number>();

export function retireConnectionBindings(clusterId: string, generation: number): void {
    retiredThroughGeneration.set(clusterId, Math.max(retiredThroughGeneration.get(clusterId) ?? 0, generation));
}

export function isRetiredConnectionBinding({ clusterId, generation }: ConnectionBinding): boolean {
    const retiredThrough = retiredThroughGeneration.get(clusterId);
    return retiredThrough !== undefined && generation <= retiredThrough;
}
