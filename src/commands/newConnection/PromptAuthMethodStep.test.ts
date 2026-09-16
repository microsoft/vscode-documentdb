/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { PromptAuthMethodStep } from './PromptAuthMethodStep';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

function createContext(authMethod: AuthMethodId): NewConnectionWizardContext {
    return {
        parentId: '',
        properties: {},
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showQuickPick: jest.fn().mockResolvedValue({ authMethod }),
        },
    } as unknown as NewConnectionWizardContext;
}

describe('PromptAuthMethodStep telemetry', () => {
    it.each(Object.values(AuthMethodId))('records the selected authentication method: %s', async (authMethod) => {
        const context = createContext(authMethod);

        await new PromptAuthMethodStep().prompt(context);

        expect(context.telemetry.properties.authMethod).toBe(authMethod);
    });
});