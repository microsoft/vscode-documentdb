/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as connectionStringUrl from 'mongodb-connection-string-url';

import { type NetworkOptionOrigin, type NetworkOptions, type RunContext } from './types.js';

export interface EffectiveNetworkOptions {
    readonly values: NetworkOptions;
    readonly origins: Readonly<Partial<Record<keyof NetworkOptions, NetworkOptionOrigin>>>;
}

const booleanKeys = [
    'tls',
    'tlsAllowInvalidCertificates',
    'tlsAllowInvalidHostnames',
    'tlsInsecure',
    'loadBalanced',
] as const;
const stringKeys = [
    'tlsCAFile',
    'tlsCertificateKeyFile',
    'tlsCertificateKeyFilePassword',
    'serverApiVersion',
    'authMechanism',
    'authSource',
    'proxyHost',
] as const;
const keys = [...booleanKeys, ...stringKeys, 'connectTimeoutMS', 'compressors'] as const;
const aliases: Readonly<Record<string, string>> = {
    ssl: 'tls',
    sslallowinvalidcertificates: 'tlsallowinvalidcertificates',
    sslallowinvalidhostnames: 'tlsallowinvalidhostnames',
};

export function resolveNetworkOptions(context: RunContext): EffectiveNetworkOptions {
    const values: { -readonly [K in keyof NetworkOptions]: NetworkOptions[K] } = {};
    const origins: Partial<Record<keyof NetworkOptions, NetworkOptionOrigin>> = {};
    function apply<K extends keyof NetworkOptions>(
        key: K,
        value: NetworkOptions[K],
        origin: NetworkOptionOrigin,
    ): void {
        if (value !== undefined) {
            values[key] = value;
            origins[key] = origin;
        }
    }
    function parse(name: string, value: string, origin: 'uri' | 'txt'): void {
        const normalized = aliases[name.toLowerCase()] ?? name.toLowerCase();
        for (const key of booleanKeys) {
            if (normalized === key.toLowerCase() && (value === 'true' || value === 'false')) {
                apply(key, value === 'true', origin);
                return;
            }
        }
        for (const key of stringKeys) {
            if (normalized === key.toLowerCase()) {
                apply(key, value, origin);
                return;
            }
        }
        if (
            normalized === 'connecttimeoutms' &&
            /^\d+$/.test(value) &&
            Number.isSafeInteger(Number(value)) &&
            Number(value) > 0
        ) {
            apply('connectTimeoutMS', Number(value), origin);
        } else if (normalized === 'compressors') {
            apply(
                'compressors',
                value.split(',').filter((entry): boolean => entry !== ''),
                origin,
            );
        }
    }
    let uri: connectionStringUrl.ConnectionString | undefined;
    try {
        uri = new connectionStringUrl.ConnectionString(context.input.connectionString);
    } catch {
        // Invalid URI contents (including TXT defaults) cannot describe an effective connection.
    }
    if (uri) {
        const srv = context.getResult('srv');
        if (srv?.facts.tlsImplied === true) {
            apply('tls', true, 'srvDefault');
        }
        const txt: unknown = srv?.facts.txtOptions;
        if (Array.isArray(txt)) {
            for (const entry of txt as unknown[]) {
                if (
                    entry &&
                    typeof entry === 'object' &&
                    'name' in entry &&
                    'value' in entry &&
                    typeof entry.name === 'string' &&
                    typeof entry.value === 'string' &&
                    ['authsource', 'loadbalanced'].includes(entry.name.toLowerCase())
                ) {
                    parse(entry.name, entry.value, 'txt');
                }
            }
        }
        for (const [name, value] of uri.searchParams) {
            parse(name, value, 'uri');
        }
    }
    for (const layer of context.input.networkOptionLayers ?? []) {
        for (const key of keys) {
            apply(key, layer.options[key], layer.origin);
        }
    }
    return { values, origins };
}

export function describeNetworkOptions(effective: EffectiveNetworkOptions): readonly {
    name: string;
    value?: string | number | boolean | readonly string[];
    valueSupplied: true;
    origin: NetworkOptionOrigin;
}[] {
    return keys.flatMap(
        (
            name,
        ): {
            name: string;
            value?: string | number | boolean | readonly string[];
            valueSupplied: true;
            origin: NetworkOptionOrigin;
        }[] => {
            const value = effective.values[name];
            const origin = effective.origins[name];
            if (value === undefined || origin === undefined) {
                return [];
            }
            return [
                { name, valueSupplied: true, origin, ...(name === 'tlsCertificateKeyFilePassword' ? {} : { value }) },
            ];
        },
    );
}
