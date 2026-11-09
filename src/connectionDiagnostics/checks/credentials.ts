/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Check, type CheckOutcome, type RunContext } from '@documentdb-js/connection-diagnostics';
import { type DiagnosticsSetup } from '../input';
import { type FindingCode } from '../types';

export function createCredentialsCheck(getSetup: () => DiagnosticsSetup): Check<RunContext, FindingCode> {
    return {
        id: 'credentials',
        scope: 'run',
        dependsOn: ['connectionString'],
        async run(): Promise<CheckOutcome<FindingCode>> {
            const { chosenAuthMethod, credentialState, passwordReadIssue } = getSetup();
            const kubernetesIssue =
                credentialState === 'passwordMissing' && passwordReadIssue?.source === 'kubernetes'
                    ? passwordReadIssue.reason
                    : undefined;
            let text = 'No stored password is available. Network checks can still run.';
            if (credentialState === 'noMethod') {
                text = 'No authentication method has been chosen. Network checks can still run.';
            } else if (kubernetesIssue) {
                text = 'The Kubernetes Secret password could not be read. Network checks can still run.';
            }
            return {
                status: 'pass',
                facts: { authMethod: chosenAuthMethod ?? null, credentialState },
                findings:
                    credentialState === 'available'
                        ? []
                        : [
                              {
                                  code: 'cs.credentialsMissing',
                                  severity: 'info',
                                  data: {
                                      missing: credentialState === 'noMethod' ? 'method' : 'password',
                                      ...(chosenAuthMethod === undefined ? {} : { authMethod: chosenAuthMethod }),
                                      ...(kubernetesIssue === undefined
                                          ? {}
                                          : { passwordSource: 'kubernetes', passwordReadIssue: kubernetesIssue }),
                                  },
                                  detail: {
                                      language: 'en',
                                      text,
                                  },
                              },
                          ],
            };
        },
    };
}
