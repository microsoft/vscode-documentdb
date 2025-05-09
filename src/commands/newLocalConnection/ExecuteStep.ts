/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionString } from 'mongodb-connection-string-url';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { getEmulatorItemUniqueId } from '../../utils/emulatorUtils';
import { nonNullValue } from '../../utils/nonNull';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewLocalConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewLocalConnectionWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
        let connectionString = context.connectionString;
        const port = context.port;
        const experience = context.experience;

        switch (context.mode) {
            case NewEmulatorConnectionMode.Preconfigured:
                if (connectionString === undefined || port === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString, port, and api must be defined.'));
                }
                break;
            case NewEmulatorConnectionMode.CustomConnectionString:
                if (connectionString === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString must be defined.'));
                }
                break;
            default:
                throw new Error(l10n.t('Internal error: mode must be defined.'));
        }

        const parsedCS = new ConnectionString(connectionString);

        const label =
            parsedCS.username && parsedCS.username.length > 0
                ? `${parsedCS.username}@${parsedCS.hosts.join(',')}`
                : parsedCS.hosts.join(',');

        return ext.state.showCreatingChild(
            parentId,
            l10n.t('Creating "{nodeName}"…', { nodeName: label }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                let isEmulator: boolean = true;
                let disableEmulatorSecurity: boolean | undefined;

                switch (experience.api) {
                    case API.MongoDB:
                    case API.MongoClusters:
                    case API.DocumentDB:
                        {
                            const mongoConfig = context.mongoEmulatorConfiguration as EmulatorConfiguration;
                            isEmulator = mongoConfig?.isEmulator ?? true;
                            disableEmulatorSecurity = mongoConfig?.disableEmulatorSecurity;

                            if (context.userName || context.password) {
                                const parsedConnectionString = new ConnectionString(nonNullValue(connectionString));
                                parsedConnectionString.username = context.userName ?? '';
                                parsedConnectionString.password = context.password ?? '';

                                connectionString = parsedConnectionString.toString();
                            }
                        }
                        break;
                    // Add additional cases here for APIs that require different handling
                    default: {
                        isEmulator = context.isCoreEmulator ?? true;
                        break;
                    }
                }

                const storageItem: StorageItem = {
                    id: getEmulatorItemUniqueId(connectionString!), // Use hash instead of raw connection string
                    name: label,
                    properties: {
                        api: experience.api === API.DocumentDB ? API.MongoClusters : experience.api,
                        isEmulator,
                        ...(disableEmulatorSecurity && { disableEmulatorSecurity }),
                    },
                    secrets: [nonNullValue(connectionString)],
                };

                if (experience.api === API.MongoDB) {
                    await StorageService.get(StorageNames.Workspace).push(
                        WorkspaceResourceType.MongoClusters,
                        storageItem,
                        true,
                    );
                } else if (experience.api === API.DocumentDB) {
                    await StorageService.get(StorageNames.Connections).push('emulators', storageItem, true);
                } else {
                    await StorageService.get(StorageNames.Workspace).push(
                        WorkspaceResourceType.AttachedAccounts,
                        storageItem,
                        true,
                    );
                }
            },
        );
    }

    public shouldExecute(context: NewLocalConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
