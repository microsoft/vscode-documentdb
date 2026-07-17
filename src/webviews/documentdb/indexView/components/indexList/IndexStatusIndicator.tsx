/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner } from '@fluentui/react-components';
import { CheckmarkCircleFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow } from '../../types';

/**
 * Leading status indicator shown in front of an index name.
 *
 * - `ready` (or unset) → a green check icon, signalling the index is usable.
 * - `building` / `creating` → a small badge with a self-rotating spinner and a
 *   short label, signalling that something is happening to the index.
 */
export const IndexStatusIndicator = ({ state }: { state?: IndexRow['state'] }): JSX.Element => {
    if (state === 'building' || state === 'creating') {
        const label = state === 'creating' ? l10n.t('Creating') : l10n.t('Building');
        return (
            <span className="indexStatusBadge" aria-label={label} title={label}>
                <Spinner size="extra-tiny" />
                <span className="indexStatusLabel">{label}</span>
            </span>
        );
    }

    const readyLabel = l10n.t('Ready');
    return <CheckmarkCircleFilled className="indexStatusReady" aria-label={readyLabel} title={readyLabel} />;
};
