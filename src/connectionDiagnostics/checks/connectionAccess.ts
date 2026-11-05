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
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { type FindingCode } from '../types';
import { asRecord, observePostConnectCommand, type CommandFact } from './postConnectCommand';

interface ReportedRole {
    readonly role: string;
    readonly db: string;
}

const readRoles: ReadonlySet<string> = new Set([
    'read',
    'readWrite',
    'dbOwner',
    'readAnyDatabase',
    'readWriteAnyDatabase',
    'root',
]);

export function createConnectionAccessCheck(getRunOwnedClient: () => RunOwnedClient): Check<RunContext, FindingCode> {
    return {
        id: 'connectionAccess',
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
            const commands: CommandFact[] = [];
            const facts: Record<string, unknown> = { commands };
            const findings: Finding<FindingCode>[] = [];
            let pingFailed = false;
            for (const command of ['ping', 'connectionStatus', 'listDatabases']) {
                const observed = await observePostConnectCommand(client, context, signal, 'connectionAccess', command);
                commands.push(observed.fact);
                if (observed.finding) {
                    findings.push(observed.finding);
                }
                const { reply } = observed;
                if (command === 'ping') {
                    if (observed.fact.outcome === 'ok') {
                        facts.pingMs = observed.fact.durationMs;
                    } else if (observed.fact.outcome === 'failed') {
                        pingFailed = true;
                        facts.command = 'ping';
                        facts.errorName = observed.errorName;
                        if (observed.errorCode !== undefined) {
                            facts.errorCode = observed.errorCode;
                        }
                    }
                } else if (command === 'connectionStatus' && reply) {
                    const rawRoles = asRecord(reply.authInfo)?.authenticatedUserRoles;
                    if (Array.isArray(rawRoles)) {
                        const roles: ReportedRole[] = [];
                        for (const value of rawRoles) {
                            const role = asRecord(value);
                            if (typeof role?.role === 'string' && typeof role.db === 'string') {
                                roles.push({ role: role.role, db: role.db });
                                if (roles.length === 32) {
                                    break;
                                }
                            }
                        }
                        facts.roles = roles;
                        const readRole = roles.find((role): boolean => readRoles.has(role.role));
                        if (readRole) {
                            findings.push({
                                code: 'access.readRoleReported',
                                severity: 'info',
                                data: { role: readRole.role, database: readRole.db },
                                detail: {
                                    language: 'en',
                                    text: 'The server reported a built-in role that permits reading.',
                                },
                            });
                        }
                    }
                } else if (command === 'listDatabases') {
                    const noAuthentication = context.getResult('authenticate')?.facts.authMethod === 'NoAuth';
                    if (observed.fact.outcome === 'signInRequired' && noAuthentication) {
                        // The tree lists databases first; without sign-in it can show nothing.
                        findings.push({
                            code: 'access.signInRequired',
                            severity: 'warning',
                            data: { command: 'listDatabases' },
                            detail: {
                                language: 'en',
                                text: 'The server answered, but refused to list databases until the connection signs in.',
                            },
                        });
                    } else if (observed.fact.outcome === 'denied' || observed.fact.outcome === 'signInRequired') {
                        findings.push({
                            code: 'access.listDatabasesDenied',
                            severity: 'warning',
                            data: observed.fact.codeName === undefined ? {} : { codeName: observed.fact.codeName },
                            detail: {
                                language: 'en',
                                text: 'The connection succeeded, but the server denied listing databases.',
                            },
                        });
                    } else if (reply && Array.isArray(reply.databases)) {
                        facts.databaseCount = reply.databases.length;
                        if (reply.databases.length === 0) {
                            findings.push({
                                code: 'access.noDatabasesVisible',
                                severity: 'info',
                                data: {},
                                detail: { language: 'en', text: 'The server returned no visible databases.' },
                            });
                        }
                    }
                }
            }
            const warning =
                commands.some((item): boolean => item.outcome === 'timedOut') ||
                findings.some((finding): boolean => finding.severity === 'warning');
            if (pingFailed) {
                return { status: 'fail', facts, findings };
            }
            return { status: warning ? 'warning' : 'pass', facts, findings };
        },
    };
}
