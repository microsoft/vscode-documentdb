/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX } from 'react';
import { type IndexRow } from '../../types';
import { formatDate } from '../../utils/format';

/**
 * Translate the wire-level direction value into a human-readable label.
 * Numeric directions (±1) become "asc"/"desc"; string sentinels like
 * "text" / "2dsphere" pass through unchanged.
 */
function formatDirection(direction: number | string): string {
    if (direction === 1) return l10n.t('asc');
    if (direction === -1) return l10n.t('desc');
    return String(direction);
}

export interface IndexRowDetailsProps {
    index: IndexRow;
}

/**
 * Expanded detail panel for a single index, rendered inside the table's
 * detail sub-row. A full-width card holds the (field, direction) list and
 * the creation timestamp, giving the expansion a smooth, self-contained
 * visual rather than free-floating text under the row.
 */
export const IndexRowDetails = ({ index }: IndexRowDetailsProps): JSX.Element => (
    <Card className="indexDetailsCard" appearance="filled">
        <div className="fieldsDetailGrid" role="group" aria-label={l10n.t('Fields')}>
            <div className="fieldsDetailHeader">{l10n.t('Field')}</div>
            <div className="fieldsDetailHeader">{l10n.t('Order')}</div>
            {index.key.map(({ field, direction }) => (
                <Fragment key={`${field}:${String(direction)}`}>
                    <div className="fieldsDetailField">{field}</div>
                    <div className="fieldsDetailDirection">{formatDirection(direction)}</div>
                </Fragment>
            ))}
        </div>
        {/*
         * "Created" lives in the detail panel rather than the main row so the
         * table stays compact; users still get the timestamp by expanding.
         */}
        <div className="fieldsDetailMeta">
            <span className="fieldsDetailMetaLabel">{l10n.t('Created')}:</span>{' '}
            <span>{formatDate(index.usageSince)}</span>
        </div>
    </Card>
);
