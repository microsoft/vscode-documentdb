/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMechanism } from 'mongodb';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';

export function removeConflictingOidcMechanism(connectionString: string): string {
    const parsed = new DocumentDBConnectionString(connectionString);
    const entries = [...parsed.searchParams.entries()];
    const hasOidcMechanism = entries.some(([key, value]) => {
        if (key.toLowerCase() !== 'authmechanism') {
            return false;
        }
        if (value.trim().toUpperCase() === AuthMechanism.MONGODB_OIDC) {
            return true;
        }
        // Match the driver's raw-value regex and enum order, including native first matches.
        const pattern = new RegExp(String.raw`\b${value}\b`, 'i');
        return Object.values(AuthMechanism).find((mechanism) => pattern.test(mechanism)) === AuthMechanism.MONGODB_OIDC;
    });
    if (!hasOidcMechanism) {
        return connectionString;
    }

    // The URI wrapper folds case for lookups, but a single delete can leave other spellings.
    for (const [key] of entries) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'authmechanism' || lowerKey === 'authmechanismproperties') {
            parsed.searchParams.delete(key);
        }
    }
    return parsed.toString();
}
