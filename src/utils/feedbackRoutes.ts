/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const FEEDBACK_ROUTE_URLS = {
    reportBug: 'https://github.com/microsoft/vscode-documentdb/issues/new?assignees=&labels=user%20feedback,bug',
    suggestFeature: 'https://github.com/microsoft/vscode-documentdb/issues/new?assignees=&labels=user%20feedback',
} as const;

export type FeedbackRoute = keyof typeof FEEDBACK_ROUTE_URLS;

export function isFeedbackRoute(value: unknown): value is FeedbackRoute {
    return Object.keys(FEEDBACK_ROUTE_URLS).some((route): boolean => route === value);
}
