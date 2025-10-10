/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { BaseExtendedTreeDataProvider } from '../BaseExtendedTreeDataProvider';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue } from '../TreeElementWithContextValue';

/**
 * Tree data provider for the Help and Feedback view.
 *
 * This provider displays a static list of helpful links including:
 * - What's New (changelog)
 * - Extension Documentation
 * - DocumentDB Documentation
 * - Suggest a Feature (HATs survey)
 * - Report a Bug
 * - Create Free Azure DocumentDB Cluster
 *
 * All items are leaf nodes (no children) that open external links when clicked.
 */
export class HelpAndFeedbackBranchDataProvider extends BaseExtendedTreeDataProvider<TreeElement> {
    constructor() {
        super();
    }

    async getChildren(element?: TreeElement): Promise<TreeElement[] | null | undefined> {
        return callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.HelpAndFeedbackView;

            if (!element) {
                context.telemetry.properties.parentNodeContext = 'root';

                // Clear cache for root-level items
                this.clearParentCache();

                const rootItems = this.getRootItems();

                // Process root items
                if (rootItems) {
                    for (const item of rootItems) {
                        if (isTreeElementWithContextValue(item)) {
                            this.appendContextValues(item, Views.HelpAndFeedbackView);
                        }

                        // Register root items in cache
                        this.registerNodeInCache(item);
                    }
                }

                return rootItems;
            }

            // No children for leaf nodes
            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;
            return undefined;
        });
    }

    /**
     * Helper function to get the root items of the help and feedback tree.
     * These are static link items with no children.
     */
    private getRootItems(): TreeElement[] | null | undefined {
        const parentId = Views.HelpAndFeedbackView;

        const rootItems: TreeElement[] = [
            createGenericElement({
                contextValue: 'helpItem',
                id: `${parentId}/whats-new`,
                label: vscode.l10n.t("What's New"),
                iconPath: new vscode.ThemeIcon('megaphone'),
                commandId: 'vscode.open',
                commandArgs: [
                    vscode.Uri.parse('https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md'),
                ],
            }) as TreeElement,

            createGenericElement({
                contextValue: 'helpItem',
                id: `${parentId}/extension-docs`,
                label: vscode.l10n.t('Extension Documentation'),
                iconPath: new vscode.ThemeIcon('book'),
                commandId: 'vscode.open',
                commandArgs: [vscode.Uri.parse('https://github.com/microsoft/vscode-documentdb#readme')],
            }) as TreeElement,

            createGenericElement({
                contextValue: 'helpItem',
                id: `${parentId}/documentdb-docs`,
                label: vscode.l10n.t('DocumentDB Documentation'),
                iconPath: new vscode.ThemeIcon('library'),
                commandId: 'vscode.open',
                commandArgs: [vscode.Uri.parse('https://github.com/microsoft/documentdb')],
            }) as TreeElement,

            createGenericElement({
                contextValue: 'feedbackItem',
                id: `${parentId}/suggest-feature`,
                label: vscode.l10n.t('Suggest a Feature'),
                iconPath: new vscode.ThemeIcon('lightbulb'),
                commandId: 'vscode.open',
                commandArgs: [
                    vscode.Uri.parse(
                        'https://github.com/microsoft/vscode-documentdb/issues/new?assignees=&labels=feature-request&template=feature_request.md',
                    ),
                ],
            }) as TreeElement,

            createGenericElement({
                contextValue: 'feedbackItem',
                id: `${parentId}/report-bug`,
                label: vscode.l10n.t('Report a Bug'),
                iconPath: new vscode.ThemeIcon('bug'),
                commandId: 'vscode.open',
                commandArgs: [
                    vscode.Uri.parse(
                        'https://github.com/microsoft/vscode-documentdb/issues/new?assignees=&labels=bug&template=bug_report.md',
                    ),
                ],
            }) as TreeElement,

            createGenericElement({
                contextValue: 'actionItem',
                id: `${parentId}/create-free-cluster`,
                label: vscode.l10n.t('Create Free Azure DocumentDB Cluster'),
                iconPath: new vscode.ThemeIcon('add'),
                commandId: 'vscode.open',
                commandArgs: [vscode.Uri.parse('https://aka.ms/tryvcore')],
            }) as TreeElement,
        ];

        return rootItems;
    }
}
