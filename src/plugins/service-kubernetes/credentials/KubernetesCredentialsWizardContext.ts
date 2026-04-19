/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type KubeContextInfo } from '../kubernetesClient';

/**
 * Wizard context for Kubernetes credential management.
 */
export interface KubernetesCredentialsWizardContext extends IActionContext {
    /** All contexts available in the kubeconfig file */
    availableContexts: KubeContextInfo[];

    /** Context names selected/enabled by the user */
    selectedContextNames: string[];

    /** Custom kubeconfig path (empty string for default) */
    customKubeconfigPath: string;

    /** Aliases for contexts (context name → display alias) */
    contextAliases: Record<string, string>;
}
