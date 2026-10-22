/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { openAppWebview, type AppWebviewController } from '../../_integration/openAppWebview';
import type { StandaloneRouterContext } from './queryInsightsStandaloneRouter';
import type { QueryInsightsPrefill } from './types';

export function openQueryInsightsStandalone(
    prefill: QueryInsightsPrefill = {},
): AppWebviewController<QueryInsightsPrefill> {
    const context: StandaloneRouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'queryInsightsStandalone',
        prefill,
    };
    return openAppWebview({
        webviewName: 'queryInsightsStandalone',
        panelViewType: 'vscode-documentdb-query-insights-standalone',
        title: vscode.l10n.t('Query Insights (POC)'),
        config: prefill,
        context,
    });
}
