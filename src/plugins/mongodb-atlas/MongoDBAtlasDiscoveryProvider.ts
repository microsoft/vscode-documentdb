/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { Disposable, l10n, ThemeIcon } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AtlasServiceRootItem } from './discovery-tree/AtlasServiceRootItem';
import { AtlasExecuteStep } from './discovery-wizard/AtlasExecuteStep';

/**
 * MongoDB Atlas service discovery provider
 * Enables programmatic discovery of Atlas projects and clusters
 */
export class MongoDBAtlasDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = 'mongodb-atlas-discovery';
    label = l10n.t('MongoDB Atlas');
    description = l10n.t('Discover MongoDB Atlas Projects and Clusters');
    iconPath = new ThemeIcon('server-environment');

    constructor() {
        super(() => {
            // Cleanup if needed
        });
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new AtlasServiceRootItem(parentId);
    }

    getDiscoveryWizard(_context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        return {
            title: l10n.t('MongoDB Atlas Discovery'),
            promptSteps: [], // Minimal implementation - could add credential prompts later
            executeSteps: [new AtlasExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    getLearnMoreUrl(): string | undefined {
        return 'https://docs.atlas.mongodb.com/api/';
    }
}