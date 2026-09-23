/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Every setting ID contributed by this extension, grouped to match the `contributes.configuration`
 * nodes in package.json. `settingsContributions.test.ts` enforces that the two stay in sync.
 *
 * Deliberately kept out of `ext`: these are compile-time constants, not activation state, and
 * routing them through `ext` makes any test that partially mocks `extensionVariables` fail.
 */
export namespace settingsKeys {
    // General
    export const confirmationStyle = 'documentDB.confirmations.style';
    export const showUrlHandlingConfirmations = 'documentDB.confirmations.showUrlHandlingConfirmations';
    export const showOperationSummaries = 'documentDB.userInterface.showOperationSummaries';

    // Connections & Discovery
    export const connectionTimeout = 'documentDB.connectionTimeout';
    export const localPort = 'documentDB.local.port';
    export const kubernetesLocalPortStrategy = 'documentDB.serviceDiscovery.kubernetes.portForward.localPortStrategy';
    export const kubernetesLocalPortBase = 'documentDB.serviceDiscovery.kubernetes.portForward.localPortBase';

    // Queries & Results
    export const batchSize = 'documentDB.batchSize';
    export const collectionViewDefaultPageSize = 'documentDB.collectionView.defaultPageSize';

    // Copy & Paste
    export const showLargeCollectionWarning = 'documentDB.copyPaste.showLargeCollectionWarning';
    export const largeCollectionWarningThreshold = 'documentDB.copyPaste.largeCollectionWarningThreshold';

    // Query Playground
    export const playgroundConfirmRunAll = 'documentDB.playground.confirmRunAll';

    // Interactive Shell
    export const shellMultiLinePasteBehavior = 'documentDB.shell.multiLinePasteBehavior';
    export const shellColorSupport = 'documentDB.shell.display.colorSupport';
    export const shellAutocompletion = 'documentDB.shell.display.autocompletion';
    export const shellInlineHints = 'documentDB.shell.display.inlineHints';

    // AI Assistant
    export const enableAIQueryGeneration = 'documentDB.aiAssistant.enableQueryGeneration';
    export const queryGenerationSingleCollectionPromptPath =
        'documentDB.aiAssistant.queryGenerationSingleCollectionPromptPath';
    export const queryGenerationCrossCollectionPromptPath =
        'documentDB.aiAssistant.queryGenerationCrossCollectionPromptPath';
    export const indexAdvisorFindPromptPath = 'documentDB.aiAssistant.indexAdvisorFindPromptPath';
    export const indexAdvisorAggregatePromptPath = 'documentDB.aiAssistant.indexAdvisorAggregatePromptPath';
    export const indexAdvisorCountPromptPath = 'documentDB.aiAssistant.indexAdvisorCountPromptPath';

    // Accessibility
    export const hideCountPrefix = 'documentDB.accessibility.hideCountPrefix';

    /** Settings owned by VS Code itself, read but never contributed by this extension. */
    export namespace vsCode {
        export const proxyStrictSSL = 'http.proxyStrictSSL';
    }
}
