/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AtlasDatabaseUser } from '../models/AtlasProjectModel';

/** A database user offered as a ready-made answer to the username prompt. */
export interface AtlasDatabaseUserCandidate {
    readonly username: string;
    /**
     * Whether this extension can sign in as this user. Only SCRAM users qualify, because the
     * connect flow has nothing but a username and a password to offer.
     */
    readonly supported: boolean;
    /** Display name of the authentication method, shown for users we cannot use. */
    readonly authMethodLabel: string;
}

/**
 * Names the authentication method behind a database user.
 *
 * `databaseName` is the primary discriminator: `admin` is SCRAM, anything else (in practice
 * `$external`) is federated. Atlas then reports which federated method through four sibling
 * fields, exactly one of which is set to something other than `NONE`.
 */
export function describeAtlasUserAuthMethod(user: AtlasDatabaseUser): {
    supported: boolean;
    authMethodLabel: string;
} {
    if (user.databaseName === 'admin') {
        return { supported: true, authMethodLabel: l10n.t('Username and password') };
    }

    const isSet = (value: string | undefined): boolean =>
        typeof value === 'string' && value.length > 0 && value !== 'NONE';

    if (isSet(user.x509Type)) {
        return { supported: false, authMethodLabel: 'X.509' };
    }
    if (isSet(user.awsIAMType)) {
        return { supported: false, authMethodLabel: 'AWS IAM' };
    }
    if (isSet(user.ldapAuthType)) {
        return { supported: false, authMethodLabel: 'LDAP' };
    }
    if (isSet(user.oidcAuthType)) {
        return { supported: false, authMethodLabel: 'OIDC' };
    }

    // A `$external` user with no method flag set. Atlas can add methods faster than this
    // extension learns about them, so name it honestly rather than guessing or hiding it.
    return { supported: false, authMethodLabel: l10n.t('Federated') };
}

/**
 * Turns the project's database users into the candidates offered for one cluster.
 *
 * Database users are project-scoped. `scopes` is what narrows a user to particular clusters, and
 * an empty or absent `scopes` array means the user applies to every cluster in the project, so
 * only an explicitly scoped user that does not name this cluster is filtered out.
 *
 * Users we cannot sign in as are deliberately kept. Dropping them would answer "your username is
 * not here" with silence, when the real answer is "it is here, and it uses a method this
 * extension does not support yet".
 */
export function toAtlasDatabaseUserCandidates(
    users: AtlasDatabaseUser[],
    clusterName: string,
): AtlasDatabaseUserCandidate[] {
    return users
        .filter((user) => typeof user.username === 'string' && user.username.length > 0)
        .filter((user) => appliesToCluster(user, clusterName))
        .map((user) => ({ username: user.username, ...describeAtlasUserAuthMethod(user) }))
        .sort((a, b) => a.username.localeCompare(b.username, undefined, { numeric: true, sensitivity: 'base' }));
}

function appliesToCluster(user: AtlasDatabaseUser, clusterName: string): boolean {
    const clusterScopes = (user.scopes ?? []).filter((scope) => scope.type === 'CLUSTER');
    if (clusterScopes.length === 0) {
        return true;
    }

    return clusterScopes.some((scope) => scope.name === clusterName);
}
