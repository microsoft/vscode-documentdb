/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the impact level of a user action for survey scoring.
 */
export enum UsageImpact {
    /**
     * Minimal impact actions (e.g. viewing a resource)
     */
    Low = 1,

    /**
     * Medium impact actions (e.g. querying data)
     */
    Medium = 5,

    /**
     * High impact actions (e.g. creating a resource)
     */
    High = 20,

    /**
     * Very high impact actions (e.g. successful deployments)
     */
    VeryHigh = 50,
}
