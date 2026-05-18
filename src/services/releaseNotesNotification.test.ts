/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { checkVersionForNotification } from './releaseNotesNotification';

describe('releaseNotesNotification', () => {
    describe('checkVersionForNotification', () => {
        describe('version comparison logic', () => {
            it('should show notification when upgrading from 0.6.0 to 0.7.0', () => {
                const result = checkVersionForNotification('0.7.0', '0.6.0');

                expect(result.shouldShowNotification).toBe(true);
                expect(result.currentMajorMinor).toBe('0.7.0');
                expect(result.storedMajorMinor).toBe('0.6.0');
            });

            it('should show notification when upgrading from 0.7.0 to 0.8.0', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.0');

                expect(result.shouldShowNotification).toBe(true);
            });

            it('should show notification when upgrading from 0.7.0 to 1.0.0 (major version change)', () => {
                const result = checkVersionForNotification('1.0.0', '0.7.0');

                expect(result.shouldShowNotification).toBe(true);
            });

            it('should NOT show notification for patch update (0.7.0 to 0.7.1)', () => {
                const result = checkVersionForNotification('0.7.1', '0.7.0');

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should NOT show notification for same version', () => {
                const result = checkVersionForNotification('0.7.0', '0.7.0');

                expect(result.shouldShowNotification).toBe(false);
            });

            it('should NOT show notification when stored version is newer (downgrade scenario)', () => {
                const result = checkVersionForNotification('0.7.0', '0.8.0');

                expect(result.shouldShowNotification).toBe(false);
            });
        });

        describe('prerelease version handling', () => {
            it('should NOT show notification for prerelease build even when minor is higher (0.8.0-bugbash from 0.7.0)', () => {
                const result = checkVersionForNotification('0.8.0-bugbash', '0.7.0');

                expect(result.shouldShowNotification).toBe(false);
                expect(result.isPrerelease).toBe(true);
                expect(result.currentMajorMinor).toBe('0.8.0');
            });

            it('should NOT show notification for prerelease patch (0.7.1-alpha from 0.7.0)', () => {
                const result = checkVersionForNotification('0.7.1-alpha', '0.7.0');

                expect(result.shouldShowNotification).toBe(false);
                expect(result.isPrerelease).toBe(true);
            });

            it('should NOT show notification for prerelease on first install', () => {
                const result = checkVersionForNotification('0.8.0-preview', undefined);

                expect(result.shouldShowNotification).toBe(false);
                expect(result.isPrerelease).toBe(true);
                expect(result.isFirstInstall).toBe(false);
            });

            it('should NOT update stored version fields for prerelease builds', () => {
                const result = checkVersionForNotification('0.9.0-beta', '0.8.0');

                expect(result.isPrerelease).toBe(true);
                expect(result.storedMajorMinor).toBe('');
            });

            it('should handle stored prerelease version correctly when current is stable (0.7.0-rc.1 to 0.8.0)', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.0-rc.1');

                expect(result.shouldShowNotification).toBe(true);
                expect(result.isPrerelease).toBe(false);
            });

            it('should show notification when official release follows a prerelease of same minor (stored 0.7.0, current 0.8.0)', () => {
                // Simulates: user had 0.7.0 stored (prerelease 0.8.0-bugbash did not update it),
                // then installs official 0.8.0
                const result = checkVersionForNotification('0.8.0', '0.7.0');

                expect(result.shouldShowNotification).toBe(true);
                expect(result.isPrerelease).toBe(false);
            });
        });

        describe('first-time install handling', () => {
            it('should NOT show notification on first install (no stored version)', () => {
                const result = checkVersionForNotification('0.7.0', undefined);

                expect(result.shouldShowNotification).toBe(false);
                expect(result.isFirstInstall).toBe(true);
                expect(result.currentMajorMinor).toBe('0.7.0');
            });

            it('should normalize version on first install with prerelease', () => {
                const result = checkVersionForNotification('0.7.1-alpha', undefined);

                // Prerelease builds skip everything — no first install logic
                expect(result.shouldShowNotification).toBe(false);
                expect(result.isPrerelease).toBe(true);
                expect(result.isFirstInstall).toBe(false);
            });
        });

        describe('version normalization', () => {
            it('should normalize current version to major.minor.0', () => {
                const result = checkVersionForNotification('0.7.5', '0.6.0');

                expect(result.currentMajorMinor).toBe('0.7.0');
            });

            it('should normalize stored version to major.minor.0', () => {
                const result = checkVersionForNotification('0.8.0', '0.7.5');

                expect(result.storedMajorMinor).toBe('0.7.0');
            });
        });

        describe('error handling', () => {
            it('should return parseError for invalid current version', () => {
                const result = checkVersionForNotification('invalid', '0.7.0');

                expect(result.parseError).toBe(true);
                expect(result.shouldShowNotification).toBe(false);
            });

            it('should handle invalid stored version gracefully (treats as first install)', () => {
                const result = checkVersionForNotification('0.7.0', 'invalid');

                // Invalid stored version is treated as null (first install scenario)
                expect(result.shouldShowNotification).toBe(false);
                expect(result.isFirstInstall).toBe(true);
            });
        });
    });
});
