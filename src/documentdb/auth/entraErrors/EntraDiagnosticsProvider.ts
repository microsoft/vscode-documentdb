/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import {
    type ConnectionDiagnosticsProvider,
    type ConnectionDiagnosticsRequest,
} from '../../../services/connectionDiagnosticsService';
import { classifyEntraError } from './classifyEntraError';
import { entraErrorRules } from './entraErrorRules';
import { getRecentEntraTokenFailure } from './entraTokenFailures';

export class EntraDiagnosticsProvider implements ConnectionDiagnosticsProvider {
    public readonly id = 'entra-sign-in';

    public async explain({ clusterId, error }: ConnectionDiagnosticsRequest): Promise<string | undefined> {
        if (error instanceof UserCancelledError) {
            return undefined;
        }
        const classification = classifyEntraError(errorMessages(error));
        if (!classification) {
            return undefined;
        }
        const rule = entraErrorRules.find((candidate): boolean => candidate.id === classification.ruleId);
        if (!rule) {
            return undefined;
        }

        const failure = getRecentEntraTokenFailure(clusterId);
        const message = rule.explain({
            code: classification.code,
            cloudCategory: failure?.cloudCategory,
            recentTokenFailure: failure !== undefined,
        });
        void callWithTelemetryAndErrorHandling('entraSignIn.classified', async (context): Promise<void> => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.suppressReportIssue = true;
            context.telemetry.properties.ruleId = classification.ruleId;
            context.telemetry.properties.aadstsCode = classification.code ?? '';
            context.telemetry.properties.cloudCategory = failure?.cloudCategory ?? 'unknown';
            context.telemetry.properties.brokered = classification.brokered ? 'true' : 'false';
            context.telemetry.properties.authMethod = failure?.authMethod ?? 'unknown';
        });
        return message;
    }
}

function errorMessages(error: unknown): string {
    const messages: string[] = [];
    // Driver wrappers can retain the original sign-in error, but causes may also be cyclic.
    for (let depth = 0; depth <= 3; depth++) {
        if (typeof error === 'string') {
            messages.push(error);
            break;
        }
        if (!(error instanceof Error)) {
            break;
        }
        messages.push(error.message);
        error = error.cause;
    }
    return messages.join('\n');
}
