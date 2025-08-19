/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AuthMethod } from '../../documentdb/auth/AuthMethod';
import { type DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { type Experience } from '../../DocumentDBExperiences';

export enum ConnectionMode {
    ConnectionString,
    ServiceDiscovery,
}

export interface NewConnectionWizardContext extends IActionContext {
    parentId: string;

    experience?: Experience;
    connectionString?: string;
    parsedConnectionString?: URL | DocumentDBConnectionString;

    authenticationMethod?: AuthMethod;
    username?: string;
    password?: string;

    // The following properties are used in the "DocumentDB Connections" experience
    connectionMode?: ConnectionMode;

    /**
     * The ID of the service discovery provider for service discovery connections.
     * Only used when connectionMode is ConnectionMode.ServiceDiscovery.
     *
     * Set during the connection wizard prompt flow.
     */
    discoveryProviderId?: string;

    properties: {
        [key: string]: unknown;
    };
}
