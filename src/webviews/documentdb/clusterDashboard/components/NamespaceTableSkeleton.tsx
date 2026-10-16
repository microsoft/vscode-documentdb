/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Skeleton, SkeletonItem } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

export interface NamespaceTableSkeletonProps {
    /** Preserve the current table height during a refresh. */
    rowCount?: number;
}

const MAX_SKELETON_ROWS = 100;
const DEFAULT_SKELETON_ROWS = 6;

/** Loading placeholder for the database and collection inventory table. */
export const NamespaceTableSkeleton = ({
    rowCount = DEFAULT_SKELETON_ROWS,
}: NamespaceTableSkeletonProps): JSX.Element => {
    const boundedRowCount = Number.isFinite(rowCount)
        ? Math.min(MAX_SKELETON_ROWS, Math.max(0, Math.floor(rowCount)))
        : DEFAULT_SKELETON_ROWS;

    return (
        <div className="tableScroller">
            <div className="namespaceTableSkeleton">
                <Skeleton appearance="translucent" aria-label={l10n.t('Loading inventory')}>
                    <div className="namespaceSkeletonHeader">
                        <SkeletonItem size={24} />
                    </div>
                    <div className="namespaceSkeletonGrid">
                        {Array.from({ length: boundedRowCount * 6 }).map((_, index) => (
                            <SkeletonItem key={index} size={24} />
                        ))}
                    </div>
                </Skeleton>
            </div>
        </div>
    );
};
