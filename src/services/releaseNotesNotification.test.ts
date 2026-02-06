/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { checkVersionForNotification } from './releaseNotesNotification';

describe('releaseNotesNotification', () => {
    describe('checkVersionForNotification', () => {
        describe('version comparison logic', () => {
            it('should show notification when upgrading from 0.6.0 to 0.7.0', () => {
                const result = checkVersionForNotification('0.7.0', '0.6.0', false);

                expect(result.shouldShowNotification).toBe(true);
                expect(result.currentMajorMinor).toBe('0.7.0');
                expect(result.storedMajorMinor).toBe('0.6.0');
            });

            it('should show notification when upgrading from 0.7.0 to 0.8.0', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.0', false);

                expect(result.shouldShowNotification).toBe(true);
            });

            it('should show notification when upgrading from 0.7.0 to 1.0.0 (major version change)', () => {
                const result = checkVersionForNotification('1.0.0', '0.7.0', false);

                expect(result.shouldShowNotification).toBe(true);
            });

            it('should NOT show notification for patch update (0.7.0 to 0.7.1)', () => {
                const result = checkVersionForNotification('0.7.1', '0.7.0', false);

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should NOT show notification for same version', () => {
                const result = checkVersionForNotification('0.7.0', '0.7.0', false);

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should NOT show notification when stored version is newer (downgrade scenario)', () => {
                const result = checkVersionForNotification('0.7.0', '0.8.0', false);

                expect(result.shouldShowNotification).toBe(false);
            });
        });

        describe('prerelease version handling', () => {
            it('should show notification when upgrading from 0.6.0 to 0.7.1-alpha', () => {
                const result = checkVersionForNotification('0.7.1-alpha', '0.6.0', false);

                expect(result.shouldShowNotification).toBe(true);
                expect(result.currentMajorMinor).toBe('0.7.0');
            });

            it('should NOT show notification for patch with prerelease (0.7.0 to 0.7.1-alpha)', () => {
                const result = checkVersionForNotification('0.7.1-alpha', '0.7.0', false);

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should show notification when upgrading to minor with prerelease (0.7.0 to 0.8.0-beta)', () => {
                const result = checkVersionForNotification('0.8.0-beta', '0.7.0', false);

                expect(result.shouldShowNotification).toBe(true);
            });

            it('should NOT show notification between prerelease versions of same minor (0.7.1-alpha to 0.7.2-beta)', () => {
                const result = checkVersionForNotification('0.7.2-beta', '0.7.1-alpha', false);

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should handle stored prerelease version correctly (0.7.0-rc.1 to 0.8.0)', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.0-rc.1', false);

                expect(result.shouldShowNotification).toBe(true);
            });

            it('should NOT show notification for same minor with different prereleases (0.7.0-alpha to 0.7.0-beta)', () => {
                const result = checkVersionForNotification('0.7.0-beta', '0.7.0-alpha', false);

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should show notification when upgrading from prerelease to release of next minor (0.7.1-alpha to 0.8.0)', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.1-alpha', false);

                expect(result.shouldShowNotification).toBe(true);
            });
        });

        describe('first-time install handling', () => {
            it('should NOT show notification on first install (no stored version, no welcome flag)', () => {
                const result = checkVersionForNotification('0.7.0', undefined, false);

                expect(result.shouldShowNotification).toBe(false);
                expect(result.isFirstInstall).toBe(true);
                expect(result.currentMajorMinor).toBe('0.7.0');
            });

            it('should normalize version on first install with prerelease', () => {
                const result = checkVersionForNotification('0.7.1-alpha', undefined, false);

                expect(result.shouldShowNotification).toBe(false);
                expect(result.isFirstInstall).toBe(true);
                expect(result.currentMajorMinor).toBe('0.7.0');
                expect(result.storedMajorMinor).toBe('0.7.0');
            });
        });

        describe('transitional code for 0.7.0 upgrade', () => {
            it('should show notification when upgrading from pre-0.7.0 (welcome flag present, no release notes key)', () => {
                const result = checkVersionForNotification('0.7.0', undefined, true);

                expect(result.shouldShowNotification).toBe(true);
                expect(result.isUpgradeFromPre070).toBe(true);
                expect(result.storedMajorMinor).toBe('0.0.0');
            });

            it('should show notification for pre-0.7.0 upgrade even with prerelease version', () => {
                const result = checkVersionForNotification('0.7.1-alpha', undefined, true);

                expect(result.shouldShowNotification).toBe(true);
                expect(result.isUpgradeFromPre070).toBe(true);
            });
        });

        describe('version normalization', () => {
            it('should normalize current version to major.minor.0', () => {
                const result = checkVersionForNotification('0.7.5', '0.6.0', false);

                expect(result.currentMajorMinor).toBe('0.7.0');
            });

            it('should normalize stored version to major.minor.0', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.5', false);

                expect(result.storedMajorMinor).toBe('0.7.0');
            });
        });

        describe('error handling', () => {
            it('should return parseError for invalid current version', () => {
                const result = checkVersionForNotification('invalid', '0.7.0', false);

                expect(result.parseError).toBe(true);
                expect(result.shouldShowNotification).toBe(false);
            });

            it('should handle invalid stored version gracefully (treats as first install)', () => {
                const result = checkVersionForNotification('0.7.0', 'invalid', false);

                // Invalid stored version is treated as null (first install scenario)
                expect(result.shouldShowNotification).toBe(false);
                expect(result.isFirstInstall).toBe(true);
            });
        });
    });
});
