/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConcurrencyLimiter, type LimitedRunner } from '../../../utils/concurrencyLimiter';

/**
 * Shared concurrency limiter for Azure tenant sign-in checks.
 *
 * Both SelectAccountStep and InitializeFilteringStep fan out `isSignedIn`
 * calls across all tenants via Promise.all. For corporate users with many
 * tenants this is an unbounded parallel burst against Microsoft Entra. This
 * limiter caps the total in-flight sign-in checks at 5 across both wizard
 * steps.
 */
export const tenantSignInLimiter: LimitedRunner = createConcurrencyLimiter({ concurrency: 5 });
