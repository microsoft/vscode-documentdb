/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type Check,
    type CheckOutcome,
    type Finding,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import { isIP } from 'net';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type DocumentDBCustomEnvironment } from '../../documentdb/auth/documentdbTokenResource';
import { type DocumentDBEntraCloud } from '../../documentdb/auth/entraScopes';
import { getAzureHostSuffix, normalizeCustomHostnameSuffix } from '../../documentdb/auth/oidcAllowedHosts';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { settingsKeys } from '../../settingsKeys';
import { type DnsMixedHostDomainsData } from '../findingData';
import { type TroubleshooterSetup } from '../input';
import { type FindingCode } from '../types';

const CLOUD_BY_SUFFIX: Readonly<Record<string, DocumentDBEntraCloud>> = {
    'azure.com': 'AzureCloud',
    'azure.us': 'AzureUSGovernment',
    'azure.cn': 'AzureChinaCloud',
};

/** A seed (`host:port`, `[v6]:port`) or probe target host as a bare, lower-case name or IP literal. */
function hostName(host: string): string {
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
    if (bracketed) {
        return bracketed[1];
    }
    return isIP(host) ? host : host.replace(/:\d+$/, '').toLowerCase();
}

/**
 * Warns when Microsoft Entra ID hosts mix built-in Azure clouds, or a built-in cloud with names that
 * are neither in a built-in cloud nor under the trusted custom suffix (IP literals included). No
 * recognized cloud, or a single cloud with only recognized hosts, is not a warning. Host names never
 * enter the finding.
 */
export function findMixedHostDomains(
    hosts: readonly string[],
    customHostnameSuffix: unknown,
): Finding<FindingCode> | undefined {
    const customSuffix = normalizeCustomHostnameSuffix(customHostnameSuffix);
    const clouds = new Set<DocumentDBEntraCloud>();
    let builtInHostCount = 0;
    let customHostCount = 0;
    let otherHostCount = 0;
    for (const name of new Set(hosts.map(hostName))) {
        const ip = isIP(name) !== 0;
        const azureSuffix = ip ? undefined : getAzureHostSuffix(name);
        const cloud = azureSuffix === undefined ? undefined : CLOUD_BY_SUFFIX[azureSuffix];
        if (cloud) {
            clouds.add(cloud);
            builtInHostCount++;
        } else if (!ip && customSuffix && name.endsWith(`.${customSuffix}`)) {
            customHostCount++;
        } else {
            otherHostCount++;
        }
    }
    if (clouds.size === 0 || (clouds.size === 1 && otherHostCount === 0)) {
        return undefined;
    }
    const crossCloud = clouds.size > 1;
    const data = {
        kind: crossCloud ? 'crossCloud' : 'unrecognizedHosts',
        clouds: [...clouds].sort(),
        builtInHostCount,
        customHostCount,
        otherHostCount,
        customSuffixConfigured: customSuffix !== undefined,
    } satisfies DnsMixedHostDomainsData;
    return {
        code: 'dns.mixedHostDomains',
        severity: 'warning',
        data,
        detail: {
            language: 'en',
            text: crossCloud
                ? 'The host names belong to different built-in Azure clouds.'
                : 'Some host names are in a built-in Azure cloud and others are outside the built-in Azure domains and the trusted custom suffix.',
        },
    };
}

function seedHosts(connectionString: string): string[] {
    try {
        return new DocumentDBConnectionString(connectionString).hosts ?? [];
    } catch {
        return [];
    }
}

function readCustomHostnameSuffix(): unknown {
    return vscode.workspace.getConfiguration().get<DocumentDBCustomEnvironment>(settingsKeys.customEnvironment)
        ?.hostnameSuffix;
}

/**
 * Adds {@link findMixedHostDomains} to the per-host DNS check, for Microsoft Entra ID and managed
 * identity only. The hosts are the ones the driver contacts: the seeds (the SRV name for
 * `mongodb+srv://`) and the probe targets (the resolved SRV targets). It is attached once per run, to
 * the first target the DNS check resolves, and only turns a pass into a warning.
 */
export function withMixedHostDomainsWarning(
    dns: Check<RunContext, FindingCode>,
    peekSetup: () => TroubleshooterSetup | undefined,
    getCustomHostnameSuffix: () => unknown = readCustomHostnameSuffix,
): Check<RunContext, FindingCode> {
    return {
        ...dns,
        async run(context, signal): Promise<CheckOutcome<FindingCode>> {
            const outcome = await dns.run(context, signal);
            const method = peekSetup()?.chosenAuthMethod;
            const first = context.targets.find((target): boolean => isIP(target.host) === 0);
            if (
                outcome.status === 'skipped' ||
                (method !== AuthMethodId.MicrosoftEntraID && method !== AuthMethodId.ManagedIdentity) ||
                !first ||
                first.host !== context.target?.host ||
                first.port !== context.target.port
            ) {
                return outcome;
            }
            const found = findMixedHostDomains(
                [...seedHosts(context.input.connectionString), ...context.targets.map((target): string => target.host)],
                getCustomHostnameSuffix(),
            );
            if (!found) {
                return outcome;
            }
            return {
                ...outcome,
                status: outcome.status === 'pass' ? 'warning' : outcome.status,
                findings: [...outcome.findings, found],
            };
        },
    };
}
