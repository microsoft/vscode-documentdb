/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    augmentClusterId,
    CLUSTER_ID_SEPARATOR,
    extractOriginalClusterId,
    extractProviderFromClusterId,
    isAugmentedClusterId,
    validateProviderId,
} from './clusterIdAugmentation';

describe('clusterIdAugmentation', () => {
    // Known provider IDs used in the codebase (no underscores)
    const vcoreProviderId = 'azure-mongo-vcore-discovery';
    const ruProviderId = 'azure-mongo-ru-discovery';

    // Typical original cluster IDs (sanitized Azure Resource IDs - start with _)
    const originalVCoreId =
        '_subscriptions_455f5b7e-620f-4f41-b67a-56513a1cdf29_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1';

    describe('validateProviderId', () => {
        it('should not throw for valid provider ID without separator', () => {
            expect(() => validateProviderId(vcoreProviderId)).not.toThrow();
            expect(() => validateProviderId(ruProviderId)).not.toThrow();
            expect(() => validateProviderId('my-custom-discovery')).not.toThrow();
        });

        it('should throw for provider ID containing separator', () => {
            expect(() => validateProviderId('invalid_provider')).toThrow(/must not contain/);
            expect(() => validateProviderId('also_invalid_id')).toThrow(/must not contain/);
            expect(() => validateProviderId('_starts-with-separator')).toThrow(/must not contain/);
        });
    });

    describe('augmentClusterId', () => {
        it('should prefix clusterId with provider ID and separator', () => {
            const result = augmentClusterId(vcoreProviderId, originalVCoreId);
            expect(result).toBe(`${vcoreProviderId}${CLUSTER_ID_SEPARATOR}${originalVCoreId}`);
        });

        it('should handle original IDs that start with underscore', () => {
            const result = augmentClusterId(vcoreProviderId, '_subscriptions_sub1');
            expect(result).toBe('azure-mongo-vcore-discovery__subscriptions_sub1');
            // Double underscore is expected: separator + original starting with _
        });

        it('should be idempotent - not double-prefix if already augmented', () => {
            const alreadyAugmented = `${vcoreProviderId}${CLUSTER_ID_SEPARATOR}${originalVCoreId}`;
            const result = augmentClusterId(ruProviderId, alreadyAugmented);
            expect(result).toBe(alreadyAugmented); // Unchanged
        });

        it('should handle empty original ID', () => {
            const result = augmentClusterId(vcoreProviderId, '');
            expect(result).toBe(`${vcoreProviderId}${CLUSTER_ID_SEPARATOR}`);
        });
    });

    describe('extractProviderFromClusterId', () => {
        it('should extract provider ID from augmented clusterId', () => {
            const augmented = `${vcoreProviderId}${CLUSTER_ID_SEPARATOR}${originalVCoreId}`;
            expect(extractProviderFromClusterId(augmented)).toBe(vcoreProviderId);
        });

        it('should return undefined for non-augmented IDs starting with separator', () => {
            // Original IDs start with _ (sanitized Azure Resource IDs)
            expect(extractProviderFromClusterId(originalVCoreId)).toBeUndefined();
            expect(extractProviderFromClusterId('_subscriptions_sub1')).toBeUndefined();
        });

        it('should return undefined for IDs without separator', () => {
            expect(extractProviderFromClusterId('no-separator-here')).toBeUndefined();
        });

        it('should return undefined for empty string', () => {
            expect(extractProviderFromClusterId('')).toBeUndefined();
        });
    });

    describe('extractOriginalClusterId', () => {
        it('should extract original ID from augmented clusterId', () => {
            const augmented = `${vcoreProviderId}${CLUSTER_ID_SEPARATOR}${originalVCoreId}`;
            expect(extractOriginalClusterId(augmented)).toBe(originalVCoreId);
        });

        it('should return input unchanged if not augmented', () => {
            expect(extractOriginalClusterId(originalVCoreId)).toBe(originalVCoreId);
        });

        it('should handle IDs where original starts with underscore', () => {
            const augmented = 'azure-mongo-vcore-discovery__subscriptions_sub1';
            expect(extractOriginalClusterId(augmented)).toBe('_subscriptions_sub1');
        });
    });

    describe('isAugmentedClusterId', () => {
        it('should return true for augmented IDs', () => {
            const augmented = `${vcoreProviderId}${CLUSTER_ID_SEPARATOR}${originalVCoreId}`;
            expect(isAugmentedClusterId(augmented)).toBe(true);
        });

        it('should return false for non-augmented IDs', () => {
            expect(isAugmentedClusterId(originalVCoreId)).toBe(false);
            expect(isAugmentedClusterId('_subscriptions_sub1')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(isAugmentedClusterId('')).toBe(false);
        });
    });
});
