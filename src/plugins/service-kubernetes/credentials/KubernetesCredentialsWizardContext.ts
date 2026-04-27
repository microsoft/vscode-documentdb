/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type KubeconfigSource } from '../config';
import { type KubeContextInfo } from '../kubernetesClient';

/**
 * Wizard context for Kubernetes credential management.
 */
export interface KubernetesCredentialsWizardContext extends IActionContext {
    /** All contexts available in the kubeconfig file */
    availableContexts: KubeContextInfo[];

    /**
     * Context names selected/enabled by the user.
     * `undefined` means "never explicitly configured" (show all by default).
     * `[]` means "explicitly zero contexts selected" (all disabled).
     */
    selectedContextNames: string[] | undefined;

    /** Custom kubeconfig path (empty string for default) */
    customKubeconfigPath: string;

    /** Kubeconfig source selection */
    kubeconfigSource: KubeconfigSource;

    /** Pasted kubeconfig YAML when using inline source */
    inlineKubeconfigYaml: string;

    /** Reset context and namespace visibility filters after credentials are saved. */
    resetFilters: boolean;

    /** Whether the selected kubeconfig source, path, or inline content changed. */
    kubeconfigChanged: boolean;
}
