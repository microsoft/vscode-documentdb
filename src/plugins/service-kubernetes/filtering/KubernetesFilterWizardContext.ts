/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

/**
 * Wizard context for Kubernetes discovery filtering.
 */
export interface KubernetesFilterWizardContext extends IActionContext {
    /** Currently enabled context names */
    enabledContextNames: string[];

    /** Context names selected to be visible after filtering */
    visibleContextNames: string[];
}
