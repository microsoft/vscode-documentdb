/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { arch, platform, release } from 'node:os';

import { type BuiltInFindingCode } from '../findingCodes.js';
import { type Check, type CheckOutcome, type EnvironmentSource, type Finding, type RunContext } from '../types.js';

const proxyVariables = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const;
const proxySchemes = new Set(['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h']);

interface ProxyEndpoint {
    readonly variable: string;
    readonly scheme?: string;
    readonly host?: string;
    readonly port?: number | null;
    readonly authenticationPresent?: boolean;
    readonly parseFailed?: true;
}

function defaultEnvironment(): EnvironmentSource {
    return {
        versions: process.versions,
        platform: platform(),
        release: release(),
        arch: arch(),
        env: process.env,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
}

function proxyEndpoint(variable: string, value: string): ProxyEndpoint {
    try {
        const url = new URL(value.includes('://') ? value : `http://${value}`);
        const scheme = url.protocol.slice(0, -1);
        if (!proxySchemes.has(scheme) || !url.hostname) {
            return { variable, parseFailed: true };
        }
        return {
            variable,
            scheme,
            host: url.hostname,
            port: url.port ? Number(url.port) : null,
            authenticationPresent: url.username !== '' || url.password !== '',
        };
    } catch {
        return { variable, parseFailed: true };
    }
}

function rejectsCompressedSrv(version: string | undefined): boolean {
    const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
        return false;
    }
    const [major, minor, patch] = match.slice(1).map(Number);
    return (
        [major, minor, patch].every(Number.isSafeInteger) &&
        (major > 1 || (major === 1 && (minor > 34 || (minor === 34 && patch >= 7))))
    );
}

export function createEnvironmentCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'environment',
        scope: 'run',
        run: async (context): Promise<CheckOutcome<BuiltInFindingCode>> => {
            const environment = context.io.environment ?? defaultEnvironment();
            const proxies = proxyVariables.flatMap((variable): ProxyEndpoint[] => {
                const value = environment.env[variable];
                return value === undefined ? [] : [proxyEndpoint(variable, value)];
            });
            const variables = proxies.map((proxy): string => proxy.variable);
            const noProxy = environment.env.NO_PROXY ?? environment.env.no_proxy;
            const entries =
                noProxy
                    ?.split(',')
                    .map((entry): string => entry.trim())
                    .filter(Boolean) ?? [];
            const findings: Finding<BuiltInFindingCode>[] = [];
            if (variables.length > 0) {
                findings.push({
                    code: 'env.proxyConfigured',
                    severity: 'info',
                    data: { variables },
                    detail: {
                        language: 'en',
                        text: 'Proxy environment variables are configured; they do not automatically apply to database traffic.',
                    },
                });
            }
            const aresVersion = environment.versions.ares;
            if (rejectsCompressedSrv(aresVersion)) {
                findings.push({
                    code: 'env.caresRejectsCompressedSrv',
                    severity: 'info',
                    data: { aresVersion },
                    detail: {
                        language: 'en',
                        text: 'This c-ares version rejects SRV replies with compressed targets; no fixed release is available yet.',
                    },
                });
            }
            return {
                status: 'pass',
                findings,
                facts: {
                    nodeVersion: environment.versions.node ?? null,
                    aresVersion: aresVersion ?? null,
                    opensslVersion: environment.versions.openssl ?? null,
                    platform: environment.platform,
                    release: environment.release,
                    arch: environment.arch,
                    timeZone: environment.timeZone ?? null,
                    localTime: new Date(context.io.clock.now()).toISOString(),
                    proxy: {
                        variables: proxies,
                        ...(noProxy === undefined
                            ? {}
                            : {
                                  noProxy: {
                                      entries: entries.slice(0, 32),
                                      omittedCount: Math.max(0, entries.length - 32),
                                  },
                              }),
                    },
                },
            };
        },
    };
}
