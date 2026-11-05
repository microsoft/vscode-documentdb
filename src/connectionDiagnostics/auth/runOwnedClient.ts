/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClient } from 'mongodb';

/**
 * Host-only holder for the short-lived client a troubleshooter run creates when authentication
 * succeeds. Later checks of the same run use it; the run's cleanup closes it. Never shared with
 * `ClustersClient`, never cached, never part of results, events or telemetry.
 */
export interface RunOwnedClient {
    client?: MongoClient;
    authError?: unknown;
}

export function createRunOwnedClient(): RunOwnedClient {
    return {};
}
