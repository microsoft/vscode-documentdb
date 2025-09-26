/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * REFERENCE IMPLEMENTATION - Mock FilteringInitializeStep
 *
 * This file demonstrates advanced UX patterns for Azure service discovery:
 * - Loading states with loadingPlaceHolder
 * - Exception-based flow control for seamless wizard transitions
 * - Dynamic subwizard creation based on initialization results
 * - Smart routing (single tenant → direct subscription, multiple → tenant selection)
 *
 * Key UX Features:
 * - 5-second initialization with loading animation
 * - Automatic progression without user interaction
 * - Context-aware subwizard selection
 * - Clean exception-driven flow control
 *
 * This implementation is kept as a reference for future filtering initialization steps.
 */

import { AzureWizardPromptStep, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type QuickPickItem } from 'vscode';
import { type NewConnectionWizardContext } from '../../../../commands/newConnection/NewConnectionWizardContext';
import { SelectClusterStep } from '../../../service-azure-mongo-vcore/discovery-wizard/SelectClusterStep';
import { SelectSubscriptionStep } from './SelectSubscriptionStep';

/**
 * Custom error to signal that initialization has completed and wizard should proceed to subwizard
 */
class InitializationCompleteError extends Error {
    constructor(message: string = 'Initialization completed successfully') {
        super(message);
        this.name = 'InitializationCompleteError';
    }
}

/**
 * Mock step to demonstrate the FilteringInitializeStep UX pattern with fake delay
 */
export class SelectTenantAndSubscriptionStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        try {
            // Use QuickPick with loading state for unified UX demonstration
            await context.ui.showQuickPick(this.mockInitializeFilteringData(context), {
                placeHolder: l10n.t('Initializing filtering options…'),
                loadingPlaceHolder: l10n.t('Loading Tenants and Subscription Data…'),
                suppressPersistence: true,
            });
        } catch (error) {
            // Initialization completed - this is expected behavior
            // The exception signals that initialization is done and we should proceed to subwizard
            if (error instanceof InitializationCompleteError) {
                // Mock: Set fake selected subscription for the rest of the wizard to work
                context.properties.selectedSubscription = {
                    subscriptionId: 'mock-subscription-id',
                    displayName: 'Mock Subscription',
                };
                return; // Proceed to getSubWizard
            }
            // Re-throw any other errors
            throw error;
        }
    }

    private async mockInitializeFilteringData(context: NewConnectionWizardContext): Promise<QuickPickItem[]> {
        // Mock: Add fake 5-second delay to simulate tenant/subscription loading
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Mock: Simulate tenant discovery logic
        const mockTenantCount = Math.floor(Math.random() * 3) + 1; // 1-3 tenants

        context.telemetry.properties.mockTenantCount = mockTenantCount.toString();

        if (mockTenantCount === 1) {
            // Single tenant: simulate auto-selection and subscription pre-loading
            context.telemetry.properties.mockFlow = 'singleTenant';
            // Simulate additional subscription loading delay
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
            // Multi-tenant: simulate tenant discovery
            context.telemetry.properties.mockFlow = 'multiTenant';
        }

        // Throw exception to signal initialization completion and auto-proceed to subwizard
        throw new InitializationCompleteError('Tenant and subscription initialization completed');
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async getSubWizard(
        context: NewConnectionWizardContext,
    ): Promise<IWizardOptions<NewConnectionWizardContext>> {
        const mockTenantCount = parseInt((context.telemetry.properties.mockTenantCount as string) || '1');

        if (mockTenantCount > 1) {
            // Multi-tenant: show both tenant and subscription selection
            return {
                title: l10n.t('Filter Tenants & Subscriptions (Mock)'),
                promptSteps: [
                    // Mock tenant selection step (using existing subscription step as placeholder)
                    new SelectSubscriptionStep(),
                    new SelectClusterStep(),
                ],
                executeSteps: [],
            };
        } else {
            // Single tenant: skip directly to cluster selection
            return {
                title: l10n.t('Select Cluster (Mock - Single Tenant)'),
                promptSteps: [new SelectClusterStep()],
                executeSteps: [],
            };
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
