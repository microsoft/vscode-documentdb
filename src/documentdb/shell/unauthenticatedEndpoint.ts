/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';

export function toUnauthenticatedConnectionString(connectionString: string): string {
    let endpoint: DocumentDBConnectionString;
    try {
        endpoint = new DocumentDBConnectionString(connectionString);
    } catch {
        throw new Error(l10n.t('Invalid connection string.'));
    }
    endpoint.password = '';
    endpoint.username = '';
    const authenticationOptions = new Set([
        'authmechanism',
        'authsource',
        'authmechanismproperties',
        'proxyusername',
        'proxypassword',
        'tlscertificatekeyfile',
        'tlscertificatekeyfilepassword',
        'sslpemkeyfile',
        'sslpemkeypassword',
        'sslcert',
        'sslcertificatekeyfile',
    ]);
    const keys = [...endpoint.searchParams.keys()].filter((key) => authenticationOptions.has(key.toLowerCase()));
    for (const key of keys) {
        endpoint.searchParams.delete(key);
    }
    return endpoint.toString();
}
