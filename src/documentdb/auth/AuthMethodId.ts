/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum AuthMethodId {
    /** The regular, typical username+password and connection string authentication. */
    NativeAuth = 'NativeAuth',
    /** Microsoft Entra ID (Azure AD) authentication. */
    MicrosoftEntraID = 'MicrosoftEntraID',
    /**
     * Microsoft Entra ID using the managed identity of the Azure resource hosting VS Code.
     *
     * Note: unlike the other values, this one has no counterpart in the ARM `authConfig.allowedModes`
     * vocabulary, so it is never produced by pass-through of service metadata. It is synthesized by
     * an explicit rule in `clusterHelpers.ts`.
     */
    ManagedIdentity = 'ManagedIdentity',
    /** Anonymous connection without a username, password, or Entra ID. */
    NoAuth = 'NoAuth',
}
