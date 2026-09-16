/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Skeleton, SkeletonItem } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

/**
 * Loading placeholder for the index table. Mirrors the Results tab skeleton
 * (a header row followed by a grid of shimmering rows) so the loading state
 * feels consistent across the collection views.
 */
export interface IndexTableSkeletonProps {
    /** Preserve the previous table height during refresh. Defaults to six rows on initial load. */
    rowCount?: number;
}

export const IndexTableSkeleton = ({ rowCount = 6 }: IndexTableSkeletonProps): JSX.Element => (
    <div className="indexTableSkeleton">
        <Skeleton appearance="translucent" aria-label={l10n.t('Loading indexes')}>
            <div className="indexSkeletonHeaderRow">
                <SkeletonItem size={24} />
            </div>
            <div className="indexSkeletonGrid">
                {Array.from({ length: rowCount * 4 }).map((_, index) => (
                    <SkeletonItem key={index} size={24} />
                ))}
            </div>
        </Skeleton>
    </div>
);
