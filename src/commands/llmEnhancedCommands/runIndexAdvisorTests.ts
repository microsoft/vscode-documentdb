/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { executeTestCase, warmupConnection } from '../../../test/indexAdvisor/testRunner';
import { type TestCase, type TestConfig, type TestResult, type TestRunSummary } from '../../../test/indexAdvisor/types';
import {
    generateOutputPath,
    loadConfig,
    loadTestCases,
    loadTestCasesFromDirectory,
    saveResults,
} from '../../../test/indexAdvisor/utils';

/**
 * Runs the Index Advisor test suite
 * @param context Action context for telemetry
 */
export async function runIndexAdvisorTests(context: IActionContext): Promise<void> {
    // Prompt for configuration file
    const configUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'JSON Files': ['json'],
        },
        title: l10n.t('Select Test Configuration File'),
        openLabel: l10n.t('Select Config'),
    });

    if (!configUri || configUri.length === 0) {
        throw new Error(l10n.t('No configuration file selected'));
    }

    // Prompt for test cases
    const casesUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        filters: {
            'CSV Files': ['csv'],
        },
        title: l10n.t('Select Test Cases (Directory or CSV File)'),
        openLabel: l10n.t('Select'),
    });

    if (!casesUri || casesUri.length === 0) {
        throw new Error(l10n.t('No test cases selected'));
    }

    // Prompt for output location
    const outputUri = await vscode.window.showSaveDialog({
        filters: {
            'CSV Files': ['csv'],
        },
        title: l10n.t('Save Test Results'),
        saveLabel: l10n.t('Save Results'),
        defaultUri: vscode.Uri.file(generateOutputPath()),
    });

    if (!outputUri) {
        throw new Error(l10n.t('No output location selected'));
    }

    const configPath = configUri[0].fsPath;
    const casesPath = casesUri[0].fsPath;
    const outputPath = outputUri.fsPath;

    // Load configuration and test cases
    let config: TestConfig;
    let testCases: TestCase[];
    let isCSVMode = false;

    try {
        config = loadConfig(configPath);

        // Differnt loader for directly and csv file
        const stat = fs.statSync(casesPath);

        if (stat.isFile() && casesPath.toLowerCase().endsWith('.csv')) {
            // CSV-based test cases
            isCSVMode = true;
            testCases = loadTestCases(casesPath);
        } else if (stat.isDirectory()) {
            // directory-based test cases
            isCSVMode = false;
            testCases = loadTestCasesFromDirectory(casesPath);
        } else {
            throw new Error(l10n.t('Invalid test cases selection. Please select either a CSV file or a directory.'));
        }
    } catch (error) {
        throw new Error(
            l10n.t('Failed to load test files: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    if (testCases.length === 0) {
        throw new Error(
            l10n.t(isCSVMode ? 'No test cases found in the CSV file' : 'No test cases found in the directory'),
        );
    }

    // Ask about performance measurement only in csv mode
    let skipPerformance = true; // Default to skip for directory mode
    if (isCSVMode) {
        if (!config.clusterId && !config.connectionString) {
            throw new Error(
                l10n.t(
                    ' CSV mode requires either "clusterId" or "connectionString" in the configuration file for database access.',
                ),
            );
        }

        const perfChoice = await vscode.window.showQuickPick(
            [
                {
                    label: l10n.t('Yes, Measure Performance'),
                    description: l10n.t('Run queries and measure execution time (slower)'),
                    value: false,
                },
                {
                    label: l10n.t('No, Skip Performance Measurement'),
                    description: l10n.t('Only get AI recommendations (faster)'),
                    value: true,
                },
            ],
            {
                title: l10n.t('Performance Measurement'),
                placeHolder: l10n.t('Do you want to measure query performance?'),
            },
        );

        if (perfChoice === undefined) {
            // User cancelled
            return;
        }

        skipPerformance = perfChoice.value;
    } else {
        // For directory-based mode, we don't need database connection
        if (config.clusterId || config.connectionString) {
            const warningMsg = l10n.t(
                'Configuration contains connection details, but using directory-based mode. Connection details will be ignored.',
            );
            void vscode.window.showWarningMessage(warningMsg);
        }
    }

    // Show progress
    const results: TestResult[] = [];
    const startTime = Date.now();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Running Index Advisor Tests'),
            cancellable: false,
        },
        async (progress) => {
            const outputChannel = vscode.window.createOutputChannel('Index Advisor Tests');
            outputChannel.show(true);

            outputChannel.appendLine('='.repeat(60));
            outputChannel.appendLine(`Index Advisor Test Run - ${new Date().toLocaleString()}`);
            outputChannel.appendLine('='.repeat(60));
            outputChannel.appendLine(`Mode: ${isCSVMode ? 'CSV Mode' : 'Directory Mode'}`);
            outputChannel.appendLine(`Total Test Cases: ${testCases.length}`);
            outputChannel.appendLine(`Database: ${config.databaseName}`);
            outputChannel.appendLine('='.repeat(60));
            outputChannel.appendLine('');

            // Warm up connection
            progress.report({ message: l10n.t('Warming up connection...') });
            outputChannel.appendLine('Warming up connection...');

            const warmupProgress = (msg: string) => {
                outputChannel.appendLine(msg);
            };

            await warmupConnection(config, isCSVMode, warmupProgress);
            outputChannel.appendLine('');

            // Run each test case
            for (let i = 0; i < testCases.length; i++) {
                const testCase = testCases[i];
                const progressPercent = Math.round(((i + 1) / (testCases.length + 1)) * 100);

                outputChannel.appendLine(
                    `┌─ Test ${i + 1}/${testCases.length}: ${testCase.testCaseName} ${'─'.repeat(40)}`,
                );
                outputChannel.appendLine(`│  Collection: ${testCase.collectionName}`);
                outputChannel.appendLine(`│  Category: ${testCase.category}`);

                progress.report({
                    message: l10n.t('Test {current}/{total}: {testCase}', {
                        current: (i + 1).toString(),
                        total: testCases.length.toString(),
                        testCase: testCase.testCaseName,
                    }),
                    increment: progressPercent,
                });

                try {
                    const startTime = Date.now();

                    // Progress callback for detailed logging
                    const testProgress = (msg: string) => {
                        outputChannel.appendLine(`│  ${msg}`);
                    };

                    const result = await executeTestCase(
                        testCase,
                        config,
                        context,
                        isCSVMode,
                        skipPerformance,
                        testProgress,
                    );
                    results.push(result);

                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    outputChannel.appendLine(`│  Duration: ${duration}s`);

                    if (result.errors) {
                        outputChannel.appendLine(`└─ ✗ FAILED: ${result.errors}`);
                    } else {
                        outputChannel.appendLine(
                            `└─ ✓ SUCCESS (Model: ${result.modelUsed || 'N/A'}, Match: ${result.matchesExpected ? 'Yes' : 'No'})`,
                        );
                    }
                } catch (error) {
                    outputChannel.appendLine(`└─ ✗ ERROR: ${error instanceof Error ? error.message : String(error)}`);

                    // Add failed result
                    results.push({
                        testCaseName: testCase.testCaseName,
                        collectionName: testCase.collectionName,
                        category: testCase.category,
                        scenarioDescription: testCase.scenarioDescription,
                        expectedResult: testCase.expectedResult,
                        errors: error instanceof Error ? error.message : String(error),
                        timestamp: new Date().toISOString(),
                    });
                }

                outputChannel.appendLine('');
            }

            progress.report({ message: l10n.t('Saving results...') });
            outputChannel.appendLine('Saving results...');
            saveResults(results, outputPath);
            outputChannel.appendLine(`Results saved to: ${outputPath}`);
            outputChannel.appendLine('');
        },
    );

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // Calculate summary statistics
    const summary = calculateSummary(results, totalDuration);

    // Add telemetry
    context.telemetry.properties.totalTests = summary.totalTests.toString();
    context.telemetry.properties.successfulTests = summary.successfulTests.toString();
    context.telemetry.properties.failedTests = summary.failedTests.toString();
    context.telemetry.properties.matchRate = summary.matchRate.toFixed(2);

    // Show summary
    const summaryMessage = l10n.t('Tests completed: {successful}/{total} successful, Match rate: {matchRate}%', {
        successful: summary.successfulTests.toString(),
        total: summary.totalTests.toString(),
        matchRate: summary.matchRate.toFixed(1),
    });

    void vscode.window.showInformationMessage(summaryMessage);

    // Open results file
    const openResults = await vscode.window.showInformationMessage(
        l10n.t('Test results saved to {path}', { path: path.basename(outputPath) }),
        l10n.t('Open Results'),
    );

    if (openResults) {
        const doc = await vscode.workspace.openTextDocument(outputPath);
        await vscode.window.showTextDocument(doc);
    }
}

/**
 * Calculates summary statistics from test results
 * @param results Test results
 * @param totalDuration Total duration in milliseconds
 * @returns Summary statistics
 */
function calculateSummary(results: TestResult[], totalDuration: number): TestRunSummary {
    const totalTests = results.length;
    const successfulTests = results.filter((r) => !r.errors).length;
    const failedTests = totalTests - successfulTests;

    // Calculate match rate
    const matchedTests = results.filter((r) => r.matchesExpected === true).length;
    const matchRate = totalTests > 0 ? (matchedTests / totalTests) * 100 : 0;

    // Count model usage
    const modelUsage: Record<string, number> = {};
    for (const result of results) {
        if (result.modelUsed) {
            modelUsage[result.modelUsed] = (modelUsage[result.modelUsed] || 0) + 1;
        }
    }

    return {
        totalTests,
        successfulTests,
        failedTests,
        averagePerformanceImprovement: 0,
        matchRate,
        totalDuration,
        modelUsage,
    };
}
