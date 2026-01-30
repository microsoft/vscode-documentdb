/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Separator used between provider prefix and original clusterId.
 * IMPORTANT: Provider IDs must NOT contain this character.
 */
export const CLUSTER_ID_SEPARATOR = '_';

/**
 * Validates that a provider ID does not contain the separator character.
 * Call this at provider registration time to fail fast.
 *
 * @param providerId The provider ID to validate
 * @throws Error if providerId contains the separator
 */
export function validateProviderId(providerId: string): void {
    if (providerId.includes(CLUSTER_ID_SEPARATOR)) {
        throw new Error(
            `Invalid provider ID "${providerId}": must not contain '${CLUSTER_ID_SEPARATOR}' character. ` +
                `This character is reserved as the separator between provider prefix and cluster ID.`,
        );
    }
}

/**
 * Extracts the provider prefix from an augmented clusterId.
 * Since provider IDs cannot contain '_', the first '_' is always the separator.
 *
 * @param clusterId The potentially augmented clusterId
 * @returns The provider ID prefix, or undefined if not augmented
 *
 * @example
 * extractProviderFromClusterId("azure-mongo-vcore-discovery__subscriptions_...")
 * // Returns: "azure-mongo-vcore-discovery"
 *
 * extractProviderFromClusterId("_subscriptions_...")
 * // Returns: undefined (starts with separator, so no valid prefix)
 */
export function extractProviderFromClusterId(clusterId: string): string | undefined {
    const separatorIndex = clusterId.indexOf(CLUSTER_ID_SEPARATOR);

    // No separator found, or starts with separator (no prefix)
    if (separatorIndex <= 0) {
        return undefined;
    }

    return clusterId.substring(0, separatorIndex);
}

/**
 * Extracts the original clusterId from an augmented clusterId.
 *
 * @param augmentedClusterId The augmented clusterId
 * @returns The original clusterId without the provider prefix
 */
export function extractOriginalClusterId(augmentedClusterId: string): string {
    const providerId = extractProviderFromClusterId(augmentedClusterId);
    if (!providerId) {
        return augmentedClusterId; // Not augmented, return as-is
    }

    return augmentedClusterId.substring(providerId.length + CLUSTER_ID_SEPARATOR.length);
}

/**
 * Checks if a clusterId has been augmented with a provider prefix.
 */
export function isAugmentedClusterId(clusterId: string): boolean {
    return extractProviderFromClusterId(clusterId) !== undefined;
}
