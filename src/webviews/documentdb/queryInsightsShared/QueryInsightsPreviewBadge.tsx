/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Badge } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import type { JSX } from 'react';

export function QueryInsightsPreviewBadge({ feature = false }: { feature?: boolean }): JSX.Element {
    return (
        <Badge appearance="tint" color="informative">
            {feature ? l10n.t('Feature preview') : l10n.t('Preview · tuned for find queries')}
        </Badge>
    );
}
