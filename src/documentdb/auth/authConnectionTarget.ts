/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type MongoClientOptions } from 'mongodb';
import { nonNullValue } from '../../utils/nonNull';
import { type CachedClusterCredentials } from '../CredentialCache';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { AuthMethodId } from './AuthMethod';

/**
 * The network-level driver options an auth handler contributes. Secrets, callbacks and
 * `authMechanismProperties` are deliberately excluded.
 */
export type AuthNetworkOptions = Pick<
    MongoClientOptions,
    'tls' | 'tlsAllowInvalidCertificates' | 'serverSelectionTimeoutMS' | 'authMechanism'
>;

export interface AuthConnectionTarget {
    /** Transient: may contain the password for native authentication. Never log, persist or send. */
    readonly connectionString: string;
    readonly networkOptions: AuthNetworkOptions;
}

/**
 * Builds the connection string and network options the auth handler for `authMethod` gives the
 * driver, without acquiring a token, reading settings or doing any I/O. The auth handlers use it
 * for this part of `configureAuth`, so connectivity probes can use the same values without
 * signing in.
 */
export function buildAuthConnectionTarget(
    authMethod: AuthMethodId,
    credentials: CachedClusterCredentials,
): AuthConnectionTarget {
    switch (authMethod) {
        case AuthMethodId.NativeAuth:
            return buildNativeTarget(credentials);
        case AuthMethodId.NoAuth:
            return buildNoAuthTarget(credentials);
        case AuthMethodId.MicrosoftEntraID:
        case AuthMethodId.ManagedIdentity:
            return buildOidcTarget(credentials);
        default:
            throw new Error(l10n.t('Unsupported authentication method: {0}', authMethod));
    }
}

function buildNativeTarget(credentials: CachedClusterCredentials): AuthConnectionTarget {
    const connectionString = nonNullValue(
        credentials.connectionStringWithPassword,
        'clusterCredentials.connectionStringWithPassword',
        'NativeAuthHandler.ts',
    );

    return {
        connectionString,
        networkOptions: buildPasswordOrAnonymousNetworkOptions(credentials, connectionString),
    };
}

/**
 * Anonymous ("no authentication") connections pass the connection string through verbatim,
 * including any user-supplied `tls`/`ssl` overrides, and embed no credentials. TLS is never forced
 * here; the only options added are the TLS exception and its fail-fast timeout, applied exactly as
 * for native authentication.
 */
function buildNoAuthTarget(credentials: CachedClusterCredentials): AuthConnectionTarget {
    // Use the credential-free connection string. `connectionStringWithPassword` is
    // built with empty credentials for NoAuth and is therefore identical, but we
    // prefer the base `connectionString` to make the credential-free intent explicit.
    const { connectionString } = credentials;

    return {
        connectionString,
        networkOptions: buildPasswordOrAnonymousNetworkOptions(credentials, connectionString),
    };
}

/**
 * Shared by native and anonymous authentication. `hostConnectionString` is the string whose hosts
 * gate the TLS exception: the connection string the handler passes to the driver.
 */
function buildPasswordOrAnonymousNetworkOptions(
    credentials: CachedClusterCredentials,
    hostConnectionString: string,
): AuthNetworkOptions {
    const networkOptions: AuthNetworkOptions = {};

    // TLS-allow-invalid is driven by `disableEmulatorSecurity` (design §7), honored ONLY for
    // local/private hosts ("hybrid" runtime policy), whether or not the connection was classified as
    // an emulator: an orphaned flag on a public host is not activated, while an explicit
    // `tlsAllowInvalidCertificates` URL param is still honored by the driver (we never force the
    // option to `false`).
    const allowInvalidCertificates = resolveAllowInvalidCertificates(
        credentials.emulatorConfiguration?.disableEmulatorSecurity,
        hostConnectionString,
    );

    // Emulator-specific tuning: a shorter server-selection timeout fails fast against a
    // local instance that isn't up yet — also applied to a regular LOCAL connection that opted
    // into the TLS exception (§7). Host-gated the same way as the TLS option, so an orphaned
    // flag on a public host does NOT trigger the aggressive 4s fail-fast.
    if (credentials.emulatorConfiguration?.isEmulator || allowInvalidCertificates) {
        networkOptions.serverSelectionTimeoutMS = 4000;
    }

    if (allowInvalidCertificates) {
        networkOptions.tlsAllowInvalidCertificates = true;
    }

    return networkOptions;
}

/**
 * Microsoft Entra ID and managed identity both authenticate with `MONGODB-OIDC` over TLS, which is
 * forced even when the stored connection string does not ask for it.
 */
function buildOidcTarget(credentials: CachedClusterCredentials): AuthConnectionTarget {
    const dbConnectionString = new DocumentDBConnectionString(credentials.connectionString);
    dbConnectionString.username = ''; // required to move forward with Entra ID
    dbConnectionString.password = ''; // required to move forward with Entra ID
    // The URL form must not compete with `MongoClientOptions.authMechanismProperties`; leaving
    // `ENVIRONMENT:azure` in place risks the driver taking its own instance-metadata path.
    dbConnectionString.searchParams.delete('authMechanism');
    dbConnectionString.searchParams.delete('authMechanismProperties');
    dbConnectionString.searchParams.delete('tls');

    const networkOptions: AuthNetworkOptions = {
        authMechanism: 'MONGODB-OIDC',
        tls: true,
    };

    // Honor the TLS exception (design §7) consistently with the other auth paths, with the same
    // "hybrid" runtime policy (flag honored only for local/private hosts). Entra ID is only
    // offered for Azure (public) hosts, so this is effectively defensive, but it keeps the policy
    // uniform across all builders.
    if (
        resolveAllowInvalidCertificates(
            credentials.emulatorConfiguration?.disableEmulatorSecurity,
            credentials.connectionString,
        )
    ) {
        networkOptions.tlsAllowInvalidCertificates = true;
    }

    return {
        connectionString: dbConnectionString.toString(),
        networkOptions,
    };
}
