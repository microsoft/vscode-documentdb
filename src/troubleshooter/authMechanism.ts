/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CheckResult } from '@documentdb-js/connectivity-troubleshooter';
import { type PanelAuthMethod } from '../webviews/documentdb/connectivityTroubleshooter/panelTypes';
import { type FindingCode } from './types';

const authMethods = {
    NativeAuth: 'native',
    MicrosoftEntraID: 'entraId',
    ManagedIdentity: 'managedIdentity',
    NoAuth: 'none',
} as const;

/** The panel's name for a check's `authMethod` fact; `undefined` for an unknown method. */
export function knownAuthMethod(value: unknown): PanelAuthMethod | undefined {
    return typeof value === 'string' && Object.hasOwn(authMethods, value)
        ? authMethods[value as keyof typeof authMethods]
        : undefined;
}

function offeredMechanisms(result: CheckResult<FindingCode>): string[] {
    const value = result.facts.saslSupportedMechs;
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        : [];
}

/**
 * The password mechanism the driver picks when none is configured, from what the server offered
 * in the greeting (the driver's `getDefaultAuthMechanism`). `undefined` when no list was offered:
 * an empty list cannot be told apart from no list, and the driver treats those differently.
 */
function negotiatedMechanism(context: readonly CheckResult<FindingCode>[]): string | undefined {
    const offered = context
        .filter((result): boolean => result.checkId === 'hello' && result.status === 'pass')
        .map(offeredMechanisms)
        .find((mechanisms): boolean => mechanisms.length > 0);
    if (!offered) {
        return undefined;
    }
    return offered.includes('SCRAM-SHA-256') ? 'SCRAM-SHA-256' : 'SCRAM-SHA-1';
}

export interface AuthMechanism {
    /** The full mechanism name, such as `SCRAM-SHA-256` or `MONGODB-OIDC`. */
    readonly mechanism: string;
    /** None was configured: the driver chooses from what the server offered. */
    readonly negotiated: boolean;
}

/**
 * The mechanism the authentication check used: the configured one, or for username and password
 * with none configured, the one negotiated from the greeting. `undefined` when neither is known.
 * Shared by the Authentication evidence line (`PanelRowProjector`) and its Details (`panelDetails`).
 */
export function authMechanismOf(
    auth: CheckResult<FindingCode>,
    /** Every result so far: the greeting (`hello`) results hold the offered mechanisms. */
    context: readonly CheckResult<FindingCode>[],
): AuthMechanism | undefined {
    const raw = auth.facts.mechanism;
    // `DEFAULT` and `none` are the driver's and the check's placeholders, not a mechanism name.
    if (typeof raw === 'string' && raw.length > 0 && raw !== 'DEFAULT' && raw !== 'none') {
        return { mechanism: raw, negotiated: false };
    }
    if (knownAuthMethod(auth.facts.authMethod) !== 'native') {
        return undefined;
    }
    const negotiated = negotiatedMechanism(context);
    return negotiated === undefined ? undefined : { mechanism: negotiated, negotiated: true };
}
