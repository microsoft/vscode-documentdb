/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Match the static imports in azureauth's ESM AzureSubscriptionProviderBase.
import { createSubscription } from '@azure/arm-resources-subscriptions/api';
import { list as listSubscriptions } from '@azure/arm-resources-subscriptions/api/subscriptions';
import { list as listTenants } from '@azure/arm-resources-subscriptions/api/tenants';

export { createSubscription, listSubscriptions, listTenants };
