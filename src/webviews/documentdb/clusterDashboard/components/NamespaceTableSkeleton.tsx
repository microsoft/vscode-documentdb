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

/** Loading placeholder for the database and collection inventory table. */
export const NamespaceTableSkeleton = ({ rowCount = 6 }: NamespaceTableSkeletonProps): JSX.Element => (
    <div className="tableScroller">
        <div className="namespaceTableSkeleton">
            <Skeleton appearance="translucent" aria-label={l10n.t('Loading inventory')}>
                <div className="namespaceSkeletonHeader">
                    <SkeletonItem size={24} />
                </div>
                <div className="namespaceSkeletonGrid">
                    {Array.from({ length: rowCount * 6 }).map((_, index) => (
                        <SkeletonItem key={index} size={24} />
                    ))}
                </div>
            </Skeleton>
        </div>
    </div>
);
