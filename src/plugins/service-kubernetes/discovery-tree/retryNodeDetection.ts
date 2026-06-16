/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from '../../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';

export function hasRetryActionNode(children: TreeElement[] | null | undefined): boolean {
    return (
        children?.some(
            (child) =>
                typeof child.id === 'string' &&
                child.id.endsWith('/retry') &&
                isTreeElementWithContextValue(child) &&
                child.contextValue === 'error',
        ) ?? false
    );
}
