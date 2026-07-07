/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

/**
 * Card layout for the Index Management tab — the default, comfortable view
 * intended for collections with only a handful of indexes.
 *
 * Placeholder for now: the card content will be built out once the overall
 * dashboard direction is finalized. The Table view remains fully functional.
 */
export const IndexCardsView = (): JSX.Element => {
    return (
        <div className="indexCardsView" role="status">
            <span className="indexCardsPlaceholder">{l10n.t('Cards view is coming soon.')}</span>
        </div>
    );
};
