/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getOidcAllowedHosts } from '../auth/oidcAllowedHosts';
import { type MainToWorkerMessage } from './workerTypes';

export function getWorkerOidcAllowedHosts(
    msg: Pick<Extract<MainToWorkerMessage, { type: 'init' }>, 'connectionString' | 'oidcAllowedHosts'>,
): string[] {
    return [...(msg.oidcAllowedHosts ?? getOidcAllowedHosts(msg.connectionString))];
}
