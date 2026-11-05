/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DiagnosticsInput, type NetworkOptions, type WireCompressor } from '@documentdb-js/connection-diagnostics';
import { CredentialCache, type CachedClusterCredentials } from '../documentdb/CredentialCache';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { buildAuthConnectionTarget } from '../documentdb/auth/authConnectionTarget';
import { getSrvFallbackMode } from '../documentdb/srv/prepareDriverConnectionString';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { addAuthenticationDataToConnectionString } from '../documentdb/utils/connectionStringHelpers';
import { type EphemeralClusterCredentials } from '../tree/documentdb/ClusterItemBase';
import { type EmulatorConfiguration } from '../utils/emulatorConfiguration';

/** Host-only, transient input. Never include this object in results, events or telemetry. */
export interface DiagnosticsSetup {
    readonly input: DiagnosticsInput;
    readonly chosenAuthMethod: AuthMethodId | undefined;
    readonly credentialState: 'available' | 'noMethod' | 'passwordMissing';
    readonly connectionProperties: Record<string, unknown> | undefined;
    readonly transientCredentials: CachedClusterCredentials | undefined;
}

export function detectAvailableCompressors(resolve: (moduleId: string) => string = require.resolve): WireCompressor[] {
    const available: WireCompressor[] = ['zlib'];
    for (const [compressor, moduleId] of [
        ['snappy', 'snappy'],
        ['zstd', '@mongodb-js/zstd'],
    ] as const) {
        try {
            resolve(moduleId);
            available.push(compressor);
        } catch {
            // Optional driver compressors are not bundled in every installation.
        }
    }
    return available;
}

/** The package input before the target is resolved; the `resolveTarget` check supplies the real one. */
export function unresolvedDiagnosticsInput(): DiagnosticsInput {
    return {
        connectionString: '',
        availableCompressors: detectAvailableCompressors(),
        srvFallbackMode: getSrvFallbackMode(),
    };
}

/** Builds the run's host-only setup from the target's resolved, non-empty connection details. */
export function buildDiagnosticsSetup(clusterId: string, credentials: EphemeralClusterCredentials): DiagnosticsSetup {
    const cached = CredentialCache.getCredentials(clusterId);
    const chosenAuthMethod = credentials.selectedAuthMethod ?? cached?.authMechanism;
    const password = credentials.nativeAuthConfig?.connectionPassword ?? cached?.nativeAuthConfig?.connectionPassword;
    let credentialState: DiagnosticsSetup['credentialState'] = 'available';
    if (chosenAuthMethod === undefined) {
        credentialState = 'noMethod';
    } else if (chosenAuthMethod === AuthMethodId.NativeAuth && !password) {
        credentialState = 'passwordMissing';
    }
    let connectionString = credentials.connectionString;
    let parseable = false;
    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        parsed.username = '';
        parsed.password = '';
        connectionString = parsed.toString();
        parseable = true;
    } catch {
        // Leave malformed input for the package's connectionString check to diagnose.
    }
    const nativeAuthConfig =
        chosenAuthMethod === AuthMethodId.NativeAuth
            ? {
                  connectionUser:
                      credentials.nativeAuthConfig?.connectionUser ?? cached?.nativeAuthConfig?.connectionUser ?? '',
                  connectionPassword: password ?? '',
              }
            : undefined;
    const transientCredentials: CachedClusterCredentials | undefined =
        chosenAuthMethod === undefined
            ? undefined
            : {
                  clusterId,
                  connectionString,
                  connectionStringWithPassword: parseable
                      ? addAuthenticationDataToConnectionString(
                            connectionString,
                            nativeAuthConfig?.connectionUser ?? '',
                            nativeAuthConfig?.connectionPassword ?? '',
                        )
                      : undefined,
                  authMechanism: chosenAuthMethod,
                  nativeAuthConfig,
                  emulatorConfiguration:
                      storedEmulatorConfiguration(credentials.connectionProperties) ?? cached?.emulatorConfiguration,
                  entraIdConfig:
                      chosenAuthMethod === AuthMethodId.NoAuth
                          ? undefined
                          : (credentials.entraIdAuthConfig ?? cached?.entraIdConfig),
                  managedIdentityConfig:
                      chosenAuthMethod === AuthMethodId.NoAuth
                          ? undefined
                          : (credentials.managedIdentityAuthConfig ?? cached?.managedIdentityConfig),
              };
    let networkOptions: NetworkOptions | undefined;
    if (credentialState === 'available' && chosenAuthMethod && transientCredentials && parseable) {
        const built = buildAuthConnectionTarget(chosenAuthMethod, transientCredentials);
        connectionString = built.connectionString;
        // The handler's server-selection fail-fast is extension policy the driver enforces itself; it is
        // not a connection-configured limit for the runner's authentication timeout.
        const { tls, tlsAllowInvalidCertificates, authMechanism } = built.networkOptions;
        networkOptions = {
            ...(tls === undefined ? {} : { tls }),
            ...(tlsAllowInvalidCertificates === undefined ? {} : { tlsAllowInvalidCertificates }),
            ...(authMechanism === undefined ? {} : { authMechanism }),
        };
    }
    return {
        input: {
            connectionString,
            ...(networkOptions === undefined
                ? {}
                : { networkOptionLayers: [{ origin: 'authHandler', options: networkOptions }] }),
            availableCompressors: detectAvailableCompressors(),
            srvFallbackMode: getSrvFallbackMode(),
        },
        chosenAuthMethod,
        credentialState,
        connectionProperties: credentials.connectionProperties,
        transientCredentials,
    };
}

function storedEmulatorConfiguration(
    properties: Record<string, unknown> | undefined,
): EmulatorConfiguration | undefined {
    const configuration = properties?.emulatorConfiguration;
    if (
        typeof configuration === 'object' &&
        configuration !== null &&
        'isEmulator' in configuration &&
        typeof configuration.isEmulator === 'boolean' &&
        'disableEmulatorSecurity' in configuration &&
        typeof configuration.disableEmulatorSecurity === 'boolean'
    ) {
        return {
            isEmulator: configuration.isEmulator,
            disableEmulatorSecurity: configuration.disableEmulatorSecurity,
        };
    }
    return undefined;
}
