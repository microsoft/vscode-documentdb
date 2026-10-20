/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IActionContext } from '@microsoft/vscode-azext-utils';
import { openQueryInsightsStandalone } from '../../webviews/documentdb/queryInsightsStandalone/queryInsightsStandaloneController';
import { queryInsightsPrefillSchema } from '../../webviews/documentdb/queryInsightsStandalone/queryInsightsStandaloneInput';

export function exploreWithOwnInput(_context: IActionContext, prefill?: unknown): void {
    const parsed = queryInsightsPrefillSchema.safeParse(prefill);
    openQueryInsightsStandalone(parsed.success ? parsed.data : {});
}
