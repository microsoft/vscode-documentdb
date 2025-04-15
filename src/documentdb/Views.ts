/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum Views {
    ConnectionsView = 'connectionsView',
    DiscoveryView = 'discoveryView',

    /**
     * Note to future maintainers: do not modify these string constants.
     * They're used in the `package.json` file to register these views.
     *
     * The strings used in the `package.json` file must match the strings used here.
     * Otherwise views will not be registered correctly.
     */
}
