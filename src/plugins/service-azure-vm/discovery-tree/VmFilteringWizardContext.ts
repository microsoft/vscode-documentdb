/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FilteringWizardContext } from '../../api-shared/azure/subscriptionFiltering/FilteringWizardContext';

/**
 * Extended wizard context for VM-specific filtering that includes tag filtering
 */
export interface VmFilteringWizardContext extends FilteringWizardContext {
    /** The Azure VM tag to filter by */
    vmTag?: string;
}
