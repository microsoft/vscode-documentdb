/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { MongoServerSelectionError } from 'mongodb';
import { type ErrorExplanationProvider, type ErrorExplanationRequest } from '../../../services/errorExplanationService';

export class EntraSignInRequiredErrorExplainer implements ErrorExplanationProvider {
    public readonly id = 'entraSignInRequired';

    public async explain({ error }: ErrorExplanationRequest): Promise<string | undefined> {
        const pending: unknown[] = [error];
        const visited = new Set<Error>();
        while (pending.length > 0) {
            const current = pending.pop();
            if (!(current instanceof Error) || visited.has(current)) {
                continue;
            }
            visited.add(current);

            switch (current.name) {
                case 'EntraSignInRequiredError':
                    return l10n.t('Your Microsoft sign-in for this connection expired. Sign in again to continue.');
                case 'EntraIdentityMismatchError':
                    return l10n.t('VS Code returned a different Microsoft account for this connection.');
            }

            if (current instanceof MongoServerSelectionError) {
                const servers = current.reason?.servers;
                if (servers instanceof Map) {
                    for (const description of servers.values()) {
                        pending.push(description?.error);
                    }
                }
            }
            pending.push(current.cause);
        }
        return undefined;
    }
}
