/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../DocumentDBExperiences';
import { type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../../documentdb/ClustersClient';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type ClusterModel } from './ClusterModel';

export class IndexItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_index';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly cluster: ClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        readonly indexInfo: IndexItemModel,
    ) {
        this.id = `${cluster.id}/${databaseInfo.name}/${collectionInfo.name}/indexes/${indexInfo.name}`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<TreeElement[]> {
        // Use key if available, otherwise show not supported and will be handled in the future (for search indexes)
        if (this.indexInfo.key) {
            return Object.keys(this.indexInfo.key).map((key) => {
                const value = this.indexInfo.key![key];

                return createGenericElement({
                    contextValue: key,
                    id: `${this.id}/${key}`,
                    label: key,
                    description: value === -1 ? 'desc' : value === 1 ? 'asc' : value.toString(),
                    iconPath: new vscode.ThemeIcon('combine'),
                }) as TreeElement;
            });
        } else {
            return [
                createGenericElement({
                    contextValue: 'indexField',
                    id: `${this.id}/notSupported`,
                    label: 'Support coming soon',
                    description: '',
                    iconPath: new vscode.ThemeIcon('combine'),
                }) as TreeElement,
            ];
        }
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.indexInfo.name,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;
        md.isTrusted = true;
        md.supportThemeIcons = true;

        md.appendMarkdown(`### ${this.indexInfo.name}\n\n`);

        const badges: string[] = [];
        badges.push(`\`${this.indexInfo.type}\``);
        if (this.indexInfo.unique) {
            badges.push('`unique`');
        }
        if (this.indexInfo.sparse) {
            badges.push('`sparse`');
        }
        if (this.indexInfo.hidden) {
            badges.push('`hidden`');
        }
        if (badges.length > 0) {
            md.appendMarkdown(`${badges.join(' | ')}\n\n`);
        }

        md.appendMarkdown('---\n\n');

        const properties: Array<{ label: string; value: string }> = [];

        if (this.indexInfo.version !== undefined) {
            properties.push({ label: 'Version', value: `v${this.indexInfo.version}` });
        }

        if (this.indexInfo.status) {
            properties.push({ label: 'Status', value: this.indexInfo.status });
        }

        if (this.indexInfo.queryable !== undefined) {
            properties.push({ label: 'Queryable', value: this.indexInfo.queryable ? 'Yes' : 'No' });
        }

        if (this.indexInfo.expireAfterSeconds !== undefined) {
            properties.push({ label: 'TTL', value: `${this.indexInfo.expireAfterSeconds}s` });
        }

        // Additional boolean properties
        const booleanProps = [
            { key: 'unique' as const, label: 'Unique' },
            { key: 'sparse' as const, label: 'Sparse' },
            { key: 'background' as const, label: 'Background Build' },
            { key: 'hidden' as const, label: 'Hidden' },
        ];

        for (const prop of booleanProps) {
            if (this.indexInfo[prop.key] !== undefined) {
                properties.push({ label: prop.label, value: this.indexInfo[prop.key] ? 'Yes' : 'No' });
            }
        }

        // Render properties in a clean format
        if (properties.length > 0) {
            for (const prop of properties) {
                md.appendMarkdown(`**${prop.label}:** ${prop.value}  \n`);
            }
            md.appendMarkdown('\n');
        }

        // Index definition section
        if (this.indexInfo.key) {
            md.appendMarkdown('---\n\n');
            md.appendMarkdown('**Index Definition**\n\n');

            // Format keys in a readable way
            const keyEntries = Object.entries(this.indexInfo.key);
            if (keyEntries.length <= 3) {
                // For simple indexes, show inline
                const keyStrings = keyEntries.map(([field, order]) => {
                    const orderStr = order === -1 ? 'desc' : order === 1 ? 'asc' : String(order);
                    return `\`${field}\`: ${orderStr}`;
                });
                md.appendMarkdown(keyStrings.join(', ') + '\n\n');
            } else {
                // For complex indexes, show as code block
                md.appendMarkdown('```json\n');
                md.appendMarkdown(JSON.stringify(this.indexInfo.key, null, 2));
                md.appendMarkdown('\n```\n\n');
            }
        }

        // Partial filter (if exists)
        if (this.indexInfo.partialFilterExpression) {
            md.appendMarkdown('---\n\n');
            md.appendMarkdown('**Partial Filter Expression**\n\n');
            md.appendMarkdown('```json\n');
            md.appendMarkdown(JSON.stringify(this.indexInfo.partialFilterExpression, null, 2));
            md.appendMarkdown('\n```\n\n');
        }

        // Fields (for search indexes)
        if (this.indexInfo.fields && Array.isArray(this.indexInfo.fields) && this.indexInfo.fields.length > 0) {
            md.appendMarkdown('---\n\n');
            md.appendMarkdown('**Search Fields**\n\n');
            md.appendMarkdown('```json\n');
            md.appendMarkdown(JSON.stringify(this.indexInfo.fields, null, 2));
            md.appendMarkdown('\n```\n\n');
        }

        // // Action buttons at the bottom
        // md.appendMarkdown('---\n\n');
        // md.appendMarkdown('**Actions:**\n\n');

        // // Create command URIs with encoded arguments
        // const dropIndexArgs = encodeURIComponent(
        //     JSON.stringify([
        //         {
        //             cluster: this.cluster.id,
        //             databaseInfo: this.databaseInfo.name,
        //             collectionInfo: this.collectionInfo.name,
        //             indexInfo: this.indexInfo.name,
        //         },
        //     ]),
        // );

        // const hideUnhideArgs = encodeURIComponent(
        //     JSON.stringify([
        //         {
        //             cluster: this.cluster.id,
        //             databaseInfo: this.databaseInfo.name,
        //             collectionInfo: this.collectionInfo.name,
        //             indexInfo: this.indexInfo.name,
        //         },
        //     ]),
        // );

        // // TODO: wire up buttons with actual commands
        // // Drop index button (only if not _id index)
        // if (this.indexInfo.name !== '_id_') {
        //     md.appendMarkdown(
        //         `[$(trash) Drop Index](command:vscode-documentdb.command.dropIndex?${dropIndexArgs} "Delete this index") &nbsp;&nbsp;`,
        //     );
        // }

        // // Hide/Unhide button
        // if (this.indexInfo.name !== '_id_') {
        //     const hideUnhideText = this.indexInfo.hidden ? '$(eye) Unhide Index' : '$(eye-closed) Hide Index';
        //     const hideUnhideCommand = this.indexInfo.hidden
        //         ? 'vscode-documentdb.command.unhideIndex'
        //         : 'vscode-documentdb.command.hideIndex';
        //     const hideUnhideTooltip = this.indexInfo.hidden
        //         ? 'Make this index visible'
        //         : 'Hide this index from queries';

        //     md.appendMarkdown(
        //         `[${hideUnhideText}](command:${hideUnhideCommand}?${hideUnhideArgs} "${hideUnhideTooltip}") &nbsp;&nbsp;`,
        //     );
        // }

        return md;
    }
}
