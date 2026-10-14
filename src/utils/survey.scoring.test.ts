/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { countUsageForSurvey, getSurveyConfig, getSurveyState } from './survey';

// Mock vscode-azext-utils module
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName, callback: (context: IActionContext) => Promise<void>) => {
            await callback({
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                ui: {
                    showWarningMessage: vi.fn(),
                    onDidFinishPrompt: vi.fn(),
                    showQuickPick: vi.fn(),
                    showInputBox: vi.fn(),
                    showOpenDialog: vi.fn(),
                    showWorkspaceFolderPick: vi.fn(),
                },
                valuesToMask: [],
            });
        },
    ),
    AzExtTreeDataProvider: vi.fn(),
    AzExtTreeItem: vi.fn(),
    createAzExtOutputChannel: vi.fn(),
    parseError: vi.fn((err) => err),
    DialogResponses: {
        yes: { title: 'Yes' },
        no: { title: 'No' },
        cancel: { title: 'Cancel' },
    },
}));

// Mock vscode module
vi.mock('vscode', () => ({
    env: {
        openExternal: vi.fn(() => Promise.resolve(true)),
    },
    Uri: {
        parse: vi.fn((url) => ({ toString: () => url })),
    },
}));

// Using non-null assertion as we're making sure getSurveyConfig and getSurveyState return values in test env
const surveyConfig = getSurveyConfig()!;
const surveyState = getSurveyState()!;

describe('Survey Scoring', () => {
    beforeEach(() => {
        // Reset survey state before each test
        surveyState.usageScore = 0;
        surveyState.wasPromptedInSession = false;

        // Enable survey for tests (it's disabled in production)
        surveyConfig.settings.DISABLE_SURVEY = false;

        // Clear mock calls between tests
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('countExperienceUsageForSurvey', () => {
        test('should not exceed the maximum score', () => {
            const maxScore = surveyConfig.scoring.MAX_SCORE;

            // First add almost max score
            countUsageForSurvey(maxScore - 10);
            expect(surveyState.usageScore).toBe(maxScore - 10);

            // Then add more than what's needed to reach max
            countUsageForSurvey(20);
            expect(surveyState.usageScore).toBe(maxScore);
        });

        test('should not increment score if wasPromptedInSession is true', () => {
            surveyState.wasPromptedInSession = true;

            countUsageForSurvey(30);

            expect(surveyState.usageScore).toBe(0);
        });

        test('should not increment score if DISABLE_SURVEY is true', () => {
            // Save original value to restore later
            const originalDisableSurvey = surveyConfig.settings.DISABLE_SURVEY;
            surveyConfig.settings.DISABLE_SURVEY = true;

            countUsageForSurvey(40);

            expect(surveyState.usageScore).toBe(0);

            // Restore original value
            surveyConfig.settings.DISABLE_SURVEY = originalDisableSurvey;
        });

        test('should handle negative score values by treating them as zero', () => {
            // Test with negative values
            countUsageForSurvey(-10);
            expect(surveyState.usageScore).toBe(0);
        });
    });
});
