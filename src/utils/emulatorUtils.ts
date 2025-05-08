/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import { API, getExperienceFromApi } from '../AzureDBExperiences';
import { randomUtils } from './randomUtils';

/**
 * Generates a unique ID for an emulator item based on the connection string.
 * The ID is prefixed with 'emulator-' and is derived from a hash of the connection string.
 *
 * @param connectionString - The connection string to hash
 * @returns A unique ID for the emulator item
 */
export function getEmulatorItemUniqueId(connectionString: string): string {
    const migratedMarker = 'emulator-';
    return `${migratedMarker}${randomUtils.getPseudononymousStringHash(connectionString, 'hex').substring(0, 24)}`;
}

/**
 * Generates a label for an emulator item based on the API type and port.
 * The label is localized and includes the experience name.
 *
 * @param api - The API type of the emulator
 * @param port - The port number (optional)
 * @returns A localized label for the emulator item
 */
export function getEmulatorItemLabelForApi(api: API, port: string | number | undefined): string {
    const experience = getExperienceFromApi(api);
    let label = l10n.t('{experienceName} Emulator', { experienceName: experience.shortName });

    if (experience.api === API.MongoDB || experience.api === API.MongoClusters) {
        label = l10n.t('MongoDB Emulator');
    }

    const portSuffix = typeof port !== 'undefined' ? ` : ${port}` : '';
    return `${label}${portSuffix}`;
}
