/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates the `x-announcedMigrationProviders` field in package.json at build time.
 * Prevents shipping a release with malformed or missing provider entries.
 */
describe('package.json x-announcedMigrationProviders', () => {
    let packageJson: Record<string, unknown>;

    beforeAll(() => {
        const packageJsonPath = path.resolve(__dirname, '../../package.json');
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(content) as Record<string, unknown>;
    });

    it('should have the x-announcedMigrationProviders field', () => {
        expect(packageJson).toHaveProperty('x-announcedMigrationProviders');
    });

    it('should be an array', () => {
        expect(Array.isArray(packageJson['x-announcedMigrationProviders'])).toBe(true);
    });

    it('should contain at least one provider', () => {
        const providers = packageJson['x-announcedMigrationProviders'] as unknown[];
        expect(providers.length).toBeGreaterThanOrEqual(1);
    });

    it('every provider should have required string fields: id, name, description', () => {
        const providers = packageJson['x-announcedMigrationProviders'] as unknown[];

        for (const provider of providers) {
            expect(provider).toBeDefined();
            expect(typeof provider).toBe('object');
            expect(provider).not.toBeNull();

            const p = provider as Record<string, unknown>;
            expect(typeof p.id).toBe('string');
            expect(typeof p.name).toBe('string');
            expect(typeof p.description).toBe('string');

            // Ensure values are non-empty
            expect((p.id as string).length).toBeGreaterThan(0);
            expect((p.name as string).length).toBeGreaterThan(0);
            expect((p.description as string).length).toBeGreaterThan(0);
        }
    });

    it('every provider id should look like a valid VS Code extension ID (publisher.name)', () => {
        const providers = packageJson['x-announcedMigrationProviders'] as Record<string, unknown>[];

        for (const provider of providers) {
            const id = provider.id as string;
            // Extension IDs follow the pattern "publisher.extensionName"
            expect(id).toMatch(/^[\w-]+\.[\w-]+$/);
        }
    });

    it('should not contain duplicate provider ids', () => {
        const providers = packageJson['x-announcedMigrationProviders'] as Record<string, unknown>[];
        const ids = providers.map((p) => p.id as string);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    it('providers should not have unexpected fields', () => {
        const allowedFields = new Set(['id', 'name', 'description']);
        const providers = packageJson['x-announcedMigrationProviders'] as Record<string, unknown>[];

        for (const provider of providers) {
            const keys = Object.keys(provider);
            for (const key of keys) {
                expect(allowedFields).toContain(key);
            }
        }
    });
});
