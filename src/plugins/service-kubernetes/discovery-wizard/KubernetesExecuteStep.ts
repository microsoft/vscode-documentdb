/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import { AzureWizardExecuteStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { ext } from '../../../extensionVariables';
import {
    buildPortForwardConnectionString,
    createCoreApi,
    loadConfiguredKubeConfig,
    resolveDocumentDBCredentials,
    resolveGenericServiceCredentials,
    resolveServiceEndpoint,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KUBERNETES_PORT_FORWARD_METADATA_PROPERTY, createKubernetesPortForwardMetadata } from '../portForwardMetadata';
import { PortForwardTunnelManager } from '../portForwardTunnel';
import { promptForLocalPort } from '../promptForLocalPort';
import { KubernetesWizardProperties } from './SelectContextStep';

/**
 * Execute step that resolves the selected service's endpoint and sets
 * the connection string on the wizard context.
 */
export class KubernetesExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const selectedContext = context.properties[KubernetesWizardProperties.SelectedContext] as KubeContextInfo;
        const selectedService = context.properties[KubernetesWizardProperties.SelectedService] as KubeServiceInfo;

        if (!selectedContext || !selectedService) {
            throw new Error('Kubernetes context or service not selected.');
        }

        const kubeConfig = await loadConfiguredKubeConfig();
        const coreApi = await createCoreApi(kubeConfig, selectedContext.name);
        const endpoint = await resolveServiceEndpoint(selectedService, coreApi);

        switch (endpoint.kind) {
            case 'ready':
                this.surfaceEndpointWarning(context, endpoint.warning);
                context.connectionString = endpoint.connectionString;
                context.connectionProperties = undefined;
                break;
            case 'needsPortForward': {
                const localPort = await promptForLocalPort(selectedService);
                if (localPort === undefined) {
                    throw new UserCancelledError();
                }

                const result = await PortForwardTunnelManager.getInstance().startTunnel({
                    kubeConfig,
                    coreApi,
                    contextName: selectedContext.name,
                    namespace: selectedService.namespace,
                    serviceName: selectedService.serviceName,
                    servicePort: selectedService.port,
                    servicePortName: selectedService.portName,
                    localPort,
                });

                context.telemetry.properties.portForwardOutcome = result.outcome;

                if (result.outcome === 'started') {
                    void vscode.window.showInformationMessage(
                        vscode.l10n.t(
                            'Port-forward tunnel started on 127.0.0.1:{0} for "{1}".',
                            String(localPort),
                            selectedService.displayName,
                        ),
                    );
                }

                context.connectionString = buildPortForwardConnectionString(selectedService, localPort);
                context.connectionProperties = {
                    [KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]: createKubernetesPortForwardMetadata(
                        selectedContext.name,
                        selectedService,
                        localPort,
                    ),
                };
                break;
            }
            case 'pending':
            case 'unreachable':
                void vscode.window.showWarningMessage(endpoint.reason);
                throw new UserCancelledError();
        }

        await this.applyAutoResolvedCredentials(context, selectedService, coreApi, kubeConfig);

        context.valuesToMask.push(context.connectionString);

        ext.outputChannel.appendLine(
            vscode.l10n.t('Kubernetes target "{0}" resolved successfully.', selectedService.displayName),
        );

        // Clean up wizard properties
        context.properties[KubernetesWizardProperties.SelectedContext] = undefined;
        context.properties[KubernetesWizardProperties.SelectedService] = undefined;
        context.properties[KubernetesWizardProperties.AvailableContexts] = undefined;
    }

    public shouldExecute(): boolean {
        return true;
    }

    private surfaceEndpointWarning(context: NewConnectionWizardContext, warning: string | undefined): void {
        if (!warning) {
            return;
        }

        ext.outputChannel.appendLine(warning);
        void vscode.window.showWarningMessage(warning);
        context.telemetry.properties.endpointWarning = 'internalIpMayBeUnreachable';
    }

    private async applyAutoResolvedCredentials(
        context: NewConnectionWizardContext,
        selectedService: KubeServiceInfo,
        coreApi: CoreV1Api,
        kubeConfig: KubeConfig,
    ): Promise<void> {
        const credentials = await this.tryResolveCredentials(context, selectedService, coreApi, kubeConfig);

        if (!credentials?.username || !credentials.password) {
            context.telemetry.properties.hasAutoCredentials = 'false';
            return;
        }

        context.availableAuthenticationMethods = [AuthMethodId.NativeAuth];
        context.selectedAuthenticationMethod = AuthMethodId.NativeAuth;
        context.nativeAuthConfig = {
            connectionUser: credentials.username,
            connectionPassword: credentials.password,
        };
        context.valuesToMask.push(credentials.password);
        context.telemetry.properties.hasAutoCredentials = 'true';
    }

    private async tryResolveCredentials(
        context: NewConnectionWizardContext,
        selectedService: KubeServiceInfo,
        coreApi: CoreV1Api,
        kubeConfig: KubeConfig,
    ): Promise<{ username: string; password: string } | undefined> {
        try {
            if (selectedService.sourceKind === 'dko') {
                return await resolveDocumentDBCredentials(
                    coreApi,
                    kubeConfig,
                    selectedService.namespace,
                    selectedService.serviceName,
                );
            }

            if (selectedService.sourceKind === 'generic' && selectedService.credentialSecretName) {
                return await resolveGenericServiceCredentials(
                    coreApi,
                    selectedService.namespace,
                    selectedService.credentialSecretName,
                );
            }
        } catch (error) {
            context.telemetry.properties.autoCredentialResolutionErrorType =
                error instanceof Error ? error.name : 'UnknownError';
        }

        return undefined;
    }
}
