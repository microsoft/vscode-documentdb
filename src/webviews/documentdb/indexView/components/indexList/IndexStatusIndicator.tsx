/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner, Tooltip } from '@fluentui/react-components';
import { CheckmarkCircleFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow } from '../../types';

/**
 * Leading status indicator shown in front of an index name.
 *
 * - `ready` (or unset) → a green check icon, signalling the index is usable.
 * - `building` / `creating` → a spinner whose tooltip reads "Building index" /
 *   "Creating index", signalling that something is happening to the index.
 */
export const IndexStatusIndicator = ({ state }: { state?: IndexRow['state'] }): JSX.Element => {
    if (state === 'building' || state === 'creating') {
        const label = state === 'creating' ? l10n.t('Creating index') : l10n.t('Building index');
        return (
            <Tooltip content={label} relationship="label" withArrow>
                <Spinner size="extra-tiny" aria-label={label} className="indexStatusSpinner" />
            </Tooltip>
        );
    }

    const readyLabel = l10n.t('Ready');
    return <CheckmarkCircleFilled className="indexStatusReady" aria-label={readyLabel} title={readyLabel} />;
};
