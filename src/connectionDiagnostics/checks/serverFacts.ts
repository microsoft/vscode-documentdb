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
import { type MongoClient } from 'mongodb';
import { getAzureCloudFromHosts } from '../../documentdb/auth/oidcAllowedHosts';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { getClusterVersions } from '../../utils/clusterVersions';
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { type DiagnosticsSetup } from '../input';
import { type FindingCode } from '../types';
import { asRecord, observePostConnectCommand, type CommandFact } from './postConnectCommand';

function platformFacts(
    context: RunContext,
    setup: DiagnosticsSetup,
    hosts: readonly string[],
): Record<string, unknown> {
    if (context.getResult('prepare')?.facts.providerId === 'kubernetes-port-forward') {
        return { platform: 'kubernetes', platformEvidence: 'preparationProvider' };
    }
    if (
        setup.transientCredentials?.emulatorConfiguration?.isEmulator === true ||
        asRecord(setup.connectionProperties?.emulatorConfiguration)?.isEmulator === true
    ) {
        return { platform: 'localQuickStart', platformEvidence: 'connectionProperties' };
    }
    const { cloud } = getAzureCloudFromHosts(context.input.connectionString);
    if (cloud !== undefined && cloud !== 'conflicting') {
        const clouds = { AzureCloud: 'public', AzureUSGovernment: 'usGovernment', AzureChinaCloud: 'china' } as const;
        return { platform: 'azureDocumentDB', platformCloud: clouds[cloud], platformEvidence: 'hostSuffix' };
    }
    if (hosts.some((host): boolean => host.split(':')[0].toLowerCase().endsWith('.mongodb.net'))) {
        return { platform: 'atlas', platformEvidence: 'hostSuffix' };
    }
    return { platform: 'other', platformEvidence: 'none' };
}

function answeredBy(client: MongoClient): string | null {
    const servers: unknown = asRecord(asRecord(asRecord(client)?.topology)?.description)?.servers;
    if (!(servers instanceof Map)) {
        return null;
    }
    const available: string[] = [];
    for (const value of servers.values()) {
        const server = asRecord(value);
        if (typeof server?.address === 'string' && server.type !== 'Unknown' && server.type !== 'PossiblePrimary') {
            available.push(server.address);
        }
    }
    // A multi-server description is not evidence of which server answered this command.
    return available.length === 1 ? available[0] : null;
}

function helloFacts(reply: Record<string, unknown>, client: MongoClient): Record<string, unknown> {
    const facts: Record<string, unknown> = {};
    const rawVersions = asRecord(reply.internal)?.documentdb_versions;
    if (Array.isArray(rawVersions)) {
        facts.documentdbVersions = rawVersions
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, 8);
    }
    if (reply.msg === 'isdbgrid') {
        facts.topology = Array.isArray(rawVersions) ? 'documentdbGateway' : 'shardedRouter';
    } else if (client.options?.loadBalanced === true || reply.serviceId !== undefined) {
        facts.topology = 'loadBalanced';
    } else if (typeof reply.setName === 'string') {
        facts.topology = 'replicaSet';
        facts.setName = reply.setName;
        if (typeof reply.primary === 'string') {
            facts.primary = reply.primary;
        }
        const members = new Set<string>();
        for (const group of [reply.hosts, reply.passives, reply.arbiters]) {
            if (Array.isArray(group)) {
                for (const member of group) {
                    if (typeof member === 'string') {
                        members.add(member);
                    }
                }
            }
        }
        facts.memberCount = members.size;
    } else {
        facts.topology = 'standalone';
    }
    if (typeof reply.readOnly === 'boolean') {
        facts.readOnly = reply.readOnly;
    }
    for (const field of ['minWireVersion', 'maxWireVersion']) {
        const value = reply[field];
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
            facts[field] = value;
        }
    }
    return facts;
}

export function createServerFactsCheck(
    getSetup: () => DiagnosticsSetup,
    getRunOwnedClient: () => RunOwnedClient,
): Check<RunContext, FindingCode> {
    return {
        id: 'serverFacts',
        scope: 'run',
        dependsOn: ['authenticate'],
        async run(context, signal): Promise<CheckOutcome<FindingCode>> {
            const client = getRunOwnedClient().client;
            if (!client) {
                return {
                    status: 'skipped',
                    skippedBecause: { reason: 'dependencySkipped', checkId: 'authenticate' },
                    facts: {},
                    findings: [],
                };
            }
            const seedHosts = new DocumentDBConnectionString(context.input.connectionString).hosts ?? [];
            const commands: CommandFact[] = [];
            const facts: Record<string, unknown> = {
                seedHosts,
                commands,
                ...platformFacts(context, getSetup(), seedHosts),
            };
            const findings: Finding<FindingCode>[] = [];
            for (const command of ['buildInfo', 'hello']) {
                const observed = await observePostConnectCommand(client, context, signal, 'serverFacts', command);
                commands.push(observed.fact);
                if (observed.finding) {
                    findings.push(observed.finding);
                }
                if (observed.reply) {
                    if (command === 'buildInfo' && typeof observed.reply.version === 'string') {
                        facts.serverVersion = observed.reply.version;
                    } else if (command === 'hello') {
                        Object.assign(facts, helloFacts(observed.reply, client));
                    }
                }
            }
            facts.answeredBy = answeredBy(client);
            facts.versions = getClusterVersions({
                serverInfo_version: typeof facts.serverVersion === 'string' ? facts.serverVersion : undefined,
                topology_hello_internal_documentdb_versions: Array.isArray(facts.documentdbVersions)
                    ? (facts.documentdbVersions as string[]).join(';')
                    : undefined,
            });
            return { status: findings.length > 0 ? 'warning' : 'pass', facts, findings };
        },
    };
}
