/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';
import { type StatusListItemStatus } from '../StatusList/StatusList.types.js';

/**
 * The word a screen reader hears after a status row's label.
 *
 * The package ships no localization. The `npm run l10n` extractors do not scan `node_modules`, so
 * a string owned here would silently never be translated in any consumer. English defaults, and a
 * `StatusList` prop to replace them.
 */
export const defaultStatusLabels: Readonly<Record<StatusListItemStatus, string>> = {
    pending: 'pending',
    active: 'in progress',
    done: 'done',
    error: 'failed',
    warning: 'warning',
};

export const StatusLabelsContext = createContext<Readonly<Record<StatusListItemStatus, string>>>(defaultStatusLabels);

export const useStatusLabels = (): Readonly<Record<StatusListItemStatus, string>> => useContext(StatusLabelsContext);
