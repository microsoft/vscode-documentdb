/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Tooltip } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow } from '../../types';
import { formatShellJson } from '../../utils/format';

export interface IndexPropertiesViewProps {
    index: IndexRow;
}

/** One option badge. `tooltip`, when set, is shown on hover/focus (e.g. the
 * formatted filter / collation / projection object behind the badge). */
interface PropertyBadge {
    label: string;
    tooltip?: string;
}

/**
 * Compact, word-only badges for an index's stored options (unique, sparse,
 * partial, TTL, collation, wildcard, hidden). Only properties that are actually
 * set are shown, so a plain index renders nothing. Object-valued options carry
 * a tooltip with the readable, shell-style object behind them. Badges wrap
 * within their column.
 */
export const IndexPropertiesView = ({ index }: IndexPropertiesViewProps): JSX.Element => {
    const badges: PropertyBadge[] = [];
    if (index.unique) badges.push({ label: l10n.t('Unique') });
    if (index.sparse) badges.push({ label: l10n.t('Sparse') });
    if (index.partialFilterExpression) {
        badges.push({ label: l10n.t('Partial'), tooltip: formatShellJson(index.partialFilterExpression) });
    }
    if (index.expireAfterSeconds !== undefined) badges.push({ label: l10n.t('TTL') });
    if (index.collation) {
        badges.push({ label: l10n.t('Collation'), tooltip: formatShellJson(index.collation) });
    }
    if (index.wildcardProjection) {
        badges.push({ label: l10n.t('Wildcard'), tooltip: formatShellJson(index.wildcardProjection) });
    }
    if (index.hidden) badges.push({ label: l10n.t('Hidden') });

    if (badges.length === 0) {
        // Nothing to show for a plain index — keep the cell empty.
        return <></>;
    }

    return (
        <div className="indexPropertiesCell">
            {badges.map(({ label, tooltip }) => {
                const badge = (
                    <Badge appearance="outline" color="informative" shape="rounded" size="medium">
                        {label}
                    </Badge>
                );
                if (!tooltip) {
                    return <span key={label}>{badge}</span>;
                }
                return (
                    <Tooltip
                        key={label}
                        content={<code className="indexPropertiesTooltipCode">{tooltip}</code>}
                        relationship="description"
                        withArrow
                    >
                        {badge}
                    </Tooltip>
                );
            })}
        </div>
    );
};
