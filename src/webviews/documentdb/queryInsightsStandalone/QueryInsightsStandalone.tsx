/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import type { JSX } from 'react';

export function QueryInsightsStandalone(): JSX.Element {
    return <h1>{l10n.t('Query Insights Explorer (POC)')}</h1>;
}
