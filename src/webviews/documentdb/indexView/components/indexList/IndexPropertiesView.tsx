/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow } from '../../types';

export interface IndexPropertiesViewProps {
    index: IndexRow;
}

/**
 * Compact, word-only badges for an index's stored options (unique, sparse,
 * partial, TTL, hidden). Only properties that are actually set are shown, so
 * a plain index renders nothing. Badges wrap within their column.
 */
export const IndexPropertiesView = ({ index }: IndexPropertiesViewProps): JSX.Element => {
    const labels: string[] = [];
    if (index.unique) labels.push(l10n.t('Unique'));
    if (index.sparse) labels.push(l10n.t('Sparse'));
    if (index.partialFilterExpression) labels.push(l10n.t('Partial'));
    if (index.expireAfterSeconds !== undefined) labels.push(l10n.t('TTL'));
    if (index.collation) labels.push(l10n.t('Collation'));
    if (index.hidden) labels.push(l10n.t('Hidden'));

    if (labels.length === 0) {
        // Keep the cell visually quiet for plain indexes.
        return <span className="indexPropertiesEmpty">—</span>;
    }

    return (
        <div className="indexPropertiesCell">
            {labels.map((label) => (
                <Badge key={label} appearance="outline" color="informative" shape="rounded" size="small">
                    {label}
                </Badge>
            ))}
        </div>
    );
};
