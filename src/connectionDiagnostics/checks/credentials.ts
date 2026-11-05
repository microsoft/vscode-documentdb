/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Check, type CheckOutcome, type RunContext } from '@documentdb-js/connection-diagnostics';
import { type TroubleshooterSetup } from '../input';
import { type FindingCode } from '../types';

export function createCredentialsCheck(getSetup: () => TroubleshooterSetup): Check<RunContext, FindingCode> {
    return {
        id: 'credentials',
        scope: 'run',
        dependsOn: ['connectionString'],
        async run(): Promise<CheckOutcome<FindingCode>> {
            const { chosenAuthMethod, credentialState } = getSetup();
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
                                  },
                                  detail: {
                                      language: 'en',
                                      text:
                                          credentialState === 'noMethod'
                                              ? 'No authentication method has been chosen. Network checks can still run.'
                                              : 'No stored password is available. Network checks can still run.',
                                  },
                              },
                          ],
            };
        },
    };
}
